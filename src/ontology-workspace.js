/**
 * Multi-file ontology workspace: source records, bounded L0 storage and the
 * merged statement index that the graph model renders.
 *
 * This module is plain ECMAScript and is concatenated into the Client bundle
 * and the embedded Worker (see build/build.mjs) as well as imported directly
 * by Node tests. Like `ontology-job.js` it resolves the few helpers that live
 * in sibling modules through explicit injection or the shared closure, so the
 * module stays import-free:
 *
 *   createWorkspace({ buildGraph, identity })
 *   addSource(workspace, input)       // input.parsed is a parseOntology result
 *   removeSource(workspace, sourceId)
 *   replaceSource(workspace, sourceId, input)
 *   workspaceAdmission(workspace, byteSize)
 *   composeWorkspaceGraph(workspace, options)
 *   workspaceSummary(workspace)
 *
 * Layers: this module owns L0 (bounded parsed statements and their sources).
 * The graph model derives L1 (bounded node-link model), the view filters it to
 * L2, exploration is L3 and the drawn edge budget is L4. Nothing here infers a
 * source position: statements only say which file they came from.
 */

/** Candidate admission limits. They are tuned by benchmarks, not contracts. */
export const WORKSPACE_LIMITS = Object.freeze({
  maxFiles: 16,
  maxTotalSourceBytes: 24 * 1024 * 1024,
  maxOccurrences: 120000,
  maxTriplesPerSource: 120000,
  degradedMaxOccurrences: 60000,
})

const WORKSPACE_STATUS = Object.freeze({
  READY: 'ready',
  PARTIAL: 'partial',
  EMPTY: 'empty',
  ERROR: 'error',
})

/** UTF-8 byte length of a string, falling back to code units. */
function workspaceByteLength(text) {
  if (typeof text !== 'string') return 0
  try {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length
  } catch (error) {
    // fall through to code units
  }
  return text.length
}

/** Resolve the graph builder from an explicit option or the bundle closure. */
function resolveWorkspaceBuildGraph(explicit) {
  if (typeof explicit === 'function') return explicit
  try {
    if (typeof buildGraph === 'function') return buildGraph
  } catch (error) {
    // no graph model in this scope
  }
  try {
    if (typeof globalThis === 'object' && globalThis &&
      typeof globalThis.buildGraph === 'function') return globalThis.buildGraph
  } catch (error) {
    // ignored
  }
  return null
}

/** Resolve identity helpers from an explicit option or the bundle closure. */
function resolveWorkspaceIdentity(explicit) {
  if (explicit && typeof explicit.entityKeyForTerm === 'function' &&
    typeof explicit.statementIdFor === 'function') {
    return explicit
  }
  try {
    if (typeof entityKeyForTerm === 'function' && typeof statementIdFor === 'function') {
      return {
        entityKeyForTerm: entityKeyForTerm,
        statementIdFor: statementIdFor,
        graphIdentityFor: graphIdentityFor,
      }
    }
  } catch (error) {
    // no identity module in this scope
  }
  return null
}

function workspaceLimits(limits) {
  const input = limits && typeof limits === 'object' ? limits : {}
  const read = (value, fallback) => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : fallback
  )
  return {
    maxFiles: read(input.maxFiles, WORKSPACE_LIMITS.maxFiles),
    maxTotalSourceBytes: read(input.maxTotalSourceBytes, WORKSPACE_LIMITS.maxTotalSourceBytes),
    maxOccurrences: read(input.maxOccurrences, WORKSPACE_LIMITS.maxOccurrences),
    maxTriplesPerSource: read(input.maxTriplesPerSource, WORKSPACE_LIMITS.maxTriplesPerSource),
    degradedMaxOccurrences: read(input.degradedMaxOccurrences, WORKSPACE_LIMITS.degradedMaxOccurrences),
  }
}

/** Total accepted bytes of the sources that still count against the budget. */
function workspaceUsedBytes(workspace) {
  let total = 0
  for (const source of workspace.sources) total += Number(source.byteSize) || 0
  return total
}

