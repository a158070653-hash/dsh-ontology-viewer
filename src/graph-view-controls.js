/**
 * Toolbar, search, filter/exploration panels and status banners for the
 * ontology graph view, plus the pure state helpers they share.
 *
 * Split out of graph-view.js so the view orchestration stays readable. The
 * Client bundle concatenates this module before graph-view.js inside one
 * closure (no imports allowed); the pure helpers at the top are also imported
 * directly by the Node tests, so nothing in this file may touch React or the
 * DOM at load time. Components are created by `createGraphViewControls(React)`.
 */

/** Selection focuses one hop in the full graph; exploration already defines
 * the visible scope, so only an actual hover temporarily dims that scope. */
export function highlightAnchor(exploring, selectedId, hoverId) {
  return hoverId || (exploring ? null : selectedId) || null
}

/** The highlighted neighborhood is one hop around the active hover/selection. */
export function highlightNeighborhood(activeId, adjacency) {
  if (!activeId) return null
  const neighbours = adjacency instanceof Map ? adjacency.get(activeId) : null
  return new Set([activeId].concat(Array.isArray(neighbours) ? neighbours : []))
}

/** Whether a relation touches the active node (orientation is preserved elsewhere). */
export function highlightRelation(sourceId, targetId, activeId) {
  return Boolean(activeId) && (sourceId === activeId || targetId === activeId)
}

/**
 * Route graph keyboard shortcuts only from graph-owned focus targets. This
 * avoids intercepting keys while DSH search fields and sidebar controls own
 * focus, while still supporting SVG nodes in the roving-tabindex model.
 */
export function ownsGraphKeyboardFocus(target, root) {
  if (!target || typeof target.closest !== 'function') return false
  const owner = target.closest('[data-dov-graph-focus]')
  if (!owner) return false
  return !root || owner === root || (typeof root.contains === 'function' && root.contains(owner))
}

/** Move the roving graph focus with arrow/Home/End keys, wrapping at the ends. */
export function moveRovingId(order, currentId, key) {
  if (!Array.isArray(order) || order.length === 0) return null
  if (key === 'Home') return order[0]
  if (key === 'End') return order[order.length - 1]
  const index = order.indexOf(currentId)
  if (index < 0) return order[0]
  const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1
  return order[(index + step + order.length) % order.length]
}

/** Map a focused graph key to a view action without intercepting DSH controls. */
export function graphShortcutAction(key, target, root) {
  if (!ownsGraphKeyboardFocus(target, root)) return null
  if (key === 'Escape') return 'escape'
  if (key === '+' || key === '=') return 'zoom-in'
  if (key === '-') return 'zoom-out'
  if (key === '0' || (typeof key === 'string' && key.toLowerCase() === 'f')) return 'fit'
  return null
}

/** Node kinds shown in the filter panel, canonical order. */
export const VIEW_KINDS = ['class', 'property', 'individual', 'blank', 'external']
/** Relation directions relative to an anchor node. */
export const VIEW_DIRECTIONS = ['both', 'out', 'in']
/** Chinese fallback labels; the real labels come from tr('viewer.kind.*'). */
export const VIEW_KIND_LABELS = {
  class: '类',
  property: '属性',
  individual: '个体',
  blank: '空白节点',
  external: '外部引用',
}
/** Chinese fallback labels for direction controls. */
export const VIEW_DIRECTION_LABELS = { both: '双向', out: '仅出边', in: '仅入边' }
/** Multi-hop exploration limits (the graph-view spec hard-caps at 5 hops). */
export const VIEW_MIN_DEPTH = 1
export const VIEW_MAX_DEPTH = 5
export const VIEW_DEFAULT_DEPTH = 2
/** Raw diagnostic messages kept per code (design: max 3 samples per code). */
export const VIEW_DIAGNOSTIC_SAMPLES = 3
/** Synthetic diagnostic code for the legacy human-readable issues list. */
export const VIEW_ISSUE_CODE = 'parse-message'

// ---------------------------------------------------------------------------
// Pure filter/explore/search/budget helpers (Node-testable)
// ---------------------------------------------------------------------------

function viewNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function viewNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function viewString(value) {
  return typeof value === 'string' ? value : ''
}

/** Local name of an IRI without importing graph-model (kept standalone). */
function viewLocalName(iri) {
  const value = viewString(iri).trim()
  if (!value) return ''
  if (value.startsWith('_:')) return value.slice(2)
  const hash = value.lastIndexOf('#')
  const slash = value.lastIndexOf('/')
  const cut = hash > slash ? hash : slash
  if (cut >= 0) return value.slice(cut + 1)
  const colon = value.lastIndexOf(':')
  if (colon >= 0) return value.slice(colon + 1)
  return value
}

