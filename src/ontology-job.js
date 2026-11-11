/**
 * Ontology compute job: input state machine, background-worker client and
 * chunked main-thread fallback for `parse -> buildGraph -> layout`.
 *
 * This module is pure ECMAScript on purpose. It is concatenated into the
 * browser Client bundle by `build/build.mjs` (after `rdf-parse` and
 * `graph-model`) and imported directly by the Node test runner. It therefore
 * has no imports:
 *
 *   - `parseOntology`, `buildGraph`, `layoutGraph`, `createLayoutTask` and
 *     `ONTOLOGY_WORKER_SOURCE` are resolved from the shared Client closure when
 *     the module runs inside `client.js`;
 *   - Node tests inject them through `options.impl` / `handlers.impl`, because
 *     the module scope of an ES module has no such identifiers.
 *
 * Two public entry points:
 *
 *   computeOntology(input, options)  low-level one-shot compute (used by tests
 *                                    and any non-React caller).
 *   createOntologyRunner(handlers)   stateful runner for the UI: generation
 *                                    counter, stale-result dropping, worker
 *                                    termination, size-change relayout.
 *
 * Guiding rules from the design (OpenSpec enhance-ontology-graph-core §3):
 *   - `generation` only identifies stale results; it is NOT cancellation.
 *   - Real cancellation: worker -> terminate() and rebuild (no Blob URL leak);
 *     main thread -> cancellation flag checked at chunk boundaries.
 *   - The degraded path only chunks the LAYOUT. Parse and buildGraph stay
 *     synchronous, so the UI must not claim the whole pipeline is async.
 *   - Nothing in this module may throw out of `submit()`; failures become
 *     `error` events instead.
 */

/** Initial budgets (design §8.2; callers may override, they are not a contract). */
const ONTOLOGY_JOB_DEFAULT_LIMITS = Object.freeze({
  maxTriples: 120000,
  maxNodes: 1500,
  maxEdges: 6000,
  maxLiteralsPerNode: 60,
  maxLiteralLength: 16384,
  maxDepth: 256,
})

/** Stricter budgets for the main-thread degraded path (design §8.3). */
const ONTOLOGY_JOB_DEGRADED_LIMITS = Object.freeze({
  maxTriples: 60000,
  maxNodes: 800,
  maxEdges: 3000,
})

/** Deterministic layout defaults; identical to `layoutGraph` defaults. */
const ONTOLOGY_JOB_DEFAULT_LAYOUT = Object.freeze({
  width: 900,
  height: 600,
  seed: 1,
  iterations: 320,
})

/** First-message timeout before falling back to the main thread. */
const ONTOLOGY_JOB_WORKER_TIMEOUT = 15000

/** Hard guard for a layout task that never reports completion. */
const ONTOLOGY_JOB_MAX_STEPS = 1000000

/** Monotonic-enough clock with a Date.now fallback (Node < 16 / odd hosts). */
function ontologyJobNow() {
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now()
    }
  } catch (error) {
    // fall through to Date.now
  }
  return Date.now()
}

/** Human-readable message for anything thrown or posted by a worker. */
function ontologyJobErrorMessage(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

function ontologyJobClampInteger(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const floored = Math.floor(number)
  if (floored < minimum) return minimum
  if (floored > maximum) return maximum
  return floored
}

/** Merge caller limits with the design's initial budgets. */
function ontologyJobNormalizeLimits(limits) {
  const input = limits && typeof limits === 'object' ? limits : {}
  return {
    maxTriples: ontologyJobClampInteger(input.maxTriples, ONTOLOGY_JOB_DEFAULT_LIMITS.maxTriples, 1, 1000000),
    maxNodes: ontologyJobClampInteger(input.maxNodes, ONTOLOGY_JOB_DEFAULT_LIMITS.maxNodes, 1, 100000),
    maxEdges: ontologyJobClampInteger(input.maxEdges, ONTOLOGY_JOB_DEFAULT_LIMITS.maxEdges, 0, 1000000),
    maxLiteralsPerNode: ontologyJobClampInteger(input.maxLiteralsPerNode, ONTOLOGY_JOB_DEFAULT_LIMITS.maxLiteralsPerNode, 0, 100000),
    maxLiteralLength: ontologyJobClampInteger(input.maxLiteralLength, ONTOLOGY_JOB_DEFAULT_LIMITS.maxLiteralLength, 1, 10000000),
    maxDepth: ontologyJobClampInteger(input.maxDepth, ONTOLOGY_JOB_DEFAULT_LIMITS.maxDepth, 1, 100000),
  }
}

/** Tighten a normalized limit set for the main-thread degraded path. */
function ontologyJobDegradedLimits(limits) {
  const normalized = ontologyJobNormalizeLimits(limits)
  return {
    maxTriples: Math.min(normalized.maxTriples, ONTOLOGY_JOB_DEGRADED_LIMITS.maxTriples),
    maxNodes: Math.min(normalized.maxNodes, ONTOLOGY_JOB_DEGRADED_LIMITS.maxNodes),
    maxEdges: Math.min(normalized.maxEdges, ONTOLOGY_JOB_DEGRADED_LIMITS.maxEdges),
    maxLiteralsPerNode: normalized.maxLiteralsPerNode,
    maxLiteralLength: normalized.maxLiteralLength,
    maxDepth: normalized.maxDepth,
  }
}

/** Merge layout options (top-level `seed` wins over `layout.seed`). */
function ontologyJobNormalizeLayout(layout, extra) {
  const input = layout && typeof layout === 'object' ? layout : {}
  const fallback = extra && typeof extra === 'object' ? extra : {}
  const defaultSeed = Number.isFinite(input.seed)
    ? input.seed
    : (Number.isFinite(fallback.seed) ? fallback.seed : ONTOLOGY_JOB_DEFAULT_LAYOUT.seed)
  return {
    width: Math.max(1, typeof input.width === 'number' && Number.isFinite(input.width) ? input.width : ONTOLOGY_JOB_DEFAULT_LAYOUT.width),
    height: Math.max(1, typeof input.height === 'number' && Number.isFinite(input.height) ? input.height : ONTOLOGY_JOB_DEFAULT_LAYOUT.height),
    seed: Math.floor(defaultSeed) >>> 0,
    iterations: ontologyJobClampInteger(input.iterations, ONTOLOGY_JOB_DEFAULT_LAYOUT.iterations, 0, 2000),
  }
}

/** Resolve the embedded worker source, or '' when the build did not embed one. */
function ontologyJobWorkerSource(explicit) {
  if (typeof explicit === 'string' && explicit) return explicit
  try {
    // In the Client bundle this is a const declared in the factory closure.
    // In Node it is an undeclared identifier, and `typeof` is safe for that.
    if (typeof ONTOLOGY_WORKER_SOURCE === 'string' && ONTOLOGY_WORKER_SOURCE) return ONTOLOGY_WORKER_SOURCE
  } catch (error) {
    // ignored: no embedded worker source in this context
  }
  try {
    if (typeof globalThis === 'object' && globalThis &&
      typeof globalThis.ONTOLOGY_WORKER_SOURCE === 'string' && globalThis.ONTOLOGY_WORKER_SOURCE) {
      return globalThis.ONTOLOGY_WORKER_SOURCE
    }
  } catch (error) {
    // ignored
  }
  return ''
}

/**
 * Resolve the parse/build/layout implementations.
 *
 * In the bundled Client module the earlier concatenated modules provide the
 * identifiers; Node tests pass them through `impl`. Missing pieces stay null so
 * the caller can fall back or report an error instead of throwing a
 * ReferenceError.
 */
function ontologyJobImpls(override) {
  const provided = override && typeof override === 'object' ? override : {}
  const resolved = {
    parseOntology: null,
    buildGraph: null,
    layoutGraph: null,
    createLayoutTask: null,
    createWorkspace: null,
    addSource: null,
    removeSource: null,
    replaceSource: null,
    workspaceAdmission: null,
    composeWorkspaceGraph: null,
    identity: provided.identity || null,
  }
  const names = [
    'parseOntology', 'buildGraph', 'layoutGraph', 'createLayoutTask',
    'createWorkspace', 'addSource', 'removeSource', 'replaceSource',
    'workspaceAdmission', 'composeWorkspaceGraph',
  ]
  // Resolve the concatenated Client bundle's function declarations without
  // eval (CSP-safe). `typeof` on an undeclared identifier is safe.
  const globalResolvers = {
    parseOntology: function () { return typeof parseOntology === 'function' ? parseOntology : null },
    buildGraph: function () { return typeof buildGraph === 'function' ? buildGraph : null },
    layoutGraph: function () { return typeof layoutGraph === 'function' ? layoutGraph : null },
    createLayoutTask: function () { return typeof createLayoutTask === 'function' ? createLayoutTask : null },
    createWorkspace: function () { return typeof createWorkspace === 'function' ? createWorkspace : null },
    addSource: function () { return typeof addSource === 'function' ? addSource : null },
    removeSource: function () { return typeof removeSource === 'function' ? removeSource : null },
    replaceSource: function () { return typeof replaceSource === 'function' ? replaceSource : null },
    workspaceAdmission: function () {
      return typeof workspaceAdmission === 'function' ? workspaceAdmission : null
    },
    composeWorkspaceGraph: function () {
      return typeof composeWorkspaceGraph === 'function' ? composeWorkspaceGraph : null
    },
  }
  for (const name of names) {
    if (typeof provided[name] === 'function') {
      resolved[name] = provided[name]
      continue
    }
    try {
      const candidate = globalResolvers[name]()
      if (typeof candidate === 'function') resolved[name] = candidate
    } catch (error) {
      // helper not available in this scope
    }
  }
  return resolved
}

/** Is the Worker route usable with the current configuration? */
function ontologyJobWorkerEnabled(options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.forceMainThread) return false
  if (opts.workerFactory) return true
  if (!ontologyJobWorkerSource(opts.workerSource)) return false
  if (typeof Worker !== 'function' || typeof Blob !== 'function') return false
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  } catch (error) {
    return false
  }
  return true
}

