/**
 * Background compute entry (classic Blob Worker script).
 *
 * This file is NEVER concatenated into the main Client closure. `build/build.mjs`
 * reads it together with `src/rdf-parse.js` and `src/graph-model.js`, strips the
 * ES-module export syntax, wraps the three sources in an IIFE and embeds the
 * result as the `ONTOLOGY_WORKER_SOURCE` string inside `client.js`. At runtime
 * the plugin creates a classic worker from a Blob URL, so this script must be
 * fully self-contained: `parseOntology`, `buildGraph` and `layoutGraph` are
 * resolved from the worker closure created by the build. No React, no DOM.
 *
 * Protocol (see `src/ontology-job.js` for the client side):
 *
 *   in:  { type: 'compute', id, text, resourceAddress, displayName,
 *          limits: { maxTriples, maxNodes, maxEdges, maxLiteralsPerNode,
 *                    maxLiteralLength, maxDepth },
 *          layout: { width, height, seed, iterations } }
 *        { type: 'relayout', id, width, height, seed, iterations }
 *
 *   out: { type: 'graph', id, graph, base, baseSource, prefixes, diagnostics,
 *          stats, truncation, timing: { parse, build, layout } }
 *        { type: 'layout', id, positions: Float64Array, timing: { layout } }
 *        { type: 'error', id, message }
 *
 * `positions` is a transferable Float64Array of x/y pairs in `graph.nodes`
 * order (layoutGraph deduplicates ids in input order, so the order matches the
 * node list the main thread already has). The worker caches the last graph by
 * message id so a size change can run `relayout` without re-parsing.
 *
 * Keeping this file free of `import`/`export` matches the build's no-import
 * contract. Only `node --check` and the bundle tests ever read it directly.
 */

/** Monotonic-enough clock inside a worker; Date.now is the fallback. */
function ontologyWorkerNow() {
  try {
    if (typeof self !== 'undefined' && self.performance && typeof self.performance.now === 'function') {
      return self.performance.now()
    }
  } catch (error) {
    // fall through to Date.now
  }
  return Date.now()
}

/** Coerce a finite number, else return the fallback (0 is a valid value). */
function ontologyWorkerNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Merge protocol limits with the design's initial budgets. */
function ontologyWorkerNormalizeLimits(limits) {
  const input = limits && typeof limits === 'object' ? limits : {}
  return {
    maxTriples: Math.max(1, Math.floor(ontologyWorkerNumber(input.maxTriples, 120000))),
    maxNodes: Math.max(1, Math.floor(ontologyWorkerNumber(input.maxNodes, 1500))),
    maxEdges: Math.max(0, Math.floor(ontologyWorkerNumber(input.maxEdges, 6000))),
    maxLiteralsPerNode: Math.max(0, Math.floor(ontologyWorkerNumber(input.maxLiteralsPerNode, 60))),
    maxLiteralLength: Math.max(1, Math.floor(ontologyWorkerNumber(input.maxLiteralLength, 16384))),
    maxDepth: Math.max(1, Math.floor(ontologyWorkerNumber(input.maxDepth, 256))),
  }
}

/** Merge protocol layout options with the deterministic layout defaults. */
function ontologyWorkerNormalizeLayout(layout) {
  const input = layout && typeof layout === 'object' ? layout : {}
  const width = Math.max(1, ontologyWorkerNumber(input.width, 900))
  const height = Math.max(1, ontologyWorkerNumber(input.height, 600))
  const seed = Number.isFinite(input.seed) ? Math.floor(input.seed) >>> 0 : 1
  const iterations = Math.max(0, Math.min(2000, Math.floor(ontologyWorkerNumber(input.iterations, 320))))
  return { width, height, seed, iterations }
}

/** Pack layout points into the transferable x/y pair array. */
function ontologyWorkerPackPositions(positions) {
  const list = Array.isArray(positions) ? positions : []
  const packed = new Float64Array(list.length * 2)
  for (let index = 0; index < list.length; index += 1) {
    const point = list[index] && typeof list[index] === 'object' ? list[index] : {}
    packed[index * 2] = Number.isFinite(point.x) ? point.x : 0
    packed[index * 2 + 1] = Number.isFinite(point.y) ? point.y : 0
  }
  return packed
}