/** Total accepted statement occurrences. */
function workspaceUsedOccurrences(workspace) {
  let total = 0
  for (const source of workspace.sources) total += Number(source.occurrenceCount) || 0
  return total
}

/**
 * Create an empty workspace.
 * @param {{limits?: object, buildGraph?: Function, identity?: object}} [options]
 */
export function createWorkspace(options) {
  const opts = options && typeof options === 'object' ? options : {}
  return {
    limits: workspaceLimits(opts.limits),
    buildGraph: resolveWorkspaceBuildGraph(opts.buildGraph),
    identity: resolveWorkspaceIdentity(opts.identity),
    revision: 0,
    nextSourceNumber: 1,
    sources: [],
  }
}

/**
 * Ask whether one more source of `byteSize` bytes can be parsed and admitted.
 * The caller passes `maxTriples` to the parser; the workspace then re-checks
 * the real occurrence count when the parse result arrives.
 * @returns {{allowed: boolean, maxTriples: number, reason: string|null}}
 */
export function workspaceAdmission(workspace, byteSize) {
  const state = workspace || createWorkspace()
  const limits = state.limits
  const bytes = Math.max(0, Number(byteSize) || 0)
  if (state.sources.length >= limits.maxFiles) {
    return { allowed: false, maxTriples: 0, reason: 'file-limit' }
  }
  if (workspaceUsedBytes(state) + bytes > limits.maxTotalSourceBytes) {
    return { allowed: false, maxTriples: 0, reason: 'byte-budget' }
  }
  const remaining = limits.maxOccurrences - workspaceUsedOccurrences(state)
  if (remaining <= 0) {
    return { allowed: false, maxTriples: 0, reason: 'occurrence-budget' }
  }
  return {
    allowed: true,
    maxTriples: Math.min(limits.maxTriplesPerSource, remaining),
    reason: null,
  }
}

/** Derive the presentation status of one parsed source. */
function workspaceSourceStatus(parsed, text) {
  if (!parsed || typeof parsed !== 'object') return WORKSPACE_STATUS.ERROR
  const triples = Array.isArray(parsed.triples) ? parsed.triples : []
  const errors = Array.isArray(parsed.errors) ? parsed.errors : []
  if (triples.length === 0) {
    if (typeof text === 'string' && text.trim() !== '' && errors.length > 0) {
      return WORKSPACE_STATUS.ERROR
    }
    return WORKSPACE_STATUS.EMPTY
  }
  const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
  if (stats.truncated || errors.length > 0) return WORKSPACE_STATUS.PARTIAL
  return WORKSPACE_STATUS.READY
}

/** Copy only what L0 and the UI need from one parse result. */
function workspaceParsedSnapshot(parsed) {
  const input = parsed && typeof parsed === 'object' ? parsed : {}
  const stats = input.stats && typeof input.stats === 'object' ? input.stats : {}
  return {
    format: typeof input.format === 'string' ? input.format : '',
    prefixes: input.prefixes && typeof input.prefixes === 'object' ? input.prefixes : {},
    base: typeof input.base === 'string' ? input.base : '',
    baseSource: typeof input.baseSource === 'string' ? input.baseSource : 'none',
    triples: Array.isArray(input.triples) ? input.triples : [],
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    errors: Array.isArray(input.errors) ? input.errors : [],
    stats: {
      tripleCount: Number(stats.tripleCount) || (Array.isArray(input.triples) ? input.triples.length : 0),
      truncated: !!stats.truncated,
      truncation: stats.truncation || null,
    },
  }
}

/**
 * Add one parsed source. The caller parses first (with `workspaceAdmission`),
 * so this transaction only validates budgets and records the source.
 * @returns {{workspace: object, status: string, source: object|null, reason: string|null}}
 */