/** Default scheduler: requestIdleCallback when available, else setTimeout(0). */
function ontologyJobDefaultScheduler(callback) {
  if (typeof requestIdleCallback === 'function') {
    let idleHandle = null
    try {
      idleHandle = requestIdleCallback(function () { callback() }, { timeout: 100 })
    } catch (error) {
      idleHandle = null
    }
    if (idleHandle !== null && idleHandle !== undefined) {
      return function () {
        try {
          if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
        } catch (error) {
          // ignored
        }
      }
    }
  }
  const timer = setTimeout(callback, 0)
  return function () { clearTimeout(timer) }
}

/** Run one yielded scheduler tick; a broken custom scheduler degrades to a timer. */
function ontologyJobNextTick(scheduler) {
  return new Promise(function (resolve) {
    const schedule = typeof scheduler === 'function' ? scheduler : ontologyJobDefaultScheduler
    try {
      schedule(resolve)
    } catch (error) {
      setTimeout(resolve, 0)
    }
  })
}

/** Normalize a layout point list to the `[{ id, x, y }]` view contract. */
function ontologyJobNormalizePositions(positions) {
  if (!Array.isArray(positions)) return []
  const normalized = []
  for (let index = 0; index < positions.length; index += 1) {
    const point = positions[index]
    if (!point || typeof point !== 'object' || point.id === undefined || point.id === null) continue
    normalized.push({
      id: String(point.id),
      x: typeof point.x === 'number' && Number.isFinite(point.x) ? point.x : 0,
      y: typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : 0,
    })
  }
  return normalized
}

/** Rebuild `[{ id, x, y }]` from the worker's transferable x/y pair array. */
function ontologyJobDecodePositions(graph, packed) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : []
  if (!packed || typeof packed.length !== 'number') return []
  const count = Math.min(nodes.length, Math.floor(packed.length / 2))
  const positions = []
  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]
    positions.push({
      id: node && typeof node.id === 'string' ? node.id : 'n' + index,
      x: Number.isFinite(packed[index * 2]) ? packed[index * 2] : 0,
      y: Number.isFinite(packed[index * 2 + 1]) ? packed[index * 2 + 1] : 0,
    })
  }
  return positions
}

/** Neutral result shape; never null in any field a caller may read. */
function ontologyJobResultBase(degraded) {
  return {
    status: 'error',
    graph: null,
    positions: null,
    diagnostics: [],
    stats: null,
    truncation: null,
    base: '',
    baseSource: 'none',
    prefixes: {},
    timing: { parse: 0, build: 0, layout: 0, total: 0 },
    degraded: !!degraded,
  }
}

/** Wrap the runtime worker in a stable `{ worker, release }` handle. */
function ontologyJobNormalizeWorkerHandle(created) {
  if (!created || typeof created !== 'object') throw new Error('worker factory did not return a worker')
  const worker = created.worker && typeof created.worker === 'object' ? created.worker : created
  if (typeof worker.postMessage !== 'function') throw new Error('worker has no postMessage')
  const release = typeof created.release === 'function'
    ? created.release
    : function () {
      try {
        if (typeof worker.terminate === 'function') worker.terminate()
      } catch (error) {
        // ignored
      }
    }
  return { worker: worker, release: release }
}

/** Create the runtime worker from the embedded source (classic Blob worker). */
function ontologyJobCreateDefaultWorker(source) {
  const blob = new Blob([source], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  let worker = null
  try {
    worker = new Worker(url)
  } catch (error) {
    try { URL.revokeObjectURL(url) } catch (revokeError) { /* ignored */ }
    throw error
  }
  return {
    worker: worker,
    release: function () {
      try { worker.terminate() } catch (error) { /* ignored */ }
      try { URL.revokeObjectURL(url) } catch (error) { /* ignored */ }
    },
  }
}

/** Create a worker handle from an injected factory or the embedded source. */
function ontologyJobCreateWorker(settings) {
  const config = settings && typeof settings === 'object' ? settings : {}
  let created = null
  if (typeof config.workerFactory === 'function') {
    created = config.workerFactory()
  } else if (config.workerFactory && typeof config.workerFactory === 'object') {
    created = config.workerFactory
  } else {
    created = ontologyJobCreateDefaultWorker(ontologyJobWorkerSource(config.workerSource))
  }
  return ontologyJobNormalizeWorkerHandle(created)
}

/**
 * Send one request to a worker and wait for its terminal protocol message.
 *
 * The helper only handles message routing / timeout / error plumbing; it never
 * terminates the worker. Ownership stays with the caller so the runner can
 * keep the worker alive for `relayout`.
 *
 * `settings.onMessage(data)` returns truthy to settle the request.
 * `settings.onFailure(reason)` fires on construction/transport/timeout errors.
 *
 * @returns {{cancel: Function}|null} a control handle whose `cancel()` clears
 *   the timeout and detaches the handlers without invoking `onFailure`. The
 *   caller must call it when a job is cancelled/aborted so an abandoned request
 *   cannot keep a timer (and the event loop) alive.
 */
function ontologyJobSendWorkerMessage(handle, message, settings) {
  const worker = handle && handle.worker ? handle.worker : null
  const config = settings && typeof settings === 'object' ? settings : {}
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : ONTOLOGY_JOB_WORKER_TIMEOUT
  const isCancelled = typeof config.isCancelled === 'function' ? config.isCancelled : function () { return false }
  if (!worker || typeof worker.postMessage !== 'function') {
    if (typeof config.onFailure === 'function') config.onFailure('worker is not usable')
    return null
  }
  let settled = false
  let timer = null
  function detach() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    try { worker.onmessage = null } catch (error) { /* ignored */ }
    try { worker.onerror = null } catch (error) { /* ignored */ }
  }
  function settle() {
    if (settled) return false
    settled = true
    detach()
    return true
  }
  worker.onmessage = function (event) {
    if (settled) return
    if (isCancelled()) { settle(); return }
    const data = event && event.data ? event.data : null
    if (!data || typeof data !== 'object' || data.id !== config.id) return
    let done = false
    try {
      done = !!config.onMessage(data)
    } catch (error) {
      if (settle() && typeof config.onFailure === 'function') config.onFailure(ontologyJobErrorMessage(error))
      return
    }
    if (done) settle()
  }
  worker.onerror = function (event) {
    if (settled) return
    if (isCancelled()) { settle(); return }
    const reason = event && (event.message || event.error) ? (event.message || event.error) : 'worker error'
    if (settle() && typeof config.onFailure === 'function') config.onFailure(ontologyJobErrorMessage(reason))
  }
  timer = setTimeout(function () {
    if (settled) return
    if (isCancelled()) { settle(); return }
    if (settle() && typeof config.onFailure === 'function') {
      config.onFailure('worker timed out after ' + timeoutMs + 'ms')
    }
  }, timeoutMs)
  try {
    worker.postMessage(message)
  } catch (error) {
    if (settle() && typeof config.onFailure === 'function') config.onFailure(ontologyJobErrorMessage(error))
  }
  return { cancel: function () { settle() } }
}