/** Fill `{name}` placeholders in a localized template. Unknown names are kept. */
export function formatTemplate(template, params) {
  const text = typeof template === 'string' ? template : ''
  if (!params || typeof params !== 'object') return text
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

/** Empty filter state: no kind/predicate restriction, direction both. */
export function emptyFilterState() {
  return { kinds: [], predicates: [], direction: 'both' }
}

/** Validate a filter state coming from state/props; never throws. */
export function normalizeFilterState(state) {
  const input = state && typeof state === 'object' ? state : {}
  const kinds = []
  const predicates = []
  if (Array.isArray(input.kinds)) {
    for (const kind of input.kinds) {
      if (typeof kind === 'string' && VIEW_KINDS.indexOf(kind) >= 0 && kinds.indexOf(kind) < 0) kinds.push(kind)
    }
  }
  if (Array.isArray(input.predicates)) {
    for (const predicate of input.predicates) {
      if (typeof predicate === 'string' && predicate && predicates.indexOf(predicate) < 0) {
        predicates.push(predicate)
      }
    }
  }
  const direction = VIEW_DIRECTIONS.indexOf(input.direction) >= 0 ? input.direction : 'both'
  return { kinds, predicates, direction }
}

/** Toggle one value in a copied array, preserving insertion order. */
export function toggleFilterValue(values, value) {
  const list = Array.isArray(values) ? values.filter((item) => typeof item === 'string') : []
  const index = list.indexOf(value)
  if (index >= 0) {
    const next = list.slice()
    next.splice(index, 1)
    return next
  }
  if (typeof value !== 'string' || !value) return list
  return list.concat([value])
}

/** True when the filter state restricts anything. */
export function isFilterActive(state) {
  const filter = normalizeFilterState(state)
  return filter.kinds.length > 0 || filter.predicates.length > 0 || filter.direction !== 'both'
}

/** Build filterGraph() criteria; direction only applies relative to an anchor. */
export function filterCriteria(state, anchorId) {
  const filter = normalizeFilterState(state)
  const hasAnchor = typeof anchorId === 'string' && anchorId.length > 0
  const criteria = {
    kinds: filter.kinds.slice(),
    predicates: filter.predicates.slice(),
  }
  if (hasAnchor) {
    criteria.anchorId = anchorId
    // 'both' is the neutral direction: omit it entirely so graph-model does not
    // cut the graph down to the anchor's 1-hop relations. Only an explicit
    // out/in request adds the direction (design §4.2).
    if (filter.direction !== 'both') criteria.direction = filter.direction
  }
  return criteria
}

/** Predicate options for the filter panel, ordered deterministically. */
export function derivePredicateOptions(graph) {
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : []
  const counts = new Map()
  for (const edge of edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue
    const predicate = typeof edge.p === 'string' && edge.p ? edge.p : ''
    if (!predicate) continue
    counts.set(predicate, (counts.get(predicate) || 0) + 1)
  }
  const options = []
  for (const entry of counts.entries()) {
    const predicate = entry[0]
    options.push({ predicate, label: viewLocalName(predicate) || predicate, count: entry[1] })
  }
  options.sort((a, b) => b.count - a.count || (a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1 : 0))
  return options
}

/** Visible/total node and edge counts derived from graph shapes. */
export function deriveVisibleCounts(visibleGraph, fullGraph) {
  const visible = visibleGraph && typeof visibleGraph === 'object' ? visibleGraph : {}
  const full = fullGraph && typeof fullGraph === 'object' ? fullGraph : {}
  const visibleNodes = Array.isArray(visible.nodes) ? visible.nodes.length : 0
  const visibleEdges = Array.isArray(visible.edges) ? visible.edges.length : 0
  const totalNodes = Array.isArray(full.nodes) ? full.nodes.length : 0
  const totalEdges = Array.isArray(full.edges) ? full.edges.length : 0
  return {
    nodes: { visible: visibleNodes, total: totalNodes },
    edges: { visible: visibleEdges, total: totalEdges },
  }
}

/**
 * Whether a node would survive the current filter on its own (anchor
 * retention excluded). Used to warn instead of silently changing filters when
 * a search selection falls outside the visible projection.
 */
export function isNodeVisibleUnderFilter(node, state, graph) {
  if (!node || typeof node.id !== 'string') return false
  const filter = normalizeFilterState(state)
  if (!isFilterActive(filter)) return true
  if (filter.kinds.length > 0 && filter.kinds.indexOf(node.kind) < 0) return false
  if (filter.predicates.length === 0 && filter.direction === 'both') return true
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : []
  const predicates = new Set(filter.predicates)
  for (const edge of edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue
    if (edge.source !== node.id && edge.target !== node.id) continue
    if (predicates.size > 0 && !predicates.has(edge.p)) continue
    if (filter.direction === 'out' && edge.source !== node.id) continue
    if (filter.direction === 'in' && edge.target !== node.id) continue
    return true
  }
  return false
}

/** Clamp an explore depth to the spec range 1..5. */
export function clampExploreDepth(value) {
  const number = viewNumber(value, VIEW_DEFAULT_DEPTH)
  return Math.min(VIEW_MAX_DEPTH, Math.max(VIEW_MIN_DEPTH, Math.floor(number)))
}

/** Fresh multi-hop exploration state. */
export function createExploreState(overrides) {
  const input = overrides && typeof overrides === 'object' ? overrides : {}
  return {
    on: input.on === true,
    depth: clampExploreDepth(input.depth),
    direction: VIEW_DIRECTIONS.indexOf(input.direction) >= 0 ? input.direction : 'both',
    cursor: input.cursor === undefined ? null : input.cursor,
    extension: viewNumber(input.extension, 0),
  }
}

/** Validate a persisted exploration state. */
export function normalizeExploreState(state) {
  return createExploreState(state)
}

/**
 * Change the hop count. Picking a depth is an explicit intent to explore, so a
 * selected anchor starts exploration immediately instead of silently doing
 * nothing until the separate "explore" button is pressed.
 */
export function withExploreDepth(state, depth) {
  const previous = normalizeExploreState(state)
  return {
    ...previous,
    on: true,
    depth: clampExploreDepth(depth),
    cursor: null,
    extension: 0,
  }
}

/** Change the direction of the current exploration (and start it when idle). */
export function withExploreDirection(state, direction) {
  const previous = normalizeExploreState(state)
  return {
    ...previous,
    on: true,
    direction: VIEW_DIRECTIONS.indexOf(direction) >= 0 ? direction : 'both',
    cursor: null,
    extension: 0,
  }
}

/** exploreNeighborhood() criteria for the current filter+anchor combination. */
export function exploreCriteria(state, anchorId, filterState) {
  const explore = createExploreState(state)
  const filter = normalizeFilterState(filterState)
  const criteria = {
    startId: typeof anchorId === 'string' ? anchorId : null,
    depth: explore.depth,
    direction: explore.direction,
    predicates: filter.predicates.slice(),
  }
  if (explore.cursor !== null && explore.cursor !== undefined) criteria.cursor = explore.cursor
  return criteria
}

/**
 * Normalise the graph-model projection result shapes ("{graph,stats,hidden}"
 * from the design, "{nodes,edges,stats}" from the implementation task) into a
 * plain graph. Falls back to the input graph on anything unexpected.
 */
export function normalizeProjectionResult(result, fallbackGraph) {
  const fallback = fallbackGraph && Array.isArray(fallbackGraph.nodes) ? fallbackGraph : { nodes: [], edges: [] }
  if (!result || typeof result !== 'object') return fallback
  if (result.graph && typeof result.graph === 'object' && Array.isArray(result.graph.nodes)) {
    return mergeGraphShell(result.graph, fallback)
  }
  if (Array.isArray(result.nodes)) return mergeGraphShell(result, fallback)
  return fallback
}

function mergeGraphShell(source, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : {}
  return {
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    edges: Array.isArray(source.edges) ? source.edges : [],
    stats: source.stats && typeof source.stats === 'object' ? source.stats : (base.stats || undefined),
    warnings: Array.isArray(source.warnings) ? source.warnings : (Array.isArray(base.warnings) ? base.warnings : []),
    truncation: source.truncation !== undefined ? source.truncation : (base.truncation || null),
    source: source.source !== undefined ? source.source : (base.source || null),
  }
}

/**
 * Normalise exploreNeighborhood() output. Accepts either `nodes` (node
 * objects) or `nodeIds` (ids resolved against the input graph), and either
 * `nextCursor`/`cursor`/`nextBudget` for the continuation token.
 */
export function normalizeExploreResult(result, graph) {
  const source = graph && Array.isArray(graph.nodes)
    ? graph
    : { nodes: [], edges: [], stats: undefined, warnings: [] }
  if (!result || typeof result !== 'object') {
    return {
      graph: source,
      truncated: false,
      nextCursor: null,
      totalNodes: null,
      totalEdges: null,
      depthCapped: false,
    }
  }
  let nodes = Array.isArray(result.nodes) ? result.nodes.filter((node) => node && typeof node.id === 'string') : null
  if (!nodes && Array.isArray(result.nodeIds)) {
    const byId = new Map()
    for (const node of source.nodes) {
      if (node && typeof node.id === 'string') byId.set(node.id, node)
    }
    const seen = new Set()
    nodes = []
    for (const id of result.nodeIds) {
      if (typeof id !== 'string' || seen.has(id)) continue
      seen.add(id)
      const node = byId.get(id)
      if (node) nodes.push(node)
    }
  }
  if (!nodes) nodes = source.nodes.slice()
  const nodeIds = new Set(nodes.map((node) => node && node.id))
  let edges = null
  if (Array.isArray(result.edges)) {
    edges = result.edges.filter((edge) =>
      edge && typeof edge.source === 'string' && typeof edge.target === 'string' &&
      nodeIds.has(edge.source) && nodeIds.has(edge.target))
  } else {
    const sourceEdges = Array.isArray(source.edges) ? source.edges : []
    edges = sourceEdges.filter((edge) =>
      edge && typeof edge.source === 'string' && typeof edge.target === 'string' &&
      nodeIds.has(edge.source) && nodeIds.has(edge.target))
  }
  const stats = result.stats && typeof result.stats === 'object'
    ? result.stats
    : { nodes: nodes.length, edges: edges.length }
  const cursorCandidate = result.nextCursor !== undefined
    ? result.nextCursor
    : result.cursor !== undefined ? result.cursor : (result.nextBudget !== undefined ? result.nextBudget : null)
  const nextCursor = cursorCandidate === undefined ? null : cursorCandidate
  const truncation = result.truncation && typeof result.truncation === 'object' ? result.truncation : null
  const truncNodes = truncation && truncation.nodes && typeof truncation.nodes === 'object' ? truncation.nodes : null
  const truncEdges = truncation && truncation.edges && typeof truncation.edges === 'object' ? truncation.edges : null
  // The model reports the unbudgeted expansion available in truncation.{nodes,
  // edges}.total; fall back to stats for older/simpler result shapes.
  const totalNodes = viewNumberOrNull(truncNodes && truncNodes.total) !== null
    ? viewNumberOrNull(truncNodes.total)
    : viewNumberOrNull(result.totalNodes) !== null
      ? viewNumberOrNull(result.totalNodes)
      : viewNumberOrNull(stats.availableNodes) !== null
        ? viewNumberOrNull(stats.availableNodes)
        : viewNumberOrNull(stats.totalNodes)
  const totalEdges = viewNumberOrNull(truncEdges && truncEdges.total) !== null
    ? viewNumberOrNull(truncEdges.total)
    : viewNumberOrNull(result.totalEdges) !== null
      ? viewNumberOrNull(result.totalEdges)
      : viewNumberOrNull(stats.availableEdges) !== null
        ? viewNumberOrNull(stats.availableEdges)
        : viewNumberOrNull(stats.totalEdges)
  const truncatedNodes = viewNumberOrNull(truncNodes && truncNodes.truncated)
  const truncatedEdges = viewNumberOrNull(truncEdges && truncEdges.truncated)
  const exploredGraph = mergeGraphShell(
    { nodes, edges, stats, warnings: source.warnings, truncation: source.truncation, source: source.source },
    source,
  )
  return {
    graph: exploredGraph,
    truncated: result.truncated === true || (truncatedNodes !== null && truncatedNodes > 0) ||
      (truncatedEdges !== null && truncatedEdges > 0),
    nextCursor,
    totalNodes,
    totalEdges,
    depthCapped: result.depthCapped === true,
  }
}

/**
 * Continue a truncated exploration. The cursor comes from the model verbatim;
 * when the model only exposes a budget extension we keep a deterministic
 * counter so repeated clicks keep growing the effective budget.
 */
export function advanceExplore(state, result) {
  const explore = normalizeExploreState(state)
  const truncated = Boolean(result && result.truncated === true)
  if (!truncated) {
    return { ...explore, cursor: null, extension: 0 }
  }
  const cursor = result && result.nextCursor !== undefined && result.nextCursor !== null
    ? result.nextCursor
    : null
  if (cursor !== null) return { ...explore, cursor, extension: 0 }
  const extension = viewNumber(explore.extension, 0) + 1
  return { ...explore, cursor: { extension }, extension }
}

/** Reset the cursor (filter/depth/direction/anchor changed) while keeping depth. */
export function resetExploreCursor(state) {
  const explore = normalizeExploreState(state)
  if (explore.cursor === null && viewNumber(explore.extension, 0) === 0) return state
  return { ...explore, cursor: null, extension: 0 }
}

/**
 * Turn exploration off when its anchor disappeared. Returns the same object
 * when nothing changes so React effects do not loop.
 */
export function shouldResetExplore(state, context) {
  const explore = normalizeExploreState(state)
  const anchorId = context && typeof context.anchorId === 'string' ? context.anchorId : ''
  const anchorVisible = Boolean(context && context.anchorVisible === true && anchorId)
  if (explore.on && !anchorVisible) {
    return { ...explore, on: false, cursor: null, extension: 0 }
  }
  return state
}

/**
 * Normalise applyEdgeBudget() output into `{nodes, edges, stats}` and make sure
 * the selected node is part of the rendered node set (spec: always render the
 * selected node even when the edge budget trims its relations).
 */
export function normalizeDrawnResult(result, exploredGraph, selectedId) {
  const base = exploredGraph && Array.isArray(exploredGraph.nodes)
    ? exploredGraph
    : { nodes: [], edges: [] }
  let nodes = base.nodes.slice()
  let edges = Array.isArray(base.edges) ? base.edges : []
  let stats = { keptEdges: edges.length, hiddenEdges: 0, totalEdges: edges.length }
  if (result && typeof result === 'object') {
    const nested = result.graph && typeof result.graph === 'object' ? result.graph : result
    if (Array.isArray(nested.nodes) && nested.nodes.length > 0) nodes = nested.nodes
    if (Array.isArray(nested.edges)) edges = nested.edges
    const source = result.stats && typeof result.stats === 'object' ? result.stats : {}
    const keptEdges = viewNumber(source.keptEdges, edges.length)
    const totalEdges = viewNumber(source.totalEdges, Array.isArray(base.edges) ? base.edges.length : edges.length)
    stats = {
      keptEdges,
      hiddenEdges: viewNumber(source.hiddenEdges, Math.max(0, totalEdges - keptEdges)),
      totalEdges,
    }
  }
  const nodeIds = new Set()
  for (const node of nodes) {
    if (node && typeof node.id === 'string') nodeIds.add(node.id)
  }
  if (typeof selectedId === 'string' && selectedId && !nodeIds.has(selectedId)) {
    const selected = base.nodes.find((node) => node && node.id === selectedId)
    if (selected) {
      nodes = nodes.concat([selected])
      nodeIds.add(selectedId)
    }
  }
  return { nodes, edges, stats }
}

/** Search dropdown selection state for a result list and active index. */
export function searchSelection(matches, activeIndex) {
  const list = Array.isArray(matches) ? matches : []
  if (list.length === 0) return { index: 0, id: null, empty: true }
  const raw = viewNumber(activeIndex, 0)
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(raw)))
  const item = list[index]
  // Match lists may be plain node ids (graph model) or render-ready result
  // objects (the search dropdown). Normalise to the node id either way, so
  // pressing Enter selects a real node instead of passing an object through.
  const candidate = item && typeof item === 'object' ? item.id : item
  const id = typeof candidate === 'string' && candidate.length > 0 ? candidate : null
  return { index, id, empty: id === null }
}

