/**
 * Per-view workspace state cache.
 *
 * The workspace keeps one state object per view (query, tree expansion, layered
 * orientation/predicates and the network camera) so switching views restores
 * what the user had instead of resetting it. Selection stays shared across
 * views by design; this store only covers view-local values.
 */

const VIEW_IDS = ['network', 'tree', 'layered']

function viewStateIsObject(value) {
  return value !== null && typeof value === 'object'
}

function viewStateNormalizeView(view) {
  return view === 'tree' || view === 'layered' ? view : 'network'
}

/** Create an empty store. */
export function createViewStateStore() {
  return { active: 'network', views: {}, layoutRevision: 0 }
}

/** Snapshot one view's local state (partial patches merge). */
export function snapshotView(store, view, patch) {
  const state = viewStateIsObject(store) ? store : createViewStateStore()
  if (!state.views) state.views = {}
  const key = viewStateNormalizeView(view)
  const previous = viewStateIsObject(state.views[key]) ? state.views[key] : {}
  const next = Object.assign({}, previous)
  if (viewStateIsObject(patch)) {
    for (const name of Object.keys(patch)) {
      if (patch[name] !== undefined) next[name] = patch[name]
    }
  }
  next.revision = typeof state.layoutRevision === 'number' ? state.layoutRevision : 0
  state.views[key] = next
  return next
}

/** Read one view's snapshot (empty object when never saved). */
export function viewSnapshot(store, view) {
  if (!viewStateIsObject(store) || !viewStateIsObject(store.views)) return {}
  const saved = store.views[viewStateNormalizeView(view)]
  return viewStateIsObject(saved) ? Object.assign({}, saved) : {}
}

/** Record the current layout revision; older snapshots become stale. */
export function markLayoutRevision(store, revision) {
  if (!viewStateIsObject(store)) return 0
  store.layoutRevision = Number(revision) || 0
  return store.layoutRevision
}

/** True when a saved snapshot predates the current layout. */
export function isViewSnapshotStale(store, view) {
  if (!viewStateIsObject(store)) return false
  const saved = viewSnapshot(store, view)
  if (typeof saved.revision !== 'number') return false
  return saved.revision !== (typeof store.layoutRevision === 'number' ? store.layoutRevision : 0)
}

/**
 * Validate shared workspace state when the retained graph or workset changes.
 * Missing selections/anchors are removed; explorer cursors are always dropped
 * because a cursor belongs to an exact projection revision.
 */
export function reconcileWorkspaceState(state, graph, sourceIds) {
  const input = viewStateIsObject(state) ? state : {}
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : []
  const valid = new Set(nodes.map(node => node && node.id).filter(id => typeof id === 'string'))
  const filter = input.filter && typeof input.filter === 'object' ? input.filter : {}
  const explore = input.explore && typeof input.explore === 'object' ? input.explore : {}
  const allowedSources = Array.isArray(sourceIds) ? new Set(sourceIds) : null
  const predicates = Array.isArray(filter.predicates)
    ? filter.predicates.filter(value => graph && graph.edges && graph.edges.some(edge => edge.p === value)) : []
  const anchorId = typeof input.anchorId === 'string' && valid.has(input.anchorId) ? input.anchorId : null
  return {
    query: typeof input.query === 'string' ? input.query : '',
    selectedId: typeof input.selectedId === 'string' && valid.has(input.selectedId) ? input.selectedId : null,
    anchorId,
    filter: {
      kinds: Array.isArray(filter.kinds) ? filter.kinds.slice() : [],
      predicates,
      direction: ['both', 'out', 'in'].includes(filter.direction) ? filter.direction : 'both',
      sourceIds: allowedSources && Array.isArray(filter.sourceIds)
        ? filter.sourceIds.filter(id => allowedSources.has(id)) : (Array.isArray(filter.sourceIds) ? filter.sourceIds.slice() : []),
    },
    explore: Object.assign({}, explore, {
      on: Boolean(explore.on && anchorId),
      cursor: null,
      extension: 0,
    }),
  }
}

/** All known view ids, for state-matrix tests and docs. */
export function viewStateIds() {
  return VIEW_IDS.slice()
}