/**
 * Run a layout to completion in yielded chunks.
 *
 * `createLayoutTask` (from graph-model) is used when available; otherwise the
 * one-shot layoutGraph runs inside one chunk. A task that throws mid-flight
 * falls back to one-shot layout rather than losing the whole result.
 *
 * @returns {Promise<{positions: any[], timing: number, cancelled?: boolean}>}
 */
async function ontologyJobSteppedLayout(graph, layoutOptions, settings) {
  const config = settings && typeof settings === 'object' ? settings : {}
  const impls = config.impls && typeof config.impls === 'object' ? config.impls : {}
  const layoutGraphFn = typeof impls.layoutGraph === 'function' ? impls.layoutGraph : null
  const createLayoutTaskFn = typeof impls.createLayoutTask === 'function' ? impls.createLayoutTask : null
  const scheduler = config.scheduler
  const isCancelled = typeof config.isCancelled === 'function' ? config.isCancelled : function () { return false }
  const onProgress = typeof config.onProgress === 'function' ? config.onProgress : function () {}
  const started = ontologyJobNow()

  await ontologyJobNextTick(scheduler)
  if (isCancelled()) return { positions: [], timing: ontologyJobNow() - started, cancelled: true }

  if (typeof createLayoutTaskFn !== 'function') {
    if (!layoutGraphFn) throw new Error('layout implementation unavailable')
    const positions = ontologyJobNormalizePositions(layoutGraphFn(graph, layoutOptions))
    return { positions: positions, timing: ontologyJobNow() - started }
  }

  let task = null
  try {
    task = createLayoutTaskFn(graph, layoutOptions)
  } catch (error) {
    task = null
  }
  if (!task || typeof task.step !== 'function' || typeof task.result !== 'function') {
    if (!layoutGraphFn) throw new Error('layout implementation unavailable')
    const positions = ontologyJobNormalizePositions(layoutGraphFn(graph, layoutOptions))
    return { positions: positions, timing: ontologyJobNow() - started }
  }

  let lastProgress = -1
  try {
    for (let guard = 0; guard < ONTOLOGY_JOB_MAX_STEPS; guard += 1) {
      if (isCancelled()) {
        try { if (typeof task.cancel === 'function') task.cancel() } catch (cancelError) { /* ignored */ }
        return { positions: [], timing: ontologyJobNow() - started, cancelled: true }
      }
      const state = task.step(8)
      const progress = state && typeof state.progress === 'number' && Number.isFinite(state.progress)
        ? state.progress
        : null
      if (progress !== null && progress - lastProgress >= 0.1) {
        lastProgress = progress
        onProgress(progress)
      }
      const result = task.result()
      if (result) {
        onProgress(1)
        return { positions: ontologyJobNormalizePositions(result), timing: ontologyJobNow() - started }
      }
      if (state && state.done) {
        const doneResult = task.result()
        if (doneResult) {
          onProgress(1)
          return { positions: ontologyJobNormalizePositions(doneResult), timing: ontologyJobNow() - started }
        }
        throw new Error('layout task finished without positions')
      }
      await ontologyJobNextTick(scheduler)
    }
    throw new Error('layout task did not finish')
  } catch (error) {
    if (isCancelled()) return { positions: [], timing: ontologyJobNow() - started, cancelled: true }
    if (!layoutGraphFn) throw error
    // Last-resort one-shot layout: a broken chunked task must not lose the graph.
    const positions = ontologyJobNormalizePositions(layoutGraphFn(graph, layoutOptions))
    return { positions: positions, timing: ontologyJobNow() - started }
  }
}

/**
 * Main-thread compute: synchronous parse + buildGraph, then chunked layout.
 *
 * Settings: { impls, scheduler, generation, degraded, isCancelled, emitState,
 *             onGraph(meta), onLayout(positions, timing) }
 */
async function ontologyJobComputeMainThread(source, settings) {
  const config = settings && typeof settings === 'object' ? settings : {}
  const impls = config.impls && typeof config.impls === 'object' ? config.impls : {}
  const generation = config.generation || 1
  const degraded = !!config.degraded
  const emitState = typeof config.emitState === 'function' ? config.emitState : function () {}
  const isCancelled = typeof config.isCancelled === 'function' ? config.isCancelled : function () { return false }
  const scheduler = config.scheduler
  const startedAt = ontologyJobNow()
  const input = source && typeof source === 'object' ? source : {}
  const text = typeof input.text === 'string' ? input.text : ''
  const resourceAddress = typeof input.resourceAddress === 'string' ? input.resourceAddress : ''
  const displayName = typeof input.displayName === 'string' ? input.displayName : ''

  function cancelledResult() {
    const result = ontologyJobResultBase(degraded)
    result.cancelled = true
    result.message = 'cancelled'
    result.generation = generation
    return result
  }
  function errorResult(message) {
    const result = ontologyJobResultBase(degraded)
    result.message = message
    result.generation = generation
    return result
  }

  emitState('parsing', { degraded: degraded })
  await ontologyJobNextTick(scheduler)
  if (isCancelled()) return cancelledResult()

  const parseFn = impls.parseOntology
  const buildFn = impls.buildGraph
  if (typeof parseFn !== 'function' || typeof buildFn !== 'function') {
    const message = 'RDF parser or graph model is unavailable'
    emitState('error', { degraded: degraded, message: message })
    return errorResult(message)
  }

  const limits = degraded ? ontologyJobDegradedLimits(input.limits) : ontologyJobNormalizeLimits(input.limits)
  const layoutOptions = ontologyJobNormalizeLayout(input.layout, { seed: input.seed })
  const timing = { parse: 0, build: 0, layout: 0 }

  const parseStartedAt = ontologyJobNow()
  let parsed = null
  try {
    parsed = parseFn(text, {
      resourceAddress: resourceAddress || undefined,
      fileName: displayName || undefined,
      maxTriples: limits.maxTriples,
      maxLiteralLength: limits.maxLiteralLength,
      maxDepth: limits.maxDepth,
    })
  } catch (error) {
    const message = 'parse failed: ' + ontologyJobErrorMessage(error)
    emitState('error', { degraded: degraded, message: message })
    return errorResult(message)
  }
  timing.parse = ontologyJobNow() - parseStartedAt
  if (!parsed || typeof parsed !== 'object') parsed = {}
  if (isCancelled()) return cancelledResult()

  emitState('modeling', { degraded: degraded })
  await ontologyJobNextTick(scheduler)
  if (isCancelled()) return cancelledResult()

  const buildStartedAt = ontologyJobNow()
  let graph = null
  try {
    graph = buildFn(parsed, {
      maxNodes: limits.maxNodes,
      maxEdges: limits.maxEdges,
      maxLiteralsPerNode: limits.maxLiteralsPerNode,
      maxLiteralLength: limits.maxLiteralLength,
      source: {
        address: resourceAddress,
        displayName: displayName,
        format: typeof parsed.format === 'string' ? parsed.format : '',
      },
    })
  } catch (error) {
    const message = 'graph build failed: ' + ontologyJobErrorMessage(error)
    emitState('error', { degraded: degraded, message: message })
    return errorResult(message)
  }
  timing.build = ontologyJobNow() - buildStartedAt
  if (!graph || typeof graph !== 'object') graph = { nodes: [], edges: [], stats: {}, warnings: [] }
  if (isCancelled()) return cancelledResult()

  const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
  const truncation = stats.truncation && typeof stats.truncation === 'object' ? stats.truncation : null
  const meta = {
    graph: graph,
    base: typeof parsed.base === 'string' ? parsed.base : '',
    baseSource: typeof parsed.baseSource === 'string' ? parsed.baseSource : 'none',
    prefixes: parsed.prefixes && typeof parsed.prefixes === 'object' ? parsed.prefixes : {},
    diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [],
    stats: stats,
    truncation: truncation,
    timing: { parse: timing.parse, build: timing.build },
  }
  if (typeof config.onGraph === 'function') config.onGraph(meta)

  emitState('layout', { degraded: degraded })
  let outcome = null
  try {
    outcome = await ontologyJobSteppedLayout(graph, layoutOptions, {
      impls: impls,
      scheduler: scheduler,
      isCancelled: isCancelled,
      onProgress: function (progress) {
        emitState('layout', { degraded: degraded, progress: progress })
      },
    })
  } catch (error) {
    if (isCancelled()) return cancelledResult()
    const message = 'layout failed: ' + ontologyJobErrorMessage(error)
    emitState('error', { degraded: degraded, message: message })
    return errorResult(message)
  }
  if (!outcome || outcome.cancelled || isCancelled()) return cancelledResult()
  timing.layout = typeof outcome.timing === 'number' && Number.isFinite(outcome.timing) ? outcome.timing : 0
  const positions = outcome.positions
  if (typeof config.onLayout === 'function') config.onLayout(positions, { layout: timing.layout })
  emitState('ready', { degraded: degraded })

  const result = ontologyJobResultBase(degraded)
  result.status = 'ready'
  result.graph = graph
  result.positions = positions
  result.diagnostics = meta.diagnostics
  result.stats = stats
  result.truncation = truncation
  result.base = meta.base
  result.baseSource = meta.baseSource
  result.prefixes = meta.prefixes
  result.timing = {
    parse: timing.parse,
    build: timing.build,
    layout: timing.layout,
    total: ontologyJobNow() - startedAt,
  }
  result.generation = generation
  return result
}