/** Move the active search result by one, wrapping around both ends. */
export function moveSearchIndex(index, delta, length) {
  const count = Math.max(0, Math.floor(viewNumber(length, 0)))
  if (count === 0) return 0
  const current = Math.min(count - 1, Math.max(0, Math.floor(viewNumber(index, 0))))
  const step = viewNumber(delta, 0) < 0 ? -1 : 1
  let next = current + step
  if (next < 0) next = count - 1
  else if (next >= count) next = 0
  return next
}

/** Convert one budget-shaped record into a display record, or null. */
function budgetDisplayRecord(record, key) {
  if (!record || typeof record !== 'object') return null
  // The parser reports `limit` instead of `total`; the model reports `total`.
  const totalCandidate = viewNumberOrNull(record.total) !== null
    ? viewNumberOrNull(record.total)
    : viewNumberOrNull(record.limit)
  const keptRaw = viewNumberOrNull(record.kept)
  if (totalCandidate === null && keptRaw === null) return null
  const kept = keptRaw === null ? 0 : keptRaw
  const totalValue = totalCandidate === null ? kept : totalCandidate
  let truncated = 0
  if (typeof record.truncated === 'number' && record.truncated > 0) truncated = record.truncated
  else if (record.truncated === true) truncated = Math.max(0, totalValue - kept)
  else truncated = Math.max(0, totalValue - kept)
  if (truncated <= 0) return null
  const detail = viewNumberOrNull(record.truncatedNodes)
  return {
    key,
    total: totalCandidate,
    kept,
    truncated,
    detail,
    reason: typeof record.reason === 'string' && record.reason ? record.reason : null,
  }
}