/** Human-readable message for the error protocol message. */
function ontologyWorkerErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error)
}

/** Last computed graph, kept so `relayout` does not re-parse the document. */
let ontologyWorkerCache = null

/** Post the transferable layout message. */
function ontologyWorkerPostLayout(id, positions, elapsed) {
  const packed = ontologyWorkerPackPositions(positions)
  self.postMessage({ type: 'layout', id, positions: packed, timing: { layout: elapsed } }, [packed.buffer])
}

/** Handle one `compute` request: parse -> build -> layout -> cache. */
function ontologyWorkerCompute(id, message) {
  const text = typeof message.text === 'string' ? message.text : ''
  const resourceAddress = typeof message.resourceAddress === 'string' ? message.resourceAddress : ''
  const displayName = typeof message.displayName === 'string' ? message.displayName : ''
  const limits = ontologyWorkerNormalizeLimits(message.limits)
  const layoutOptions = ontologyWorkerNormalizeLayout(message.layout)

  const startedAt = ontologyWorkerNow()
  const parsed = parseOntology(text, {
    resourceAddress: resourceAddress || undefined,
    fileName: displayName || undefined,
    maxTriples: limits.maxTriples,
    maxLiteralLength: limits.maxLiteralLength,
    maxDepth: limits.maxDepth,
  }) || {}
  const parsedAt = ontologyWorkerNow()

  const graph = buildGraph(parsed, {
    maxNodes: limits.maxNodes,
    maxEdges: limits.maxEdges,
    maxLiteralsPerNode: limits.maxLiteralsPerNode,
    maxLiteralLength: limits.maxLiteralLength,
    source: {
      address: resourceAddress,
      displayName: displayName,
      format: typeof parsed.format === 'string' ? parsed.format : '',
    },
  }) || { nodes: [], edges: [], stats: {}, warnings: [] }
  const builtAt = ontologyWorkerNow()

  const positions = layoutGraph(graph, layoutOptions)
  const laidOutAt = ontologyWorkerNow()

  ontologyWorkerCache = { id: id, graph: graph }

  const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
  self.postMessage({
    type: 'graph',
    id: id,
    graph: graph,
    base: typeof parsed.base === 'string' ? parsed.base : '',
    baseSource: typeof parsed.baseSource === 'string' ? parsed.baseSource : 'none',
    prefixes: parsed.prefixes && typeof parsed.prefixes === 'object' ? parsed.prefixes : {},
    diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [],
    stats: stats,
    truncation: stats.truncation && typeof stats.truncation === 'object' ? stats.truncation : null,
    timing: {
      parse: parsedAt - startedAt,
      build: builtAt - parsedAt,
      layout: laidOutAt - builtAt,
    },
  })
  ontologyWorkerPostLayout(id, positions, laidOutAt - builtAt)
}

/** Handle one `relayout` request against the cached graph. */
function ontologyWorkerRelayout(id, message) {
  if (!ontologyWorkerCache || ontologyWorkerCache.id !== id) {
    throw new Error('relayout requested before a graph is available')
  }
  const layoutOptions = ontologyWorkerNormalizeLayout(message)
  const startedAt = ontologyWorkerNow()
  const positions = layoutGraph(ontologyWorkerCache.graph, layoutOptions)
  ontologyWorkerPostLayout(id, positions, ontologyWorkerNow() - startedAt)
}

/** Worker message entry point. */
self.onmessage = function ontologyWorkerOnMessage(event) {
  const message = event && event.data ? event.data : null
  if (!message || typeof message !== 'object') return
  const id = message.id
  try {
    if (message.type === 'compute') {
      ontologyWorkerCompute(id, message)
      return
    }
    if (message.type === 'relayout') {
      ontologyWorkerRelayout(id, message)
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: id, message: ontologyWorkerErrorMessage(error) })
  }
}