/**
 * Low-level one-shot compute.
 *
 * @param {{text?: string, resourceAddress?: string, displayName?: string,
 *          limits?: object, layout?: object, seed?: number}} input
 * @param {{signal?: AbortSignal, onState?: Function, workerFactory?: Function|object,
 *          forceMainThread?: boolean, scheduler?: Function, impl?: object,
 *          workerSource?: string, workerTimeoutMs?: number}} [options]
 * @returns {Promise<object>} `{ status, graph, positions, diagnostics, stats,
 *          truncation, base, baseSource, prefixes, timing, degraded }`
 */
export async function computeOntology(input, options) {
  const source = input && typeof input === 'object' ? input : {}
  const opts = options && typeof options === 'object' ? options : {}
  const generation = 1
  const signal = opts.signal
  const impls = ontologyJobImpls(opts.impl)
  const degradedSettings = function (emit) {
    return {
      impls: impls,
      scheduler: opts.scheduler,
      generation: generation,
      degraded: true,
      isCancelled: function () { return !!(signal && signal.aborted) },
      emitState: emit,
    }
  }
  const emitState = function (status, extra) {
    if (typeof opts.onState !== 'function') return
    const event = { type: 'state', status: status, generation: generation, degraded: !!(extra && extra.degraded) }
    if (extra && typeof extra.message === 'string') event.message = extra.message
    if (extra && typeof extra.progress === 'number' && Number.isFinite(extra.progress)) event.progress = extra.progress
    try { opts.onState(event) } catch (error) { /* never let a consumer callback break the job */ }
  }

  if (signal && signal.aborted) {
    const result = ontologyJobResultBase(false)
    result.cancelled = true
    result.message = 'cancelled'
    return result
  }

  if (!ontologyJobWorkerEnabled(opts)) {
    return ontologyJobComputeMainThread(source, degradedSettings(emitState))
  }

  let handle = null
  try {
    handle = ontologyJobCreateWorker({ workerFactory: opts.workerFactory, workerSource: opts.workerSource })
  } catch (error) {
    emitState('parsing', { degraded: true, message: 'Background compute unavailable: ' + ontologyJobErrorMessage(error) })
    return ontologyJobComputeMainThread(source, degradedSettings(emitState))
  }

  const timeoutMs = Number.isFinite(opts.workerTimeoutMs) && opts.workerTimeoutMs > 0
    ? opts.workerTimeoutMs
    : ONTOLOGY_JOB_WORKER_TIMEOUT
  const limits = ontologyJobNormalizeLimits(source.limits)
  const layoutOptions = ontologyJobNormalizeLayout(source.layout, { seed: source.seed })
  emitState('parsing', { degraded: false })

  let request = null
  const outcome = await new Promise(function (resolve) {
    let settled = false
    let meta = null
    function finish(value) {
      if (settled) return
      settled = true
      try { if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort) } catch (error) { /* ignored */ }
      resolve(value)
    }
    function onAbort() {
      finish({ result: (function () { const cancelled = ontologyJobResultBase(false); cancelled.cancelled = true; cancelled.message = 'cancelled'; return cancelled })() })
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
    request = ontologyJobSendWorkerMessage(handle, {
      type: 'compute',
      id: generation,
      text: typeof source.text === 'string' ? source.text : '',
      resourceAddress: typeof source.resourceAddress === 'string' ? source.resourceAddress : '',
      displayName: typeof source.displayName === 'string' ? source.displayName : '',
      limits: limits,
      layout: layoutOptions,
    }, {
      id: generation,
      timeoutMs: timeoutMs,
      isCancelled: function () { return settled || !!(signal && signal.aborted) },
      onMessage: function (data) {
        if (data.type === 'graph') {
          meta = {
            graph: data.graph || null,
            base: typeof data.base === 'string' ? data.base : '',
            baseSource: typeof data.baseSource === 'string' ? data.baseSource : 'none',
            prefixes: data.prefixes && typeof data.prefixes === 'object' ? data.prefixes : {},
            diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
            stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
            truncation: data.truncation && typeof data.truncation === 'object' ? data.truncation : null,
            timing: data.timing && typeof data.timing === 'object' ? data.timing : {},
          }
          emitState('layout', { degraded: false })
          return false
        }
        if (data.type === 'layout') {
          const positions = ontologyJobDecodePositions(meta ? meta.graph : null, data.positions)
          const result = ontologyJobResultBase(false)
          result.status = 'ready'
          result.graph = meta ? meta.graph : null
          result.positions = positions
          result.diagnostics = meta ? meta.diagnostics : []
          result.stats = meta ? meta.stats : null
          result.truncation = meta ? meta.truncation : null
          result.base = meta ? meta.base : ''
          result.baseSource = meta ? meta.baseSource : 'none'
          result.prefixes = meta ? meta.prefixes : {}
          const workerTiming = meta && meta.timing && typeof meta.timing === 'object' ? meta.timing : {}
          const parseTime = Number.isFinite(workerTiming.parse) ? workerTiming.parse : 0
          const buildTime = Number.isFinite(workerTiming.build) ? workerTiming.build : 0
          const layoutTime = Number.isFinite(workerTiming.layout) ? workerTiming.layout : 0
          result.timing = { parse: parseTime, build: buildTime, layout: layoutTime, total: parseTime + buildTime + layoutTime }
          finish({ result: result })
          return true
        }
        if (data.type === 'error') {
          const result = ontologyJobResultBase(false)
          result.message = typeof data.message === 'string' && data.message ? data.message : 'worker error'
          finish({ result: result })
          return true
        }
        return false
      },
      onFailure: function (reason) {
        finish({ fallback: true, reason: reason })
      },
    })
  })

  if (request && typeof request.cancel === 'function') {
    try { request.cancel() } catch (error) { /* ignored */ }
  }
  try { if (handle) handle.release() } catch (error) { /* ignored */ }

  if (outcome && outcome.fallback) {
    emitState('parsing', { degraded: true, message: 'Background compute unavailable: ' + outcome.reason })
    return ontologyJobComputeMainThread(source, degradedSettings(emitState))
  }
  const result = outcome && outcome.result ? outcome.result : ontologyJobResultBase(false)
  if (result.cancelled) return result
  if (result.status === 'ready') {
    emitState('ready', { degraded: false })
  } else {
    emitState('error', { degraded: false, message: result.message })
  }
  return result
}