/**
 * Structured budget rows for the status banner, in the spec order:
 * parse -> model nodes -> model literals -> model edges / draw -> explore.
 * `input = { budgets, graph, drawn, explore }`.
 */
export function collectBudgetRecords(input) {
  const source = input && typeof input === 'object' ? input : {}
  const budgets = source.budgets && typeof source.budgets === 'object' ? source.budgets : {}
  const graph = source.graph && typeof source.graph === 'object' ? source.graph : {}
  const drawn = source.drawn && typeof source.drawn === 'object' ? source.drawn : {}
  const explore = source.explore && typeof source.explore === 'object' ? source.explore : {}
  const truncation = graph.truncation && typeof graph.truncation === 'object' ? graph.truncation : {}
  const records = []

  const push = (record) => {
    if (record) records.push(record)
  }
  push(budgetDisplayRecord(budgets.parse, 'parse'))
  push(budgetDisplayRecord(budgets.nodes || truncation.nodes, 'nodes'))
  push(budgetDisplayRecord(budgets.literals || truncation.literals, 'literals'))
  push(budgetDisplayRecord(budgets.edges || truncation.edges, 'edges'))
  // The draw budget is a separate, display-only layer: report it in addition to
  // any model-level edge trimming so no trim is silent (design §1.5).
  const drawnStats = drawn.stats && typeof drawn.stats === 'object' ? drawn.stats : {}
  const hiddenEdges = viewNumber(drawnStats.hiddenEdges, 0)
  if (hiddenEdges > 0) {
    const kept = viewNumber(drawnStats.keptEdges, 0)
    push({
      key: 'draw',
      total: viewNumber(drawnStats.totalEdges, kept + hiddenEdges),
      kept,
      truncated: hiddenEdges,
      reason: 'edge-budget',
    })
  }
  if (explore.truncated === true) {
    const keptNodes = explore.graph && Array.isArray(explore.graph.nodes) ? explore.graph.nodes.length : 0
    const total = explore.totalNodes !== null && explore.totalNodes !== undefined ? explore.totalNodes : null
    records.push({
      key: 'explore',
      total,
      kept: keptNodes,
      truncated: Math.max(1, (total === null ? keptNodes + 1 : total) - keptNodes),
      reason: 'exploration-budget',
    })
  }
  return records
}

/**
 * Group diagnostics by code: localized label + count in the banner, raw
 * samples behind an expander (max 3 per code). The legacy `issues` string
 * list becomes one aggregated group so old callers keep working.
 */
export function groupDiagnostics(diagnostics, issues) {
  const byCode = new Map()
  const add = (code, severity, count, message, samples) => {
    const key = typeof code === 'string' && code ? code : 'unknown'
    let group = byCode.get(key)
    if (!group) {
      group = { code: key, severity: severity === 'error' ? 'error' : 'warning', count: 0, samples: [], message: '' }
      byCode.set(key, group)
    }
    group.count += Math.max(1, Math.floor(viewNumber(count, 1)))
    if (group.severity !== 'error' && severity === 'error') group.severity = 'error'
    if (!group.message && typeof message === 'string' && message) group.message = message
    const list = Array.isArray(samples) ? samples : []
    for (const sample of list) {
      if (typeof sample !== 'string' || !sample) continue
      if (group.samples.length >= VIEW_DIAGNOSTIC_SAMPLES) break
      if (group.samples.indexOf(sample) >= 0) continue
      group.samples.push(sample)
    }
  }
  const list = Array.isArray(diagnostics) ? diagnostics : []
  for (const diagnostic of list) {
    if (!diagnostic || typeof diagnostic !== 'object') continue
    const samples = Array.isArray(diagnostic.sample) ? diagnostic.sample
      : Array.isArray(diagnostic.samples) ? diagnostic.samples : []
    add(diagnostic.code, diagnostic.severity, diagnostic.count, diagnostic.message, samples)
  }
  // `issues` is the legacy human-readable fallback; prefer structured
  // diagnostics when the caller supplies them (avoids double-reporting).
  const issueList = Array.isArray(issues) ? issues : []
  if (list.length === 0) {
    for (const issue of issueList) {
      if (typeof issue !== 'string' || !issue.trim()) continue
      add(VIEW_ISSUE_CODE, 'warning', 1, '', [issue])
    }
  }
  const groups = Array.from(byCode.values())
  groups.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
  let errors = 0
  let warnings = 0
  let total = 0
  for (const group of groups) {
    if (group.severity === 'error') errors += group.count
    else warnings += group.count
    total += group.count
  }
  return { groups, total, errors, warnings }
}

// ---------------------------------------------------------------------------
// React components (created once per Client module load)
// ---------------------------------------------------------------------------