export function addSource(workspace, input) {
  const state = workspace || createWorkspace()
  const request = input && typeof input === 'object' ? input : {}
  const parsed = request.parsed
  const text = typeof request.text === 'string' ? request.text : ''
  const byteSize = Number.isFinite(request.byteSize)
    ? Math.max(0, Number(request.byteSize))
    : (typeof request.text === 'string' ? workspaceByteLength(text) : 0)
  const admission = workspaceAdmission(state, byteSize)
  if (!admission.allowed) {
    return { workspace: state, status: 'rejected', source: null, reason: admission.reason }
  }
  const snapshot = workspaceParsedSnapshot(parsed)
  if (snapshot.triples.length > admission.maxTriples) {
    // The parser ignored the admission limit; never admit more than budgeted.
    return { workspace: state, status: 'rejected', source: null, reason: 'occurrence-budget' }
  }
  const status = typeof request.error === 'string' && request.error
    ? WORKSPACE_STATUS.ERROR
    : workspaceSourceStatus(parsed, text)
  const sourceId = typeof request.sourceId === 'string' && request.sourceId
    ? request.sourceId
    : 'src' + state.nextSourceNumber
  const revision = Number.isFinite(request.revision) && request.revision > 0
    ? Math.floor(request.revision)
    : 1
  const record = {
    sourceId: sourceId,
    origin: request.origin === 'browser' ? 'browser' : 'host',
    displayName: typeof request.displayName === 'string' ? request.displayName : '',
    navigationAddress: typeof request.navigationAddress === 'string' ? request.navigationAddress : null,
    absolutePath: typeof request.absolutePath === 'string' && request.absolutePath
      ? request.absolutePath
      : null,
    rdfBase: typeof request.rdfBase === 'string' ? request.rdfBase : '',
    format: typeof request.format === 'string' && request.format
      ? request.format
      : snapshot.format,
    revision: revision,
    status: status,
    byteSize: byteSize,
    occurrenceCount: snapshot.triples.length,
    error: typeof request.error === 'string' ? request.error : null,
    stale: false,
    parsed: snapshot,
    addedOrder: state.sources.length,
  }
  const next = Object.assign({}, state, {
    sources: state.sources.concat([record]),
    revision: state.revision + 1,
    nextSourceNumber: sourceId === 'src' + state.nextSourceNumber
      ? state.nextSourceNumber + 1
      : state.nextSourceNumber,
  })
  return { workspace: next, status: status, source: record, reason: null }
}

/** Remove one source; entities only it contributed disappear with it. */
export function removeSource(workspace, sourceId) {
  const state = workspace || createWorkspace()
  const remaining = state.sources.filter((source) => source.sourceId !== sourceId)
  if (remaining.length === state.sources.length) return { workspace: state, removed: false }
  return {
    workspace: Object.assign({}, state, { sources: remaining, revision: state.revision + 1 }),
    removed: true,
  }
}

/**
 * Atomically replace one source with a newly parsed version. A rejected
 * candidate leaves the previous version untouched (no partial state).
 */
export function replaceSource(workspace, sourceId, input) {
  const state = workspace || createWorkspace()
  const index = state.sources.findIndex((source) => source.sourceId === sourceId)
  if (index < 0) {
    return { workspace: state, status: 'missing', source: null, reason: 'unknown-source' }
  }
  const previous = state.sources[index]
  const request = Object.assign({}, input && typeof input === 'object' ? input : {})
  // A failed read or a missing parse result must not replace good data.
  if (typeof request.error === 'string' && request.error) {
    return { workspace: state, status: 'rejected', source: previous, reason: 'read-failed' }
  }
  if (!request.parsed || typeof request.parsed !== 'object' ||
    !Array.isArray(request.parsed.triples)) {
    return { workspace: state, status: 'rejected', source: previous, reason: 'missing-parse' }
  }
  const staged = Object.assign({}, state, {
    sources: state.sources.slice(0, index).concat(state.sources.slice(index + 1)),
    revision: state.revision,
  })
  request.sourceId = sourceId
  request.revision = (Number(previous.revision) || 1) + 1
  if (request.displayName === undefined) request.displayName = previous.displayName
  if (request.origin === undefined) request.origin = previous.origin
  if (request.navigationAddress === undefined) request.navigationAddress = previous.navigationAddress
  if (request.absolutePath === undefined) request.absolutePath = previous.absolutePath
  const added = addSource(staged, request)
  if (added.status === 'rejected') {
    return { workspace: state, status: 'rejected', source: previous, reason: added.reason }
  }
  const restored = staged.sources.slice()
  restored.splice(index, 0, added.source)
  return {
    workspace: Object.assign({}, added.workspace, {
      sources: restored,
      revision: state.revision + 1,
    }),
    status: added.status,
    source: added.source,
    reason: null,
  }
}