/**
 * Stateful runner used by the UI.
 *
 * @param {{onEvent?: Function, workerFactory?: Function|object, workerSource?: string,
 *          scheduler?: Function, impl?: object, workerTimeoutMs?: number,
 *          forceMainThread?: boolean}} [handlers]
 * @returns {{submit: Function, relayout: Function, cancel: Function, dispose: Function}}
 *
 * Events:
 *   { type:'state', status:'parsing'|'modeling'|'layout'|'ready'|'error',
 *     generation, degraded?, message?, progress? }
 *   { type:'graph', generation, graph, base, baseSource, prefixes, diagnostics,
 *     stats, truncation, timing, degraded }
 *   { type:'layout', generation, positions, timing, degraded }
 *   { type:'error', generation, message, degraded }
 */
export function createOntologyRunner(handlers) {
  const config = handlers && typeof handlers === 'object' ? handlers : {}
  const onEvent = typeof config.onEvent === 'function' ? config.onEvent : function () {}
  const impls = ontologyJobImpls(config.impl)
  const workerFactory = config.workerFactory
  const workerSource = config.workerSource
  const scheduler = config.scheduler
  const timeoutMs = Number.isFinite(config.workerTimeoutMs) && config.workerTimeoutMs > 0
    ? config.workerTimeoutMs
    : ONTOLOGY_JOB_WORKER_TIMEOUT
  const forceMainThread = !!config.forceMainThread

  let generation = 0
  let activeJob = null
  let activeWorker = null
  let lastGraph = null
  let lastMeta = null
  let fallbackUsed = false
  let layoutSeq = 0
  let disposed = false
  /** Local L0 workspace (source records + parsed statements). */
  let workspaceState = null
  /** Pending workspace request handle (parse/compose). */
  let workspaceRequest = null
  /**
   * One background worker for the whole workspace session: parse-source fills
   * its cache and compose reuses it, so switching views never re-parses and a
   * source is never sent twice. Released on failure and disposal.
   */
  let workspaceWorker = null

  function emitEvent(event) {
    if (disposed) return
    try { onEvent(event) } catch (error) { /* consumer callback errors must not break the job */ }
  }

  function releaseActiveWorker() {
    const current = activeWorker
    activeWorker = null
    if (!current) return
    if (current.request && typeof current.request.cancel === 'function') {
      try { current.request.cancel() } catch (error) { /* ignored */ }
    }
    try { current.handle.release() } catch (error) { /* ignored */ }
  }

  function isJobCurrent(job) {
    return !!job && !job.cancelled && job === activeJob && !disposed
  }

  function emitState(job, status, extra) {
    if (!isJobCurrent(job)) return
    const event = {
      type: 'state',
      status: status,
      generation: job.generation,
      degraded: !!(extra && extra.degraded),
    }
    if (extra && typeof extra.message === 'string' && extra.message) event.message = extra.message
    if (extra && typeof extra.progress === 'number' && Number.isFinite(extra.progress)) event.progress = extra.progress
    emitEvent(event)
  }

  /** Main-thread job used both for "no Worker" and after a worker failure. */
  function runMainThreadJob(job, source) {
    const settings = {
      impls: impls,
      scheduler: scheduler,
      generation: job.generation,
      degraded: true,
      isCancelled: function () { return !isJobCurrent(job) },
      emitState: function (status, extra) { emitState(job, status, extra) },
      onGraph: function (meta) {
        if (!isJobCurrent(job)) return
        job.graph = meta.graph
        lastGraph = meta.graph
        lastMeta = meta
        emitEvent({
          type: 'graph',
          generation: job.generation,
          graph: meta.graph,
          base: meta.base,
          baseSource: meta.baseSource,
          prefixes: meta.prefixes,
          diagnostics: meta.diagnostics,
          stats: meta.stats,
          truncation: meta.truncation,
          timing: meta.timing,
          degraded: true,
        })
      },
      onLayout: function (positions, timing) {
        if (!isJobCurrent(job)) return
        job.settled = true
        emitEvent({
          type: 'layout',
          generation: job.generation,
          positions: positions,
          timing: timing,
          degraded: true,
        })
      },
    }
    ontologyJobComputeMainThread(source, settings).then(function (result) {
      if (!isJobCurrent(job)) return
      if (result && result.status !== 'ready' && !result.cancelled) {
        emitEvent({ type: 'error', generation: job.generation, message: result.message || 'compute failed', degraded: true })
      }
    }).catch(function (error) {
      if (!isJobCurrent(job)) return
      const message = ontologyJobErrorMessage(error)
      emitEvent({ type: 'state', status: 'error', generation: job.generation, degraded: true, message: message })
      emitEvent({ type: 'error', generation: job.generation, message: message, degraded: true })
    })
  }

  /** Fall back to the degraded main-thread path once per runner. */
  function fallbackToMainThread(job, source, reason) {
    if (!isJobCurrent(job)) return
    releaseActiveWorker()
    fallbackUsed = true
    emitState(job, 'parsing', { degraded: true, message: 'Background compute unavailable: ' + reason })
    runMainThreadJob(job, source)
  }

  /** Worker compute for one submit; the worker stays alive for relayout. */
  function startWorkerJob(job, source) {
    const handle = ontologyJobCreateWorker({ workerFactory: workerFactory, workerSource: workerSource })
    const workerRecord = { handle: handle, id: job.generation, request: null }
    activeWorker = workerRecord
    const id = job.generation
    const limits = ontologyJobNormalizeLimits(source.limits)
    const layoutOptions = ontologyJobNormalizeLayout(source.layout, { seed: source.seed })
    workerRecord.request = ontologyJobSendWorkerMessage(handle, {
      type: 'compute',
      id: id,
      text: typeof source.text === 'string' ? source.text : '',
      resourceAddress: typeof source.resourceAddress === 'string' ? source.resourceAddress : '',
      displayName: typeof source.displayName === 'string' ? source.displayName : '',
      limits: limits,
      layout: layoutOptions,
    }, {
      id: id,
      timeoutMs: timeoutMs,
      isCancelled: function () { return !isJobCurrent(job) },
      onMessage: function (data) {
        if (!isJobCurrent(job)) return true
        if (data.type === 'graph') {
          job.graph = data.graph || null
          lastGraph = data.graph || null
          lastMeta = {
            base: typeof data.base === 'string' ? data.base : '',
            baseSource: typeof data.baseSource === 'string' ? data.baseSource : 'none',
            prefixes: data.prefixes && typeof data.prefixes === 'object' ? data.prefixes : {},
            diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
            stats: data.stats && typeof data.stats === 'object' ? data.stats : {},
            truncation: data.truncation && typeof data.truncation === 'object' ? data.truncation : null,
          }
          emitEvent({
            type: 'graph',
            generation: id,
            graph: job.graph,
            base: lastMeta.base,
            baseSource: lastMeta.baseSource,
            prefixes: lastMeta.prefixes,
            diagnostics: lastMeta.diagnostics,
            stats: lastMeta.stats,
            truncation: lastMeta.truncation,
            timing: data.timing && typeof data.timing === 'object' ? data.timing : {},
            degraded: false,
          })
          emitState(job, 'layout', { degraded: false })
          return false
        }
        if (data.type === 'layout') {
          const positions = ontologyJobDecodePositions(job.graph || lastGraph, data.positions)
          job.settled = true
          emitEvent({
            type: 'layout',
            generation: id,
            positions: positions,
            timing: data.timing && typeof data.timing === 'object' ? data.timing : { layout: 0 },
            degraded: false,
          })
          emitState(job, 'ready', { degraded: false })
          return true
        }
        if (data.type === 'error') {
          releaseActiveWorker()
          const message = typeof data.message === 'string' && data.message ? data.message : 'worker error'
          job.settled = true
          emitState(job, 'error', { degraded: false, message: message })
          emitEvent({ type: 'error', generation: id, message: message, degraded: false })
          return true
        }
        return false
      },
      onFailure: function (reason) {
        fallbackToMainThread(job, source, reason)
      },
    })
  }

  function cancelActiveJob() {
    const job = activeJob
    activeJob = null
    layoutSeq += 1
    releaseActiveWorker()
    if (job) job.cancelled = true
  }

  function submit(input) {
    if (disposed) return generation
    if (activeJob) cancelActiveJob()
    generation += 1
    const source = input && typeof input === 'object' ? input : {}
    const job = { generation: generation, cancelled: false, settled: false, graph: null }
    activeJob = job
    layoutSeq += 1
    const useWorker = ontologyJobWorkerEnabled({
      workerFactory: workerFactory,
      workerSource: workerSource,
      forceMainThread: forceMainThread,
    })
    const degraded = fallbackUsed || !useWorker
    emitState(job, 'parsing', { degraded: degraded })
    if (useWorker && !fallbackUsed) {
      try {
        startWorkerJob(job, source)
      } catch (error) {
        fallbackToMainThread(job, source, ontologyJobErrorMessage(error))
      }
    } else {
      runMainThreadJob(job, source)
    }
    return generation
  }

  /** Relayout the current graph (worker cache or main-thread cached graph). */
  function relayout(request) {
    if (disposed || !lastGraph || !activeJob || !activeJob.settled) return
    const dimensions = ontologyJobNormalizeLayout(request)
    layoutSeq += 1
    const token = layoutSeq
    const job = activeJob
    const cancelled = function () { return disposed || token !== layoutSeq }
    if (activeWorker && !fallbackUsed) {
      const worker = activeWorker
      if (worker.request && typeof worker.request.cancel === 'function') {
        try { worker.request.cancel() } catch (error) { /* ignored */ }
      }
      emitState(job, 'layout', { degraded: false })
      worker.request = ontologyJobSendWorkerMessage(worker.handle, {
        type: 'relayout',
        id: worker.id,
        width: dimensions.width,
        height: dimensions.height,
        seed: dimensions.seed,
        iterations: dimensions.iterations,
      }, {
        id: worker.id,
        timeoutMs: timeoutMs,
        isCancelled: cancelled,
        onMessage: function (data) {
          if (cancelled()) return true
          if (data.type === 'layout') {
            const positions = ontologyJobDecodePositions(lastGraph, data.positions)
            emitEvent({
              type: 'layout',
              generation: generation,
              positions: positions,
              timing: data.timing && typeof data.timing === 'object' ? data.timing : { layout: 0 },
              degraded: false,
            })
            emitState(job, 'ready', { degraded: false })
            return true
          }
          if (data.type === 'error') {
            releaseActiveWorker()
            fallbackUsed = true
            emitState(job, 'layout', { degraded: true })
            runMainThreadRelayout(job, token, dimensions)
            return true
          }
          return false
        },
        onFailure: function () {
          if (cancelled()) return
          releaseActiveWorker()
          fallbackUsed = true
          emitState(job, 'layout', { degraded: true })
          runMainThreadRelayout(job, token, dimensions)
        },
      })
      return
    }
    emitState(job, 'layout', { degraded: true })
    runMainThreadRelayout(job, token, dimensions)
  }

  /** Chunked relayout of the cached graph (no re-parse). */
  function runMainThreadRelayout(job, token, dimensions) {
    const graph = lastGraph
    if (!graph) return
    const cancelled = function () { return disposed || token !== layoutSeq || !isJobCurrent(job) }
    ontologyJobSteppedLayout(graph, dimensions, {
      impls: impls,
      scheduler: scheduler,
      isCancelled: cancelled,
      onProgress: function (progress) {
        if (cancelled()) return
        emitState(job, 'layout', { degraded: true, progress: progress })
      },
    }).then(function (outcome) {
      if (!outcome || outcome.cancelled || cancelled()) return
      emitEvent({
        type: 'layout',
        generation: job.generation,
        positions: outcome.positions,
        timing: { layout: outcome.timing },
        degraded: true,
      })
      emitState(job, 'ready', { degraded: true })
    }).catch(function (error) {
      if (cancelled()) return
      const message = 'layout failed: ' + ontologyJobErrorMessage(error)
      emitState(job, 'error', { degraded: true, message: message })
      emitEvent({ type: 'error', generation: job.generation, message: message, degraded: true })
    })
  }

  function cancel() {
    cancelActiveJob()
    cancelWorkspaceRequest()
  }

  /* ---------------------- workspace operations ---------------------- */

  /** Local workspace state, created on first use. */
  function ensureWorkspace() {
    if (workspaceState) return workspaceState
    if (typeof impls.createWorkspace !== 'function') return null
    try {
      workspaceState = impls.createWorkspace({
        buildGraph: impls.buildGraph || undefined,
        identity: impls.identity || undefined,
      })
    } catch (error) {
      workspaceState = null
    }
    return workspaceState
  }

  function cancelWorkspaceRequest() {
    const request = workspaceRequest
    workspaceRequest = null
    if (request && typeof request.cancel === 'function') {
      try { request.cancel() } catch (error) { /* ignored */ }
    }
  }

  function emitWorkspaceEvent(event) {
    if (disposed) return
    try { onEvent(Object.assign({}, event, { scope: 'workspace' })) } catch (error) { /* consumer callback errors must not break the job */ }
  }

  function ensureWorkspaceWorker() {
    if (workspaceWorker) return workspaceWorker
    workspaceWorker = ontologyJobCreateWorker({ workerFactory: workerFactory, workerSource: workerSource })
    if (workspaceState) {
      for (const source of workspaceState.sources) {
        workspaceWorker.worker.postMessage({ type: 'cache-source', source: source })
      }
    }
    return workspaceWorker
  }

  function releaseWorkspaceWorker() {
    const handle = workspaceWorker
    workspaceWorker = null
    if (handle && typeof handle.release === 'function') {
      try { handle.release() } catch (error) { /* ignored */ }
    }
  }

  function byteSizeOfText(text) {
    if (typeof text !== 'string') return 0
    try {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length
    } catch (error) {
      // fall through to code units
    }
    return text.length
  }

  /** One source summary for the source panel (never the parsed triples). */
  function sourceSummaryOf(source) {
    if (!source || typeof source !== 'object') return null
    const parsed = source.parsed && typeof source.parsed === 'object' ? source.parsed : {}
    const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : []
    return {
      sourceId: source.sourceId,
      origin: source.origin,
      displayName: source.displayName,
      navigationAddress: source.navigationAddress || null,
      absolutePath: source.absolutePath || null,
      format: source.format || '',
      revision: source.revision,
      status: source.status,
      byteSize: source.byteSize,
      tripleCount: source.occurrenceCount,
      errorCount: Array.isArray(parsed.errors) ? parsed.errors.length : 0,
      warningCount: Array.isArray(parsed.warnings) ? parsed.warnings.length : 0,
      truncated: !!(parsed.stats && parsed.stats.truncated),
      stale: !!source.stale,
      base: parsed.base || '',
      truncation: parsed.stats && parsed.stats.truncation ? parsed.stats.truncation : null,
      diagnostics: diagnostics,
    }
  }

  function workspaceSummaries() {
    if (!workspaceState) return []
    return workspaceState.sources.map(sourceSummaryOf).filter(Boolean)
  }

  function workspaceTotalsState() {
    if (!workspaceState) return { files: 0, bytes: 0, occurrences: 0 }
    let bytes = 0
    let occurrences = 0
    for (const source of workspaceState.sources) {
      bytes += Number(source.byteSize) || 0
      occurrences += Number(source.occurrenceCount) || 0
    }
    return { files: workspaceState.sources.length, bytes: bytes, occurrences: occurrences }
  }

  /** Admit one parsed source into the local workspace and emit the summary. */
  function commitSource(id, request, parsed, byteSize) {
    const state = ensureWorkspace()
    if (!state) {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'workspace is unavailable' })
      return null
    }
    const input = {
      origin: request.origin,
      displayName: request.displayName,
      navigationAddress: request.navigationAddress,
      absolutePath: request.absolutePath,
      rdfBase: request.rdfBase,
      format: request.format,
      sourceId: request.sourceId,
      revision: request.revision,
      text: request.text,
      byteSize: byteSize,
      parsed: parsed,
      error: request.error,
    }
    let result
    if (request.replace === true && typeof impls.replaceSource === 'function' && request.sourceId) {
      result = impls.replaceSource(state, request.sourceId, input)
    } else if (typeof impls.addSource === 'function') {
      result = impls.addSource(state, input)
    } else {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'workspace helpers are unavailable' })
      return null
    }
    if (!result || result.status === 'rejected' || result.status === 'missing') {
      emitWorkspaceEvent({
        type: 'source',
        generation: id,
        sourceId: request.sourceId || null,
        revision: result && result.source ? result.source.revision : 0,
        status: 'rejected',
        reason: result ? result.reason : 'unavailable',
        summary: null,
      })
      return null
    }
    workspaceState = result.workspace
    const summary = sourceSummaryOf(result.source)
    emitWorkspaceEvent({
      type: 'source',
      generation: id,
      sourceId: result.source.sourceId,
      revision: result.source.revision,
      status: result.status,
      reason: null,
      summary: summary,
      sources: workspaceSummaries(),
      totals: workspaceTotalsState(),
    })
    return result
  }

  /** Parse on the main thread (degraded path or worker failure). */
  function parseSourceLocally(id, request, text, byteSize, admission) {
    if (typeof impls.parseOntology !== 'function') {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'parser is unavailable' })
      return
    }
    let parsed
    try {
      parsed = impls.parseOntology(text, {
        fileName: request.displayName,
        format: request.format,
        navigationAddress: request.navigationAddress,
        absolutePath: request.absolutePath,
        rdfBase: request.rdfBase,
        maxTriples: admission.maxTriples,
      })
    } catch (error) {
      emitWorkspaceEvent({ type: 'error', generation: id, message: ontologyJobErrorMessage(error) })
      return
    }
    commitSource(id, request, parsed, byteSize)
  }

  /**
   * Parse one source and admit it into the workspace. With a worker the parse
   * happens off the main thread; the parsed result still comes back so the
   * workspace keeps a recoverable L0 snapshot.
   */
  function parseSource(input) {
    if (disposed) return 0
    cancelWorkspaceRequest()
    generation += 1
    const id = generation
    const request = input && typeof input === 'object' ? input : {}
    const text = typeof request.text === 'string' ? request.text : ''
    const byteSize = typeof request.byteSize === 'number' && Number.isFinite(request.byteSize)
      ? Math.max(0, request.byteSize)
      : byteSizeOfText(text)
    const state = ensureWorkspace()
    if (!state) {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'workspace is unavailable' })
      return id
    }
    // Allocate identity on the controller, not independently from Worker map
    // size (removing a source otherwise reuses/overwrites a different cache id).
    if (!request.sourceId) request.sourceId = 'src' + state.nextSourceNumber
    if (request.replace === true) {
      const previous = state.sources.find(source => source.sourceId === request.sourceId)
      if (previous) request.revision = previous.revision + 1
    }
    const admission = typeof impls.workspaceAdmission === 'function'
      ? impls.workspaceAdmission(state, byteSize)
      : { allowed: true, maxTriples: 120000, reason: null }
    if (!admission.allowed) {
      emitWorkspaceEvent({
        type: 'source',
        generation: id,
        sourceId: request.sourceId || null,
        revision: 0,
        status: 'rejected',
        reason: admission.reason,
        summary: null,
      })
      return id
    }
    const useWorker = ontologyJobWorkerEnabled({
      workerFactory: workerFactory,
      workerSource: workerSource,
      forceMainThread: forceMainThread,
    })
    if (useWorker && !fallbackUsed) {
      let handle = null
      try {
        handle = ensureWorkspaceWorker()
      } catch (error) {
        fallbackUsed = true
        emitWorkspaceEvent({
          type: 'state', status: 'parsing', generation: id, degraded: true,
          message: 'Background parse unavailable: ' + ontologyJobErrorMessage(error),
        })
        parseSourceLocally(id, request, text, byteSize, admission)
        return id
      }
      const workerMessage = {
        type: 'parse-source',
        origin: request.origin,
        id: id,
        sourceId: typeof request.sourceId === 'string' ? request.sourceId : '',
        revision: Number.isFinite(request.revision) ? request.revision : 1,
        text: text,
        byteSize: byteSize,
        displayName: typeof request.displayName === 'string' ? request.displayName : '',
        format: typeof request.format === 'string' ? request.format : '',
        navigationAddress: typeof request.navigationAddress === 'string' ? request.navigationAddress : '',
        absolutePath: typeof request.absolutePath === 'string' ? request.absolutePath : '',
        rdfBase: typeof request.rdfBase === 'string' ? request.rdfBase : '',
        maxTriples: admission.maxTriples,
      }
      workspaceRequest = ontologyJobSendWorkerMessage(handle, workerMessage, {
        id: id,
        timeoutMs: timeoutMs,
        isCancelled: function () { return disposed },
        onMessage: function (data) {
          if (disposed) return true
          if (data.type === 'source') {
            const parsed = data.parsed && typeof data.parsed === 'object' ? data.parsed : null
            commitSource(id, request, parsed, byteSize)
            return true
          }
          if (data.type === 'error') {
            releaseWorkspaceWorker()
            fallbackUsed = true
            emitWorkspaceEvent({
              type: 'state', status: 'parsing', generation: id, degraded: true,
              message: 'Background parse unavailable: ' +
                (typeof data.message === 'string' ? data.message : 'worker error'),
            })
            parseSourceLocally(id, request, text, byteSize, admission)
            return true
          }
          return false
        },
        onFailure: function (reason) {
          if (disposed) return
          releaseWorkspaceWorker()
          fallbackUsed = true
          emitWorkspaceEvent({
            type: 'state', status: 'parsing', generation: id, degraded: true,
            message: 'Background parse unavailable: ' + reason,
          })
          parseSourceLocally(id, request, text, byteSize, admission)
        },
      })
      return id
    }
    parseSourceLocally(id, request, text, byteSize, admission)
    return id
  }

  /** Compose the selected sources into the L1 graph on the main thread. */
  function composeLocally(id, request) {
    const state = ensureWorkspace()
    if (!state || typeof impls.composeWorkspaceGraph !== 'function') {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'graph composition is unavailable' })
      return
    }
    const composed = impls.composeWorkspaceGraph(state, {
      sourceIds: request.sourceIds,
      maxNodes: request.maxNodes,
      maxEdges: request.maxEdges,
      maxLiteralsPerNode: request.maxLiteralsPerNode,
      maxLiteralLength: request.maxLiteralLength,
    })
    if (!composed || !composed.graph || composed.error) {
      emitWorkspaceEvent({
        type: 'error', generation: id,
        message: 'graph composition failed: ' + String(composed && composed.error ? composed.error : 'unknown'),
      })
      return
    }
    lastGraph = composed.graph
    lastMeta = { base: '', baseSource: 'none', prefixes: {}, diagnostics: [], stats: composed.graph.stats, truncation: null }
    emitWorkspaceEvent({ type: 'state', status: 'layout', generation: id, degraded: true })
    emitWorkspaceEvent({
      type: 'graph',
      generation: id,
      graph: composed.graph,
      statements: composed.statements,
      occurrences: composed.occurrences,
      sourceIds: composed.sourceIds,
      base: '',
      baseSource: 'none',
      prefixes: {},
      diagnostics: [],
      stats: composed.graph.stats,
      truncation: composed.graph.truncation || null,
      timing: {},
      degraded: true,
    })
    const layoutOptions = ontologyJobNormalizeLayout(request.layout)
    const settings = {
      impls: impls,
      scheduler: scheduler,
      isCancelled: function () { return disposed || id !== generation },
      onProgress: function () {
        // Workspace composition layout has no per-chunk status contract.
      },
    }
    ontologyJobSteppedLayout(composed.graph, layoutOptions, settings).then(function (outcome) {
      if (!outcome || outcome.cancelled || disposed || id !== generation) return
      emitWorkspaceEvent({
        type: 'layout',
        generation: id,
        positions: ontologyJobNormalizePositions(outcome.positions),
        timing: { layout: outcome.timing },
        degraded: true,
      })
      emitWorkspaceEvent({ type: 'state', status: 'ready', generation: id, degraded: true })
    }).catch(function (error) {
      if (disposed || id !== generation) return
      emitWorkspaceEvent({
        type: 'error', generation: id,
        message: 'layout failed: ' + ontologyJobErrorMessage(error),
      })
    })
  }

  /**
   * Compose the current workset into one graph. The worker path reuses the
   * parsed sources it cached during `parseSource`; the local path uses the L0
   * snapshot the runner keeps for recovery.
   */
  function compose(input) {
    if (disposed) return 0
    cancelWorkspaceRequest()
    generation += 1
    const id = generation
    const request = input && typeof input === 'object' ? input : {}
    const state = ensureWorkspace()
    if (!state) {
      emitWorkspaceEvent({ type: 'error', generation: id, message: 'workspace is unavailable' })
      return id
    }
    emitWorkspaceEvent({ type: 'state', status: 'modeling', generation: id, degraded: false })
    const layoutOptions = ontologyJobNormalizeLayout(request.layout)
    const useWorker = ontologyJobWorkerEnabled({
      workerFactory: workerFactory,
      workerSource: workerSource,
      forceMainThread: forceMainThread,
    })
    if (useWorker && !fallbackUsed) {
      let handle = null
      try {
        handle = ensureWorkspaceWorker()
      } catch (error) {
        fallbackUsed = true
        emitWorkspaceEvent({
          type: 'state', status: 'modeling', generation: id, degraded: true,
          message: 'Background composition unavailable: ' + ontologyJobErrorMessage(error),
        })
        composeLocally(id, request)
        return id
      }
      workspaceRequest = ontologyJobSendWorkerMessage(handle, {
        type: 'compose',
        id: id,
        sourceIds: Array.isArray(request.sourceIds) ? request.sourceIds : [],
        maxNodes: request.maxNodes,
        maxEdges: request.maxEdges,
        maxLiteralsPerNode: request.maxLiteralsPerNode,
        maxLiteralLength: request.maxLiteralLength,
        layout: layoutOptions,
      }, {
        id: id,
        timeoutMs: timeoutMs,
        isCancelled: function () { return disposed },
        onMessage: function (data) {
          if (disposed) return true
          if (data.type === 'graph') {
            lastGraph = data.graph || null
            lastMeta = {
              base: '',
              baseSource: 'none',
              prefixes: {},
              diagnostics: [],
              stats: data.graph && data.graph.stats ? data.graph.stats : {},
              truncation: data.graph && data.graph.truncation ? data.graph.truncation : null,
            }
            emitWorkspaceEvent({
              type: 'graph',
              generation: id,
              graph: data.graph || null,
              statements: data.statements,
              occurrences: data.occurrences,
              sourceIds: data.sourceIds,
              base: '',
              baseSource: 'none',
              prefixes: {},
              diagnostics: [],
              stats: data.graph && data.graph.stats ? data.graph.stats : {},
              truncation: data.graph && data.graph.truncation ? data.graph.truncation : null,
              timing: data.timing && typeof data.timing === 'object' ? data.timing : {},
              degraded: false,
            })
            return false
          }
          if (data.type === 'layout') {
            emitWorkspaceEvent({
              type: 'layout',
              generation: id,
              positions: ontologyJobDecodePositions(lastGraph, data.positions),
              timing: data.timing && typeof data.timing === 'object' ? data.timing : { layout: 0 },
              degraded: false,
            })
            emitWorkspaceEvent({ type: 'state', status: 'ready', generation: id, degraded: false })
            return true
          }
          if (data.type === 'error') {
            releaseWorkspaceWorker()
            fallbackUsed = true
            emitWorkspaceEvent({
              type: 'state', status: 'modeling', generation: id, degraded: true,
              message: 'Background composition unavailable: ' +
                (typeof data.message === 'string' ? data.message : 'worker error'),
            })
            composeLocally(id, request)
            return true
          }
          return false
        },
        onFailure: function (reason) {
          if (disposed) return
          releaseWorkspaceWorker()
          fallbackUsed = true
          emitWorkspaceEvent({
            type: 'state', status: 'modeling', generation: id, degraded: true,
            message: 'Background composition unavailable: ' + reason,
          })
          composeLocally(id, request)
        },
      })
      return id
    }
    composeLocally(id, request)
    return id
  }

  /** Drop one source from the local workspace and the worker cache. */
  function dropSource(sourceId) {
    if (disposed) return
    const state = ensureWorkspace()
    if (!state || typeof impls.removeSource !== 'function') return
    const result = impls.removeSource(state, sourceId)
    if (!result || !result.removed) return
    workspaceState = result.workspace
    const worker = workspaceWorker
    if (worker && worker.worker && typeof worker.worker.postMessage === 'function') {
      try {
        worker.worker.postMessage({ type: 'drop-source', id: -1, sourceId: sourceId })
      } catch (error) {
        // ignored: a missing cache entry is not an error
      }
    }
    emitWorkspaceEvent({
      type: 'sources',
      generation: generation,
      sources: workspaceSummaries(),
      totals: workspaceTotalsState(),
      removedSourceId: sourceId,
    })
  }

  function workspaceInfo() {
    return { sources: workspaceSummaries(), totals: workspaceTotalsState() }
  }

  // Shared workspaces exchange the already bounded L0 snapshots, never source
  // text or a reconstructed graph. Source records are immutable transactions.
  function sourceSnapshots() {
    return workspaceState ? workspaceState.sources.slice() : []
  }

  function importSource(input) {
    if (disposed || !input || !input.parsed || !Array.isArray(input.parsed.triples)) return 0
    cancelWorkspaceRequest()
    generation += 1
    // A subsequent compose hydrates this snapshot into the worker. Releasing
    // here also prevents an older worker cache from restoring removed sources.
    releaseWorkspaceWorker()
    const request = Object.assign({}, input, { text: undefined })
    commitSource(generation, request, input.parsed, Math.max(0, Number(input.byteSize) || 0))
    return generation
  }

  function disposeWorkspace() {
    cancelWorkspaceRequest()
    workspaceState = null
  }

  function releasedWorkspace() {
    disposeWorkspace()
  }

  function dispose() {
    cancelActiveJob()
    cancelWorkspaceRequest()
    releaseWorkspaceWorker()
    releasedWorkspace()
    disposed = true
    lastGraph = null
    lastMeta = null
  }

  return {
    submit: submit,
    relayout: relayout,
    cancel: cancel,
    parseSource: parseSource,
    compose: compose,
    dropSource: dropSource,
    workspaceInfo: workspaceInfo,
    sourceSnapshots: sourceSnapshots,
    importSource: importSource,
    dispose: dispose,
  }
}