/**
 * @param {any} React the host React module
 * @returns {{PrimaryToolbar: function, SearchControl: function, FilterPanel: function,
 *   ExplorePanel: function, NoticeBar: function, StatusBanner: function, EmptyState: function}}
 */
export function createGraphViewControls(React) {
  const h = React.createElement

  const iconCircle = () => h('svg', {
    key: 'icon', className: 'dov-empty-icon', viewBox: '0 0 64 64', 'aria-hidden': 'true',
  },
  h('line', { x1: 22, y1: 24, x2: 42, y2: 36 }), h('line', { x1: 22, y1: 40, x2: 42, y2: 28 }),
  h('circle', { cx: 20, cy: 24, r: 6 }), h('circle', { cx: 44, cy: 36, r: 6 }), h('circle', { cx: 20, cy: 40, r: 6 }))

  // --- search -------------------------------------------------------------
  function SearchControl(props) {
    const tr = props.tr
    const open = props.open === true
    const listboxId = props.listboxId
    const results = Array.isArray(props.results) ? props.results : []
    const activeIndex = viewNumber(props.activeIndex, 0)
    const optionId = open && results.length > 0 ? listboxId + '-' + String(activeIndex) : undefined
    const input = h('input', {
      className: 'dov-search-input',
      type: 'text',
      value: typeof props.query === 'string' ? props.query : '',
      placeholder: tr('viewer.searchPlaceholder', '搜索标签或 IRI'),
      'aria-label': tr('viewer.searchPlaceholder', '搜索标签或 IRI'),
      spellCheck: false,
      disabled: props.disabled === true,
      role: 'combobox',
      'aria-expanded': open,
      'aria-controls': listboxId,
      'aria-autocomplete': 'list',
      'aria-activedescendant': optionId,
      onChange: (event) => props.onChange(event.target.value),
      onKeyDown: props.onKeyDown,
      onFocus: props.onFocus,
      onBlur: props.onBlur,
    })
    const count = props.active === true
      ? h('span', {
        key: 'count',
        className: 'dov-search-count' + (results.length === 0 ? ' dov-search-count--none' : ''),
      }, formatTemplate(tr('viewer.results', '{n} 个结果'), { n: results.length }))
      : null
    const clear = props.active === true
      ? h('button', {
        key: 'clear',
        type: 'button',
        className: 'dov-search-clear',
        title: tr('viewer.clearSearch', '清除搜索'),
        'aria-label': tr('viewer.clearSearch', '清除搜索'),
        onClick: props.onClear,
      }, '×')
      : null
    let list = null
    if (open) {
      const children = []
      if (results.length === 0) {
        children.push(h('li', { key: 'empty', className: 'dov-search-empty', role: 'presentation' },
          tr('viewer.noResults', '没有匹配结果')))
      } else {
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index]
          children.push(h('li', {
            key: result.id,
            id: listboxId + '-' + String(index),
            role: 'option',
            'aria-selected': index === activeIndex,
            className: 'dov-search-option',
            title: result.label + '\n' + result.iri,
            onMouseDown: (event) => event.preventDefault(),
            onMouseEnter: () => { if (props.onHover) props.onHover(index) },
            onClick: () => props.onSelect(result.id),
          },
          h('span', { className: 'dov-chip', key: 'chip' }, props.kindLabel(result.kind)),
          h('span', { className: 'dov-search-option-label', key: 'label' }, result.label),
          h('span', { className: 'dov-search-iri', key: 'iri' }, props.shortIri(result.iri))))
        }
      }
      list = h('ul', {
        key: 'list',
        className: 'dov-search-list',
        id: listboxId,
        role: 'listbox',
        'aria-label': tr('viewer.searchPlaceholder', '搜索标签或 IRI'),
      }, children)
    }
    return h('div', { className: 'dov-search-wrap' },
      h('div', { key: 'box', className: 'dov-search' }, input, count, clear),
      list)
  }

  // --- primary toolbar row -------------------------------------------------
  function PrimaryToolbar(props) {
    const tr = props.tr
    const counts = props.counts || { nodes: 0, totalNodes: 0, edges: 0, totalEdges: 0, triples: 0 }
    const action = (key, label, onClick, extra) => h('button', {
      key,
      type: 'button',
      onClick,
      className: 'dov-btn' + (extra && extra.icon ? ' dov-btn--icon' : ''),
      disabled: extra && extra.disabled ? true : undefined,
      'aria-pressed': extra && extra.pressed !== undefined ? extra.pressed : undefined,
      'aria-expanded': extra && extra.expanded !== undefined ? extra.expanded : undefined,
      'aria-haspopup': extra && extra.haspopup,
      title: extra && extra.title,
      'aria-label': extra && extra.title,
    }, label)
    const search = props.search || {}
    const badges = []
    if (props.badge) {
      badges.push(h('span', { key: 'badge', className: 'dov-badge dov-badge--warn' }, props.badge))
    }
    if (props.drawn && props.drawn.hidden > 0) {
      badges.push(h('span', { key: 'drawn', className: 'dov-badge' },
        formatTemplate(tr('viewer.drawnEdges', '已绘制 {kept} / {total} 条边'),
          { kept: props.drawn.kept, total: props.drawn.total })))
    }
    const zoomGroup = [
      action('zoom-out', '−', props.onZoomOut, {
        icon: true, disabled: props.isEmpty, title: tr('viewer.zoomOut', '缩小'),
      }),
      h('span', { key: 'zoom', className: 'dov-zoom', 'aria-live': 'polite' }, Math.round(viewNumber(props.zoom, 1) * 100) + '%'),
      action('zoom-in', '+', props.onZoomIn, {
        icon: true, disabled: props.isEmpty, title: tr('viewer.zoomIn', '放大'),
      }),
    ]
    return h('header', { key: 'header', className: 'dov-header' },
      h('span', {
        key: 'source',
        className: 'dov-source',
        title: typeof props.sourceName === 'string' ? props.sourceName : '',
      }, props.sourceName ? props.sourceName : tr('viewer.untitled', '未命名')),
      badges.length > 0 ? h('span', { key: 'badges', className: 'dov-stats' }, badges) : null,
      h('div', { key: 'stats', className: 'dov-stats' },
        h('span', {
          key: 'nodes',
          className: 'dov-stat',
          'aria-live': 'polite',
          title: tr('viewer.visible', '可见') + ' / ' + tr('viewer.total', '总数'),
        },
        h('b', null, String(counts.nodes)), ' / ', String(counts.totalNodes), ' ', tr('viewer.nodes', '节点')),
        h('span', { key: 'edges', className: 'dov-stat' },
          h('b', null, String(counts.edges)), ' / ', String(counts.totalEdges), ' ', tr('viewer.edges', '边')),
        h('span', { key: 'triples', className: 'dov-stat' },
          h('b', null, String(counts.triples)), ' ', tr('viewer.triples', '三元组'))),
      h('div', { key: 'spacer', className: 'dov-spacer' }),
      h('div', { key: 'actions', className: 'dov-actions' },
        h(SearchControl, {
          key: 'search',
          tr,
          query: search.query,
          active: search.active,
          open: search.open,
          results: search.results,
          activeIndex: search.activeIndex,
          listboxId: search.listboxId,
          disabled: search.disabled,
          kindLabel: props.kindLabel,
          shortIri: props.shortIri,
          onChange: search.onChange,
          onKeyDown: search.onKeyDown,
          onFocus: search.onFocus,
          onBlur: search.onBlur,
          onClear: search.onClear,
          onSelect: search.onSelect,
          onHover: search.onHover,
        }),
        action('labels', tr('viewer.labels', '标签'), props.onToggleLabels,
          { pressed: props.labelsOn, disabled: props.isEmpty }),
        action('filter', tr('viewer.filters', '过滤'), props.onToggleFilter, {
          pressed: props.filterActive,
          expanded: props.filterOpen,
          haspopup: 'dialog',
          disabled: props.isEmpty,
          title: tr('viewer.filters', '过滤'),
        }),
        action('explore', tr('viewer.explore', '邻域探索'), props.onToggleExplore, {
          pressed: props.exploreOn,
          expanded: props.exploreOpen,
          haspopup: 'dialog',
          disabled: !props.canExplore,
          title: props.canExplore
            ? tr('viewer.explore', '邻域探索')
            : tr('viewer.exploreNeedsSelection', '请先选择一个节点'),
        }),
        action('relayout', '↻ ' + tr('viewer.relayout', '重新布局'), props.onRelayout, {
          disabled: props.isEmpty || props.relayoutBusy,
        }),
        h('span', { key: 'sep-zoom', className: 'dov-toolbar-sep' }),
        zoomGroup[0],
        zoomGroup[1],
        zoomGroup[2],
        action('fit', tr('viewer.fit', '适配视图'), props.onFit, { disabled: props.isEmpty }),
        props.selectedNode ? action('details', tr('viewer.details', '详情'),
          props.onToggleDetails, { pressed: props.panelOpen }) : null))
  }

  // --- filter popover ------------------------------------------------------
  function FilterPanel(props) {
    const tr = props.tr
    const filter = normalizeFilterState(props.filter)
    const predicateOptions = Array.isArray(props.predicateOptions) ? props.predicateOptions : []
    const counts = props.counts || { nodes: { visible: 0, total: 0 }, edges: { visible: 0, total: 0 } }
    const active = isFilterActive(filter)
    const hasAnchor = typeof props.anchorLabel === 'string' && props.anchorLabel.length > 0
    const kindRows = VIEW_KINDS.map((kind) => h('label', { key: kind, className: 'dov-check' },
      h('input', {
        type: 'checkbox',
        checked: filter.kinds.indexOf(kind) >= 0,
        onChange: () => props.onToggleKind(kind),
      }),
      h('span', { className: 'dov-check-label' }, props.kindLabel(kind))))
    const predicateRows = predicateOptions.map((option) => h('label', {
      key: option.predicate,
      className: 'dov-check',
      title: option.predicate,
    },
    h('input', {
      type: 'checkbox',
      checked: filter.predicates.indexOf(option.predicate) >= 0,
      onChange: () => props.onTogglePredicate(option.predicate),
    }),
    h('span', { className: 'dov-check-label' }, option.label),
    h('span', { className: 'dov-check-count' },
      formatTemplate(tr('viewer.filterEdgeCount', '{n} 条边'), { n: option.count }))))
    const directionRows = VIEW_DIRECTIONS.map((direction) => h('button', {
      key: direction,
      type: 'button',
      className: 'dov-radio',
      'aria-pressed': filter.direction === direction,
      disabled: !hasAnchor,
      onClick: () => props.onDirection(direction),
    }, tr('viewer.direction.' + direction, VIEW_DIRECTION_LABELS[direction])))
    const countLine = (label, fallback, visible, total) => h('span', null,
      tr(label, fallback) + ' ' + String(visible) + ' / ' + String(total))
    return h('section', {
      className: 'dov-pop dov-pop--wide',
      role: 'dialog',
      'aria-label': tr('viewer.filters', '过滤'),
    },
    h('div', { key: 'head', className: 'dov-pop-head' },
      h('span', { className: 'dov-pop-title' }, tr('viewer.filters', '过滤')),
      h('button', {
        type: 'button',
        className: 'dov-btn dov-btn--icon',
        title: tr('viewer.close', '关闭'),
        'aria-label': tr('viewer.close', '关闭'),
        onClick: props.onClose,
      }, '×')),
    h('div', { key: 'body', className: 'dov-pop-body' },
      h('section', { key: 'kinds', className: 'dov-pop-section' },
        h('span', { className: 'dov-pop-label' }, tr('viewer.filterKinds', '节点类型')),
        h('div', { className: 'dov-check-list' }, kindRows),
        h('div', { className: 'dov-pop-hint' }, tr('viewer.filterKindsHint', '不选择任何类型表示全部类型'))),
      h('section', { key: 'predicates', className: 'dov-pop-section' },
        h('span', { className: 'dov-pop-label' }, tr('viewer.filterPredicates', '关系类型')),
        predicateOptions.length === 0
          ? h('div', { className: 'dov-pop-hint' }, tr('viewer.filterNoPredicates', '当前图没有可过滤的关系谓词'))
          : h('div', { className: 'dov-check-list' }, predicateRows),
        h('div', { className: 'dov-pop-hint' },
          tr('viewer.filterPredicatesHint', '不选择任何谓词表示全部关系'))),
      h('section', { key: 'direction', className: 'dov-pop-section' },
        h('span', { className: 'dov-pop-label' }, tr('viewer.filterDirection', '关系方向')),
        h('div', { className: 'dov-radio-row' }, directionRows),
        h('div', { className: 'dov-pop-hint' },
          props.exploreOn
            ? tr('viewer.filterDirectionInExplore', '探索开启时方向由探索控件决定')
            : hasAnchor
              ? formatTemplate(tr('viewer.filterAnchorKept', '选中节点始终保留：{label}'), { label: props.anchorLabel })
              : tr('viewer.filterDirectionNoAnchor', '选择节点后才能过滤方向'))),
      h('section', { key: 'counts', className: 'dov-pop-section' },
        h('div', { className: 'dov-pop-counts' },
          countLine('viewer.nodes', '节点', counts.nodes.visible, counts.nodes.total),
          countLine('viewer.edges', '边', counts.edges.visible, counts.edges.total)))),
    h('div', { key: 'footer', className: 'dov-pop-footer' },
      h('button', {
        type: 'button',
        className: 'dov-btn dov-btn--small',
        disabled: !active,
        onClick: props.onClear,
      }, tr('viewer.clearFilters', '清除过滤'))))
  }

  // --- exploration popover -------------------------------------------------
  function ExplorePanel(props) {
    const tr = props.tr
    const explore = normalizeExploreState(props.explore)
    const hasAnchor = typeof props.selectedLabel === 'string' && props.selectedLabel.length > 0
    const depthButtons = []
    for (let depth = VIEW_MIN_DEPTH; depth <= VIEW_MAX_DEPTH; depth += 1) {
      depthButtons.push(h('button', {
        key: 'depth-' + String(depth),
        type: 'button',
        className: 'dov-radio',
        'aria-pressed': explore.depth === depth,
        disabled: !hasAnchor,
        onClick: () => props.onDepth(depth),
      }, formatTemplate(tr('viewer.hops', '{n} 跳'), { n: depth })))
    }
    const directionButtons = VIEW_DIRECTIONS.map((direction) => h('button', {
      key: direction,
      type: 'button',
      className: 'dov-radio',
      'aria-pressed': explore.direction === direction,
      disabled: !hasAnchor,
      onClick: () => props.onDirection(direction),
    }, tr('viewer.direction.' + direction, VIEW_DIRECTION_LABELS[direction])))
    const summary = explore.on
      ? h('section', { key: 'summary', className: 'dov-pop-section' },
        h('div', { className: 'dov-pop-counts' },
          h('span', null, formatTemplate(tr('viewer.exploreSummary', '已展开 {nodes} 个节点 / {edges} 条边'), {
            nodes: viewNumber(props.keptNodes, 0),
            edges: viewNumber(props.keptEdges, 0),
          }))),
        props.truncated === true
          ? h('div', { className: 'dov-pop-hint' },
            props.totalNodes !== null && props.totalNodes !== undefined
              ? formatTemplate(tr('viewer.truncationExplore', '邻域展开裁剪：已展开 {kept} / 共 {total}'),
                { kept: viewNumber(props.keptNodes, 0), total: props.totalNodes })
              : tr('viewer.exploreTruncated', '邻域展开已达到预算上限'))
          : null,
        props.canMore === true
          ? h('div', { key: 'more', className: 'dov-pop-row' },
            h('button', { type: 'button', className: 'dov-btn dov-btn--small', onClick: props.onMore },
              tr('viewer.exploreMore', '继续展开')))
          : null)
      : null
    return h('section', {
      className: 'dov-pop',
      role: 'dialog',
      'aria-label': tr('viewer.explore', '邻域探索'),
    },
    h('div', { key: 'head', className: 'dov-pop-head' },
      h('span', { className: 'dov-pop-title' }, tr('viewer.explore', '邻域探索')),
      h('button', {
        type: 'button',
        className: 'dov-btn dov-btn--icon',
        title: tr('viewer.close', '关闭'),
        'aria-label': tr('viewer.close', '关闭'),
        onClick: props.onClose,
      }, '×')),
    h('div', { key: 'body', className: 'dov-pop-body' },
      hasAnchor
        ? h('div', { key: 'anchor', className: 'dov-pop-hint' },
          formatTemplate(tr('viewer.exploreRoot', '探索根：{label}'), { label: props.selectedLabel }))
        : h('div', { key: 'anchor', className: 'dov-pop-hint' },
          tr('viewer.exploreNeedsSelection', '请先选择一个节点')),
      h('section', { key: 'toggle', className: 'dov-pop-section' },
        h('button', {
          type: 'button',
          className: 'dov-btn',
          'aria-pressed': explore.on,
          disabled: !hasAnchor,
          onClick: props.onToggle,
        }, explore.on ? tr('viewer.exploreStop', '回到完整视图') : tr('viewer.exploreStart', '展开邻域'))),
      h('section', { key: 'depth', className: 'dov-pop-section' },
        h('span', { className: 'dov-pop-label' }, tr('viewer.exploreDepth', '跳数')),
        h('div', { className: 'dov-radio-row' }, depthButtons),
        h('div', { className: 'dov-pop-hint' },
          formatTemplate(tr('viewer.maxHops', '最多 {n} 跳'), { n: VIEW_MAX_DEPTH }))),
      h('section', { key: 'direction', className: 'dov-pop-section' },
        h('span', { className: 'dov-pop-label' }, tr('viewer.filterDirection', '关系方向')),
        h('div', { className: 'dov-radio-row' }, directionButtons)),
      summary))
  }

  // --- transient notice (hidden selection / switched root) -----------------
  function NoticeBar(props) {
    const tr = props.tr
    const notice = props.notice && typeof props.notice === 'object' ? props.notice : { kind: '' }
    const label = typeof notice.nodeLabel === 'string' ? notice.nodeLabel : ''
    let text = ''
    if (notice.kind === 'selection-hidden') {
      text = tr('viewer.hiddenSelection', '当前选择被过滤隐藏') + (label ? '：' + label : '')
    } else if (notice.kind === 'explore-root-switched') {
      text = tr('viewer.exploreRootChanged', '探索根已切换为当前选择') + (label ? '：' + label : '')
    } else if (typeof notice.message === 'string') {
      text = notice.message
    }
    const actions = []
    if (notice.kind === 'selection-hidden' && props.filterActive) {
      actions.push(h('button', {
        key: 'clear',
        type: 'button',
        className: 'dov-btn dov-btn--small',
        onClick: props.onClearFilters,
      }, tr('viewer.showAll', '显示全部')))
    }
    if (notice.kind === 'selection-hidden') {
      actions.push(h('button', {
        key: 'locate',
        type: 'button',
        className: 'dov-btn dov-btn--small',
        onClick: props.onLocate,
      }, tr('viewer.locateSelection', '定位选择')))
    }
    actions.push(h('button', {
      key: 'dismiss',
      type: 'button',
      className: 'dov-btn dov-btn--small',
      onClick: props.onDismiss,
    }, tr('viewer.noticeDismiss', '关闭提示')))
    return h('div', { className: 'dov-notice', role: 'status', 'aria-live': 'polite' },
      h('span', { key: 'text', className: 'dov-notice-text' }, text),
      h('div', { key: 'actions', className: 'dov-notice-actions' }, actions))
  }

  // --- truncation + diagnostics banner ------------------------------------
  function StatusBanner(props) {
    const tr = props.tr
    const [expandedCode, setExpandedCode] = React.useState(null)
    const budgetRecords = Array.isArray(props.budgetRecords) ? props.budgetRecords : []
    const diagnostics = props.diagnosticGroups || { groups: [], errors: 0, warnings: 0, total: 0 }
    const groups = Array.isArray(diagnostics.groups) ? diagnostics.groups : []
    // A plain ready view must not nag about the entry size limit; the surface
    // note is rendered inside the banner only when there is another signal.
    const signalCount = budgetRecords.length + groups.length + (props.degraded ? 1 : 0)
    if (signalCount === 0) return null
    const open = props.open === true
    const budgetText = (record) => {
      const kept = record.kept
      const total = record.total === null || record.total === undefined ? '?' : record.total
      if (record.key === 'parse') {
        return formatTemplate(tr('viewer.truncationParse', '解析已截断：保留 {kept} / 上限 {limit} 条三元组'),
          { kept, limit: total })
      }
      if (record.key === 'nodes') {
        return formatTemplate(tr('viewer.truncationNodes', '图谱裁剪：保留 {kept} / 共 {total} 个节点'),
          { kept, total })
      }
      if (record.key === 'literals') {
        return tr('viewer.literals', '字面量属性') + '：' +
          formatTemplate(tr('viewer.literalsTruncated', '已显示 {kept} / 共 {total}'),
            { kept: record.kept, total: total === '?' ? kept : total })
      }
      if (record.key === 'edges' || record.key === 'draw') {
        return formatTemplate(tr('viewer.truncationEdges', '绘制裁剪：已绘制 {kept} / 共 {total} 条边'),
          { kept, total })
      }
      return formatTemplate(tr('viewer.truncationExplore', '邻域展开裁剪：已展开 {kept} / 共 {total}'),
        { kept, total })
    }
    const surfaceText = () => {
      const limit = props.surfaceLimit
      if (!limit || typeof limit !== 'object') return ''
      const mib = typeof limit.bytes === 'number' && Number.isFinite(limit.bytes)
        ? Math.round(limit.bytes / (1024 * 1024) * 10) / 10
        : '?'
      return formatTemplate(tr('viewer.surfaceLimit', '本入口文件大小上限约 {size}'),
        { size: mib === '?' ? '?' : mib + ' MiB' })
    }
    const renderGroup = (group) => {
      const expanded = expandedCode === group.code
      const samples = Array.isArray(group.samples) ? group.samples.slice(0, VIEW_DIAGNOSTIC_SAMPLES) : []
      return h('div', { key: group.code, className: 'dov-diag-group' },
        h('button', {
          type: 'button',
          className: 'dov-diag-head',
          'aria-expanded': expanded,
          onClick: () => setExpandedCode(expanded ? null : group.code),
        },
        h('span', { 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
        h('span', { className: 'dov-diag-code' }, tr('diag.' + group.code, group.message || group.code)),
        h('span', { className: 'dov-diag-count' }, '×' + String(group.count))),
        expanded && samples.length > 0
          ? h('ul', { className: 'dov-diag-samples' },
            samples.map((sample, index) => h('li', { key: 'sample-' + String(index) }, sample)),
            group.count > samples.length
              ? h('li', { key: 'omitted' },
                formatTemplate(tr('viewer.diagnosticsMore', '还有 {n} 条未显示'), { n: group.count - samples.length }))
              : null)
          : null)
    }
    const errorGroups = groups.filter((group) => group.severity === 'error')
    const warningGroups = groups.filter((group) => group.severity !== 'error')
    return h('div', { className: 'dov-issues' },
      h('button', {
        type: 'button',
        className: 'dov-issues-toggle',
        'aria-expanded': open,
        onClick: props.onToggle,
      },
      h('span', { 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h('span', null, tr('viewer.issues', '解析提示') + ' (' + String(signalCount) + ')')),
      open
        ? h('div', { key: 'body', className: 'dov-issues-list' },
          budgetRecords.length > 0
            ? h('div', { key: 'budgets' },
              h('div', { className: 'dov-section-title' }, tr('viewer.truncation', '显示裁剪')),
              h('ul', { className: 'dov-budget-list' }, budgetRecords.map((record) => h('li', {
                key: record.key,
                className: 'dov-budget-row',
              },
              h('span', null, budgetText(record)),
              record.reason
                ? h('span', { className: 'dov-budget-reason' },
                  formatTemplate(tr('viewer.truncationReason', '原因：{reason}'), { reason: record.reason }))
                : null))))
            : null,
          props.degraded
            ? h('div', { key: 'degraded', className: 'dov-budget-note' },
              tr('state.degraded', '性能降级模式：后台计算不可用，已降低解析与显示上限。'))
            : null,
          props.surfaceLimit
            ? h('div', { key: 'surface', className: 'dov-budget-note' }, surfaceText())
            : null,
          groups.length > 0
            ? h('div', { key: 'diag-title', className: 'dov-section-title' },
              tr('viewer.diagnostics', '诊断'))
            : null,
          errorGroups.length > 0
            ? h('div', { key: 'diag-errors', className: 'dov-section-title' },
              tr('viewer.diagnosticsErrors', '错误'))
            : null,
          errorGroups.map((group) => renderGroup(group)),
          warningGroups.length > 0
            ? h('div', { key: 'diag-warnings', className: 'dov-section-title' },
              tr('viewer.diagnosticsWarnings', '警告'))
            : null,
          warningGroups.map((group) => renderGroup(group)))
        : null)
  }

  // --- empty / computing states -------------------------------------------
  function EmptyState(props) {
    const tr = props.tr
    const kind = typeof props.kind === 'string' ? props.kind : 'empty-file'
    if (kind === 'computing') {
      return h('div', { className: 'dov-computing', role: 'status', 'aria-live': 'polite' },
        h('div', { className: 'dov-spinner', 'aria-hidden': 'true' }),
        h('div', null, tr('viewer.computing', '正在计算…')))
    }
    let title = tr('viewer.emptyTitle', '暂无可视化节点')
    let hint = tr('viewer.emptyHint', '这个文件没有可绘制的 RDF 三元组。')
    const actions = []
    if (kind === 'filtered') {
      title = tr('viewer.filteredEmpty', '当前过滤条件下没有可显示的节点。')
      hint = ''
      if (props.onRestore) {
        actions.push(h('button', {
          key: 'restore', type: 'button', className: 'dov-btn dov-btn--small', onClick: props.onRestore,
        }, tr('viewer.showAll', '显示全部')))
      }
    } else if (kind === 'no-drawable') {
      title = tr('viewer.noDrawableTitle', '暂无可绘制节点')
      hint = tr('viewer.noDrawableHint', '已保留的图模型中没有可绘制节点（可能被预算裁剪）。')
    } else if (kind === 'layout-error') {
      title = tr('viewer.layoutErrorTitle', '布局计算失败')
      hint = tr('viewer.layoutErrorHint', '可尝试重新布局。')
      if (props.onRelayout) {
        actions.push(h('button', {
          key: 'relayout', type: 'button', className: 'dov-btn dov-btn--small', onClick: props.onRelayout,
        }, tr('viewer.relayout', '重新布局')))
      }
    }
    return h('div', { className: 'dov-empty', role: 'status' },
      iconCircle(),
      h('div', { key: 'title', className: 'dov-empty-title' }, title),
      hint ? h('div', { key: 'hint', className: 'dov-empty-hint' }, hint) : null,
      actions.length > 0 ? h('div', { key: 'actions', className: 'dov-empty-actions' }, actions) : null)
  }

  return { PrimaryToolbar, SearchControl, FilterPanel, ExplorePanel, NoticeBar, StatusBanner, EmptyState }
}