/** Mark one source as changed on disk without dropping its last good data. */
export function markSourceStale(workspace, sourceId, version) {
  const state = workspace || createWorkspace()
  let changed = false
  const sources = state.sources.map((source) => {
    if (source.sourceId !== sourceId) return source
    if (version !== undefined && source.version === version) return source
    changed = true
    return Object.assign({}, source, { stale: true, version: version })
  })
  if (!changed) return { workspace: state, changed: false }
  return {
    workspace: Object.assign({}, state, { sources: sources, revision: state.revision + 1 }),
    changed: true,
  }
}

/** Valid source ids for a selection; an empty/absent selection means all. */
export function selectSourceIds(workspace, sourceIds) {
  const state = workspace || createWorkspace()
  const wanted = Array.isArray(sourceIds) ? new Set(sourceIds.filter((id) => typeof id === 'string')) : null
  if (!wanted || wanted.size === 0) return state.sources.map((source) => source.sourceId)
  return state.sources
    .filter((source) => wanted.has(source.sourceId))
    .map((source) => source.sourceId)
}

/** Public source summaries for the source panel (never the parsed triples). */
export function workspaceSummary(workspace) {
  const state = workspace || createWorkspace()
  return state.sources.map((source) => ({
    sourceId: source.sourceId,
    origin: source.origin,
    displayName: source.displayName,
    navigationAddress: source.navigationAddress,
    absolutePath: source.absolutePath,
    format: source.format,
    revision: source.revision,
    status: source.status,
    byteSize: source.byteSize,
    tripleCount: source.occurrenceCount,
    errorCount: source.parsed && Array.isArray(source.parsed.errors) ? source.parsed.errors.length : 0,
    warningCount: source.parsed && Array.isArray(source.parsed.warnings)
      ? source.parsed.warnings.length
      : 0,
    truncated: !!(source.parsed && source.parsed.stats && source.parsed.stats.truncated),
    stale: !!source.stale,
    base: source.parsed ? source.parsed.base : '',
  }))
}

/** Workspace-level counters derived from the accepted sources. */
export function workspaceTotals(workspace) {
  const state = workspace || createWorkspace()
  return {
    files: state.sources.length,
    bytes: workspaceUsedBytes(state),
    occurrences: workspaceUsedOccurrences(state),
    maxFiles: state.limits.maxFiles,
    maxTotalSourceBytes: state.limits.maxTotalSourceBytes,
    maxOccurrences: state.limits.maxOccurrences,
    revision: state.revision,
  }
}

/** Statement key: every term identity plus the statement graph identity. */
function workspaceStatementKey(identity, terms, graphKey) {
  return [
    terms.s,
    terms.p,
    terms.oKind,
    terms.o,
    terms.dt || '',
    terms.lang || '',
    graphKey,
    terms.literalTruncated ? 'truncated' : '',
  ].join('\u0001')
}

/**
 * Merge the selected sources into statement records with occurrences.
 * Identical statements (same terms and graph identity) merge; every
 * occurrence keeps its source and revision.
 */
function workspaceMergeRecords(workspace, selectedIds) {
  const identity = workspace.identity
  if (!identity) throw new Error('workspace identity helpers are unavailable')
  const selected = selectedIds ? new Set(selectedIds) : null
  const records = new Map()
  const order = []
  let occurrences = 0
  for (const source of workspace.sources) {
    if (selected && !selected.has(source.sourceId)) continue
    const parsed = source.parsed
    if (!parsed || !Array.isArray(parsed.triples)) continue
    const triples = parsed.triples
    for (let ordinal = 0; ordinal < triples.length; ordinal++) {
      const triple = triples[ordinal]
      if (!triple || typeof triple.s !== 'string' || typeof triple.p !== 'string') continue
      if (triple.o === null || triple.o === undefined) continue
      const objectKind = triple.oKind === 'literal' || triple.oKind === 'blank'
        ? triple.oKind
        : 'iri'
      const graph = triple.graph && typeof triple.graph === 'object'
        ? triple.graph
        : { kind: 'unknown' }
      const terms = {
        s: identity.entityKeyForTerm(triple.s, source.sourceId),
        p: identity.entityKeyForTerm(triple.p, source.sourceId),
        o: objectKind === 'literal'
          ? String(triple.o)
          : identity.entityKeyForTerm(String(triple.o), source.sourceId),
        oKind: objectKind,
        dt: typeof triple.dt === 'string' ? triple.dt : undefined,
        lang: typeof triple.lang === 'string' ? triple.lang : undefined,
        literalTruncated: !!triple.literalTruncated,
      }
      const graphKey = identity.graphIdentityFor(source.sourceId, graph)
      const key = workspaceStatementKey(identity, terms, graphKey)
      let record = records.get(key)
      if (record === undefined) {
        record = Object.assign({ key: key, statementId: identity.statementIdFor(source.sourceId, ordinal), terms: terms }, {
          occurrences: [],
        })
        records.set(key, record)
        order.push(record)
      }
      record.occurrences.push({
        sourceId: source.sourceId,
        revision: source.revision,
        graph: graph,
      })
      occurrences += 1
    }
  }
  return { records: order, occurrences: occurrences }
}

/**
 * Build the L1 graph for the selected sources (all by default).
 * The graph model receives expanded statement occurrences plus the source
 * table, so node/edge provenance survives without re-parsing anything.
 * @param {{sourceIds?: string[], maxNodes?: number, maxEdges?: number,
 *          maxLiteralsPerNode?: number, maxLiteralLength?: number}} [options]
 */
export function composeWorkspaceGraph(workspace, options) {
  const state = workspace || createWorkspace()
  const opts = options && typeof options === 'object' ? options : {}
  const builder = state.buildGraph
  if (typeof builder !== 'function') {
    return { error: 'graph-model-unavailable', graph: null, statements: 0, occurrences: 0 }
  }
  const selectedIds = opts.sourceIds === undefined
    ? state.sources.map((source) => source.sourceId)
    : selectSourceIds(state, opts.sourceIds)
  const merged = workspaceMergeRecords(state, selectedIds)
  const statements = []
  for (const record of merged.records) {
    for (const occurrence of record.occurrences) {
      statements.push({
        s: record.terms.s,
        p: record.terms.p,
        o: record.terms.o,
        oKind: record.terms.oKind,
        dt: record.terms.dt,
        lang: record.terms.lang,
        literalTruncated: record.terms.literalTruncated,
        graph: occurrence.graph,
        sourceId: occurrence.sourceId,
        statementId: record.statementId,
      })
    }
  }
  const sources = workspaceSummary(state).filter((source) => selectedIds.indexOf(source.sourceId) >= 0)
  const single = sources.length === 1 ? sources[0] : null
  const prefixes = {}
  for (const source of state.sources) {
    if (selectedIds.indexOf(source.sourceId) < 0) continue
    if (!source.parsed || !source.parsed.prefixes) continue
    const keys = Object.keys(source.parsed.prefixes)
    for (let index = 0; index < keys.length; index++) {
      const name = keys[index]
      if (typeof prefixes[name] !== 'string') prefixes[name] = source.parsed.prefixes[name]
    }
  }
  const graph = builder(
    { prefixes: prefixes, triples: [], sources: sources },
    {
      statements: statements,
      sources: sources,
      maxNodes: opts.maxNodes,
      maxEdges: opts.maxEdges,
      maxLiteralsPerNode: opts.maxLiteralsPerNode,
      maxLiteralLength: opts.maxLiteralLength,
      source: single
        ? {
            address: single.navigationAddress || single.absolutePath || '',
            displayName: single.displayName,
            format: single.format,
          }
        : { address: '', displayName: '', format: '' },
    },
  )
  return {
    graph: graph,
    statements: merged.records.length,
    occurrences: merged.occurrences,
    sourceIds: selectedIds,
  }
}
