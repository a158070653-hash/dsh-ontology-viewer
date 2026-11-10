/**
 * Node tests for the pure view-state helpers split out of graph-view.js.
 *
 * These helpers hold the filter/explore/search/budget/detail state logic that
 * the React components consume; the components themselves need React and are
 * covered by the runtime acceptance checklist. Importing the modules must not
 * require React (verified implicitly: this file imports them at load time).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

test('exploration stays clear at rest; hover temporarily focuses one hop', () => {
  assert.equal(highlightAnchor(false, 'Book', null), 'Book')
  assert.equal(highlightAnchor(true, 'Book', null), null)
  assert.equal(highlightAnchor(true, 'Book', 'Book-001'), 'Book-001')
  assert.equal(highlightAnchor(true, 'Book', null), null, 'moving off the hovered node restores the exploration scope')
  assert.equal(highlightAnchor(false, 'Book', 'title'), 'title')
})

test('highlightNeighborhood returns only the active node and its direct neighbours', () => {
  const adjacency = new Map([
    ['Book', ['Book-001', 'Class']],
    ['Book-001', ['Book', 'Loan-42']],
  ])
  assert.deepEqual([...highlightNeighborhood('Book', adjacency)], ['Book', 'Book-001', 'Class'])
  assert.equal(highlightNeighborhood(null, adjacency), null)
  assert.deepEqual([...highlightNeighborhood('unknown', adjacency)], ['unknown'])
})

test('highlightRelation highlights only edges incident to the active node', () => {
  assert.equal(highlightRelation('Book', 'Class', 'Book'), true)
  assert.equal(highlightRelation('Loan-42', 'Book-001', 'Book'), false)
  assert.equal(highlightRelation('Book', 'Book', 'Book'), true)
  assert.equal(highlightRelation('Book', 'Class', null), false)
})

test('moveRovingId navigates and wraps without relying on host Tab order', () => {
  const order = ['a', 'b', 'c']
  assert.equal(moveRovingId(order, 'a', 'ArrowRight'), 'b')
  assert.equal(moveRovingId(order, 'a', 'ArrowDown'), 'b')
  assert.equal(moveRovingId(order, 'c', 'ArrowRight'), 'a')
  assert.equal(moveRovingId(order, 'a', 'ArrowLeft'), 'c')
  assert.equal(moveRovingId(order, 'a', 'ArrowUp'), 'c')
  assert.equal(moveRovingId(order, 'b', 'Home'), 'a')
  assert.equal(moveRovingId(order, 'b', 'End'), 'c')
  assert.equal(moveRovingId(order, null, 'ArrowRight'), 'a')
  assert.equal(moveRovingId([], 'a', 'ArrowRight'), null)
})

test('graph shortcuts are handled only by graph-owned focus targets', () => {
  const root = { contains: (node) => node === root || node === graphTarget }
  const graphTarget = {
    closest: (selector) => selector === '[data-dov-graph-focus]' ? graphTarget : null,
  }
  const outsideTarget = { closest: () => null }
  const dshOwnedNode = { closest: (selector) => selector === '[data-dov-graph-focus]' ? dshOwnedNode : null }
  const wrongRoot = { contains: () => false }
  assert.equal(ownsGraphKeyboardFocus(graphTarget, root), true)
  assert.equal(ownsGraphKeyboardFocus(dshOwnedNode, root), false)
  assert.equal(ownsGraphKeyboardFocus(graphTarget, wrongRoot), false)
  assert.equal(graphShortcutAction('f', graphTarget, root), 'fit')
  assert.equal(graphShortcutAction('+', graphTarget, root), 'zoom-in')
  assert.equal(graphShortcutAction('=', graphTarget, root), 'zoom-in')
  assert.equal(graphShortcutAction('-', graphTarget, root), 'zoom-out')
  assert.equal(graphShortcutAction('0', graphTarget, root), 'fit')
  assert.equal(graphShortcutAction('Escape', graphTarget, root), 'escape')
  assert.equal(graphShortcutAction('Tab', graphTarget, root), null)
  assert.equal(graphShortcutAction('f', outsideTarget, root), null, 'DSH-owned focus must not trigger graph shortcuts')
  assert.equal(graphShortcutAction('+', null, root), null)
})

import {
  highlightAnchor,
  highlightNeighborhood,
  highlightRelation,
  ownsGraphKeyboardFocus,
  graphShortcutAction,
  moveRovingId,
  VIEW_KINDS,
  VIEW_DIRECTIONS,
  emptyFilterState,
  normalizeFilterState,
  toggleFilterValue,
  isFilterActive,
  filterCriteria,
  derivePredicateOptions,
  deriveVisibleCounts,
  isNodeVisibleUnderFilter,
  clampExploreDepth,
  createExploreState,
  withExploreDepth,
  withExploreDirection,
  exploreCriteria,
  normalizeProjectionResult,
  normalizeExploreResult,
  advanceExplore,
  resetExploreCursor,
  shouldResetExplore,
  normalizeDrawnResult,
  searchSelection,
  moveSearchIndex,
  collectBudgetRecords,
  groupDiagnostics,
  formatTemplate,
  VIEW_MIN_DEPTH,
  VIEW_MAX_DEPTH,
} from '../src/graph-view-controls.js'

import {
  DETAILS_SECTIONS,
  DETAILS_GROUP_LIMIT,
  nextDrawerFocusTarget,
  normalizeConnectionGroups,
  connectionGroupsFallback,
  detailsSections,
  visibleGroupItems,
  relationDrawnKey,
  countHiddenRelations,
  literalTruncation,
} from '../src/graph-view-details.js'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

function node(id, label, kind, extra) {
  return Object.assign({ id, label, local: label, kind, iri: id, degree: 1, outEdges: 1, inEdges: 0, literals: [], types: [] }, extra || {})
}

function edge(id, source, p, target, kind) {
  return { id, source, target, p, label: p.split(/[#/]/).pop(), kind: kind || 'object', count: 1 }
}

/** Small deterministic fixture graph: two individuals, a class and a blank. */
function fixtureGraph() {
  const nodes = [
    node('ex:Person', 'Person', 'class'),
    node('ex:alice', 'Alice', 'individual'),
    node('ex:bob', 'Bob', 'individual'),
    node('_:b1', 'b1', 'blank'),
  ]
  const edges = [
    edge('e0', 'ex:alice', RDF_TYPE, 'ex:Person', 'type'),
    edge('e1', 'ex:bob', RDF_TYPE, 'ex:Person', 'type'),
    edge('e2', 'ex:alice', 'ex:knows', 'ex:bob'),
    edge('e3', '_:b1', 'ex:knows', 'ex:alice'),
    edge('e4', 'ex:alice', RDFS_LABEL, '_:b1'),
  ]
  return { nodes, edges, stats: { triples: 12 }, warnings: [], truncation: null, source: null }
}

test('normalizeFilterState: drops unknown kinds, dedupes, falls back to both', () => {
  const state = normalizeFilterState({
    kinds: ['class', 'bogus', 'class', 'property'],
    predicates: ['ex:p', 'ex:p', 7, ''],
    direction: 'sideways',
  })
  assert.deepEqual(state.kinds, ['class', 'property'])
  assert.deepEqual(state.predicates, ['ex:p'])
  assert.equal(state.direction, 'both')
  assert.deepEqual(normalizeFilterState(null), { kinds: [], predicates: [], direction: 'both' })
  assert.deepEqual(normalizeFilterState({ direction: 'out' }).direction, 'out')
  assert.deepEqual(VIEW_KINDS, ['class', 'property', 'individual', 'blank', 'external'])
  assert.deepEqual(VIEW_DIRECTIONS, ['both', 'out', 'in'])
})

test('toggleFilterValue: adds, removes and keeps insertion order', () => {
  assert.deepEqual(toggleFilterValue([], 'class'), ['class'])
  assert.deepEqual(toggleFilterValue(['class'], 'class'), [])
  assert.deepEqual(toggleFilterValue(['class'], 'property'), ['class', 'property'])
  assert.deepEqual(toggleFilterValue(['class', 'blank'], 'class'), ['blank'])
  // Unknown values are ignored instead of corrupting state.
  assert.deepEqual(toggleFilterValue(['class'], ''), ['class'])
})

test('isFilterActive / filterCriteria: direction needs an anchor', () => {
  assert.equal(isFilterActive(emptyFilterState()), false)
  assert.equal(isFilterActive({ kinds: ['class'], predicates: [], direction: 'both' }), true)
  assert.equal(isFilterActive({ kinds: [], predicates: ['ex:p'], direction: 'both' }), true)

  // Without an anchor the direction is inert and omitted entirely.
  const unanchored = filterCriteria({ kinds: ['class'], predicates: ['ex:p'], direction: 'out' }, null)
  assert.deepEqual(unanchored, { kinds: ['class'], predicates: ['ex:p'] })
  assert.equal('anchorId' in unanchored, false)
  assert.equal('direction' in unanchored, false)

  const anchored = filterCriteria({ kinds: [], predicates: [], direction: 'in' }, 'ex:alice')
  assert.deepEqual(anchored, { kinds: [], predicates: [], direction: 'in', anchorId: 'ex:alice' })

  // 'both' is neutral: the anchor is kept but no 1-hop direction cut is applied.
  const anchoredBoth = filterCriteria({ kinds: [], predicates: [], direction: 'both' }, 'ex:alice')
  assert.deepEqual(anchoredBoth, { kinds: [], predicates: [], anchorId: 'ex:alice' })
})

test('derivePredicateOptions: counts edges and orders by count then IRI', () => {
  const graph = fixtureGraph()
  graph.edges.push(edge('e5', 'ex:bob', 'ex:knows', 'ex:alice'))
  const options = derivePredicateOptions(graph)
  assert.deepEqual(options.map((option) => option.predicate), ['ex:knows', RDF_TYPE, RDFS_LABEL])
  const knows = options.find((option) => option.predicate === 'ex:knows')
  assert.equal(knows.count, 3)
  assert.equal(knows.label, 'knows')
  assert.equal(derivePredicateOptions(null).length, 0)
})

test('deriveVisibleCounts: visible vs total from graph shapes', () => {
  const full = fixtureGraph()
  const visible = { nodes: full.nodes.slice(0, 2), edges: full.edges.slice(0, 1) }
  assert.deepEqual(deriveVisibleCounts(visible, full), {
    nodes: { visible: 2, total: 4 },
    edges: { visible: 1, total: 5 },
  })
  assert.deepEqual(deriveVisibleCounts(null, null), {
    nodes: { visible: 0, total: 0 },
    edges: { visible: 0, total: 0 },
  })
})

test('isNodeVisibleUnderFilter: kinds, predicates and direction', () => {
  const graph = fixtureGraph()
  const classNode = graph.nodes[0]
  const alice = graph.nodes[1]
  const labelOnly = { id: 'ex:orphan', label: 'Orphan', kind: 'individual', iri: 'ex:orphan' }

  assert.equal(isNodeVisibleUnderFilter(classNode, emptyFilterState(), graph), true)
  assert.equal(isNodeVisibleUnderFilter(classNode, { kinds: ['individual'], predicates: [], direction: 'both' }, graph), false)
  assert.equal(isNodeVisibleUnderFilter(classNode, { kinds: ['class'], predicates: [], direction: 'both' }, graph), true)

  // Relation filter: alice has an outgoing ex:knows edge.
  assert.equal(isNodeVisibleUnderFilter(alice, { kinds: [], predicates: ['ex:knows'], direction: 'both' }, graph), true)
  assert.equal(isNodeVisibleUnderFilter(alice, { kinds: [], predicates: ['ex:knows'], direction: 'in' }, graph), true)
  assert.equal(isNodeVisibleUnderFilter(alice, { kinds: [], predicates: ['ex:missing'], direction: 'both' }, graph), false)
  // Direction alone also requires an incident edge in that direction.
  assert.equal(isNodeVisibleUnderFilter(alice, { kinds: [], predicates: [], direction: 'in' }, graph), true)
  assert.equal(isNodeVisibleUnderFilter(labelOnly, { kinds: [], predicates: [], direction: 'out' }, graph), false)
})

test('searchSelection / moveSearchIndex: empty, clamping and wrap-around', () => {
  assert.deepEqual(searchSelection([], 3), { index: 0, id: null, empty: true })
  assert.deepEqual(searchSelection(['a', 'b'], 5), { index: 1, id: 'b', empty: false })
  assert.deepEqual(searchSelection(['a', 'b'], -4), { index: 0, id: 'a', empty: false })
  // The dropdown passes result objects; Enter must select their node id, not the object.
  assert.deepEqual(
    searchSelection([{ id: 'ex:a' }, { id: 'ex:b' }], 1),
    { index: 1, id: 'ex:b', empty: false },
  )
  assert.deepEqual(searchSelection([{ label: 'broken' }], 0), { index: 0, id: null, empty: true })

  assert.equal(moveSearchIndex(0, 1, 3), 1)
  assert.equal(moveSearchIndex(2, 1, 3), 0)
  assert.equal(moveSearchIndex(0, -1, 3), 2)
  assert.equal(moveSearchIndex(0, 1, 0), 0)
})

test('createExploreState / clampExploreDepth: defaults and 1..5 cap', () => {
  assert.deepEqual(createExploreState(), { on: false, depth: 2, direction: 'both', cursor: null, extension: 0 })
  assert.equal(createExploreState({ depth: 9 }).depth, VIEW_MAX_DEPTH)
  assert.equal(createExploreState({ depth: 0 }).depth, VIEW_MIN_DEPTH)
  assert.equal(clampExploreDepth('bad'), 2)
  assert.equal(createExploreState({ depth: 3, direction: 'out', on: true }).on, true)
})

test('withExploreDepth / withExploreDirection start exploration and clear the cursor', () => {
  const idle = createExploreState({ cursor: { extension: 2 }, extension: 2 })
  const deeper = withExploreDepth(idle, 4)
  assert.equal(deeper.on, true, 'choosing a hop count must start exploring')
  assert.equal(deeper.depth, 4)
  assert.equal(deeper.cursor, null)
  assert.equal(deeper.extension, 0)

  const reversed = withExploreDirection({ ...createExploreState({ on: true, depth: 3 }), cursor: { extension: 1 } }, 'in')
  assert.equal(reversed.on, true)
  assert.equal(reversed.direction, 'in')
  assert.equal(reversed.depth, 3, 'direction changes keep the chosen depth')
  assert.equal(reversed.cursor, null)
  assert.equal(withExploreDirection(idle, 'nope').direction, 'both')
})

test('exploreCriteria: anchor, predicates from filter, cursor passthrough', () => {
  const state = createExploreState({ depth: 3, direction: 'in' })
  const criteria = exploreCriteria(state, 'ex:alice', { kinds: [], predicates: ['ex:knows'], direction: 'out' })
  assert.equal(criteria.startId, 'ex:alice')
  assert.equal(criteria.depth, 3)
  assert.equal(criteria.direction, 'in')
  assert.deepEqual(criteria.predicates, ['ex:knows'])
  assert.equal('cursor' in criteria, false)

  const withCursor = exploreCriteria({ ...state, cursor: { extension: 2 } }, 'ex:alice', emptyFilterState())
  assert.deepEqual(withCursor.cursor, { extension: 2 })
})

test('advanceExplore / resetExploreCursor / shouldResetExplore', () => {
  const base = createExploreState({ on: true })
  const continued = advanceExplore(base, { truncated: true, nextCursor: { extension: 1 } })
  assert.deepEqual(continued.cursor, { extension: 1 })
  assert.equal(continued.extension, 0)

  const extensionFallback = advanceExplore(base, { truncated: true, nextCursor: null })
  assert.deepEqual(extensionFallback.cursor, { extension: 1 })
  assert.equal(extensionFallback.extension, 1)
  // A second continuation without a model cursor keeps growing deterministically.
  const twice = advanceExplore(extensionFallback, { truncated: true, nextCursor: null })
  assert.deepEqual(twice.cursor, { extension: 2 })

  const exhausted = advanceExplore(continued, { truncated: false, nextCursor: null })
  assert.equal(exhausted.cursor, null)

  assert.deepEqual(resetExploreCursor(continued).cursor, null)
  assert.equal(resetExploreCursor(base), base)

  const reset = shouldResetExplore(continued, { anchorId: 'ex:alice', anchorVisible: false })
  assert.equal(reset.on, false)
  assert.equal(reset.cursor, null)
  const kept = shouldResetExplore(continued, { anchorId: 'ex:alice', anchorVisible: true })
  assert.equal(kept.on, true)
  assert.deepEqual(kept.cursor, { extension: 1 })
})

test('normalizeProjectionResult: nested graph, flat graph and fallback', () => {
  const fallback = fixtureGraph()
  const nestedNodes = [fallback.nodes[0]]
  const nested = normalizeProjectionResult({ graph: { nodes: nestedNodes, edges: [] }, hidden: {} }, fallback)
  assert.equal(nested.nodes.length, 1)
  assert.equal(nested.edges.length, 0)
  assert.equal(nested.warnings, fallback.warnings)

  const flat = normalizeProjectionResult({ nodes: [], edges: [], stats: { nodes: 0 } }, fallback)
  assert.deepEqual(flat.nodes, [])
  assert.deepEqual(flat.stats, { nodes: 0 })

  assert.equal(normalizeProjectionResult(null, fallback), fallback)
  assert.equal(normalizeProjectionResult({ bogus: true }, fallback), fallback)
})

test('normalizeExploreResult: nodeIds variant, induced edges and cursor aliases', () => {
  const graph = fixtureGraph()
  const result = normalizeExploreResult({
    nodeIds: ['ex:alice', 'ex:bob', 'ex:alice'],
    truncated: true,
    nextBudget: { extension: 3 },
    stats: { availableNodes: 9 },
  }, graph)
  assert.deepEqual(result.graph.nodes.map((entry) => entry.id), ['ex:alice', 'ex:bob'])
  // Both induced edges between alice and bob survive; the blank-node edges do not.
  assert.deepEqual(result.graph.edges.map((entry) => entry.id).sort(), ['e2'])
  assert.equal(result.truncated, true)
  assert.deepEqual(result.nextCursor, { extension: 3 })
  assert.equal(result.totalNodes, 9)

  const withTruncation = normalizeExploreResult({
    nodes: [graph.nodes[1]],
    edges: [],
    truncation: { nodes: { total: 7, kept: 1, truncated: 6, reason: 'per-hop-nodes' } },
    truncated: true,
    nextCursor: { extension: 2 },
    depthCapped: false,
  }, graph)
  assert.equal(withTruncation.totalNodes, 7)
  assert.equal(withTruncation.truncated, true)
  assert.deepEqual(withTruncation.nextCursor, { extension: 2 })

  const passthrough = normalizeExploreResult(null, graph)
  assert.equal(passthrough.graph, graph)
  assert.equal(passthrough.truncated, false)
  assert.equal(passthrough.nextCursor, null)
})

test('normalizeDrawnResult: stats fallback and selected node retention', () => {
  const explored = fixtureGraph()
  const kept = normalizeDrawnResult(null, explored, 'ex:alice')
  assert.equal(kept.nodes.length, explored.nodes.length)
  assert.deepEqual(kept.stats, { keptEdges: 5, hiddenEdges: 0, totalEdges: 5 })

  const trimmed = normalizeDrawnResult({
    nodes: [explored.nodes[2]],
    edges: [],
    stats: { keptEdges: 0, hiddenEdges: 5, totalEdges: 5 },
  }, explored, 'ex:alice')
  // The selected node is appended even though the budget removed its subtree.
  assert.deepEqual(trimmed.nodes.map((entry) => entry.id).sort(), ['ex:alice', 'ex:bob'])
  assert.deepEqual(trimmed.stats, { keptEdges: 0, hiddenEdges: 5, totalEdges: 5 })
})

test('collectBudgetRecords: one structured record per truncated layer, in spec order', () => {
  const records = collectBudgetRecords({
    budgets: {
      parse: { total: 120000, kept: 120000, truncated: false, reason: null },
      nodes: { total: 2000, kept: 1500, truncated: true, reason: 'node-limit' },
      literals: { total: 60, kept: 60, truncated: false, reason: null },
    },
    graph: fixtureGraph(),
    drawn: { stats: { keptEdges: 3, hiddenEdges: 2, totalEdges: 5 } },
    explore: { truncated: true, graph: { nodes: [1, 2] }, totalNodes: 8 },
  })
  assert.deepEqual(records.map((record) => record.key), ['nodes', 'draw', 'explore'])
  assert.equal(records[0].kept, 1500)
  assert.equal(records[0].truncated, 500)
  assert.equal(records[0].reason, 'node-limit')
  assert.deepEqual(records[1], { key: 'draw', total: 5, kept: 3, truncated: 2, reason: 'edge-budget' })
  assert.equal(records[2].kept, 2)
  assert.equal(records[2].total, 8)

  const layered = collectBudgetRecords({
    budgets: { edges: { total: 9000, kept: 6000, truncated: 3000, reason: 'max-edges' } },
    drawn: { stats: { keptEdges: 500, hiddenEdges: 5500, totalEdges: 6000 } },
  })
  assert.deepEqual(layered.map((record) => record.key), ['edges', 'draw'])

  // The parser reports truncation as { reason, limit, kept } (no total); the
  // model's literal record also carries truncatedNodes.
  const parserShaped = collectBudgetRecords({
    budgets: {
      parse: { reason: 'triple-limit', limit: 120000, kept: 90000 },
      literals: { total: 100, kept: 80, truncated: 20, reason: 'max-literals-per-node', truncatedNodes: 7 },
    },
  })
  assert.deepEqual(parserShaped.map((record) => record.key), ['parse', 'literals'])
  assert.equal(parserShaped[0].total, 120000)
  assert.equal(parserShaped[0].kept, 90000)
  assert.equal(parserShaped[0].truncated, 30000)
  assert.equal(parserShaped[1].detail, 7)

  // No records when nothing was truncated.
  assert.deepEqual(collectBudgetRecords({ budgets: {}, graph: fixtureGraph(), drawn: { stats: {} } }), [])

  // graph.truncation is used as a fallback when main does not pass budgets.
  const fromGraph = collectBudgetRecords({
    budgets: null,
    graph: { truncation: { literals: { total: 60, kept: 40, truncated: 20, reason: 'literal-limit' } } },
  })
  assert.deepEqual(fromGraph.map((record) => record.key), ['literals'])
})

test('groupDiagnostics: merges by code, caps samples at 3, sorts errors first', () => {
  const groups = groupDiagnostics([
    { code: 'nesting-limit', severity: 'error', count: 2, sample: ['deep 1', 'deep 2'], message: 'Nesting limit' },
    { code: 'literal-limit', severity: 'warning', count: 5, sample: ['a', 'b', 'c', 'd'] },
    { code: 'nesting-limit', severity: 'error', count: 3, sample: ['deep 3', 'deep 4'] },
  ], ['legacy issue one', 'legacy issue two'])
  // Structured diagnostics win; the legacy issue strings are only a fallback.
  assert.equal(groups.groups.length, 2)
  assert.equal(groups.groups[0].code, 'nesting-limit')
  assert.equal(groups.groups[0].severity, 'error')
  assert.equal(groups.groups[0].count, 5)
  assert.deepEqual(groups.groups[0].samples, ['deep 1', 'deep 2', 'deep 3'])
  const literal = groups.groups.find((group) => group.code === 'literal-limit')
  assert.equal(literal.samples.length, 3)
  assert.equal(literal.count, 5)
  assert.equal(groups.groups.some((group) => group.code === 'parse-message'), false)
  assert.equal(groups.errors, 5)
  assert.equal(groups.warnings, 5)
  assert.equal(groups.total, 10)
  const legacyOnly = groupDiagnostics(undefined, ['one', 'two'])
  assert.equal(legacyOnly.groups.length, 1)
  assert.equal(legacyOnly.groups[0].code, 'parse-message')
  assert.equal(legacyOnly.groups[0].count, 2)
  assert.deepEqual(legacyOnly.groups[0].samples, ['one', 'two'])
  assert.deepEqual(groupDiagnostics(undefined, undefined).groups, [])
})

test('formatTemplate: fills known placeholders, keeps unknown ones', () => {
  assert.equal(formatTemplate('{a} / {b}', { a: 4, b: 'x' }), '4 / x')
  assert.equal(formatTemplate('{a} / {missing}', { a: 1 }), '1 / {missing}')
  assert.equal(formatTemplate('no placeholders', {}), 'no placeholders')
  assert.equal(formatTemplate(null, { a: 1 }), '')
  assert.equal(formatTemplate('{n}', { n: 0 }), '0')
})

test('normalizeConnectionGroups: rdf:type first, then count desc, then predicate', () => {
  const groups = normalizeConnectionGroups({
    out: [
      { predicate: 'ex:knows', count: 2, items: [{ id: 'ex:bob', label: 'Bob', kind: 'individual' }] },
      { predicate: RDF_TYPE, count: 1, items: [{ id: 'ex:Person', label: 'Person', kind: 'class' }] },
      { predicate: 'ex:memberOf', count: 1, items: [] },
      { predicate: 'ex:knows', count: 2, items: [{ id: 'ex:bob' }, { id: 'ex:bob' }] },
    ],
    in: [],
    summary: { outEdges: 3, inEdges: 0, degree: 3 },
  })
  assert.deepEqual(groups.out.map((group) => group.predicate), [RDF_TYPE, 'ex:knows', 'ex:memberOf'])
  const knows = groups.out[1]
  // Duplicate endpoints are folded; the larger count wins.
  assert.deepEqual(knows.items.map((item) => item.id), ['ex:bob'])
  assert.equal(knows.count, 2)
  assert.deepEqual(groups.summary, { outEdges: 3, inEdges: 0, degree: 3 })
  assert.deepEqual(normalizeConnectionGroups(null), { out: [], in: [], summary: { outEdges: 0, inEdges: 0, degree: 0 }, maxPerGroup: DETAILS_GROUP_LIMIT })
})

test('connectionGroupsFallback: outgoing/incoming/self-loop and missing node', () => {
  const graph = fixtureGraph()
  graph.edges.push(edge('loop', 'ex:alice', 'ex:self', 'ex:alice'))
  const alice = connectionGroupsFallback(graph, 'ex:alice')
  const outPredicates = alice.out.map((group) => group.predicate)
  const inPredicates = alice.in.map((group) => group.predicate)
  assert.ok(outPredicates.includes('ex:knows'))
  assert.ok(outPredicates.includes('ex:self'))
  assert.ok(inPredicates.includes('ex:self'))
  assert.ok(inPredicates.includes('ex:knows'))
  assert.equal(alice.summary.outEdges, outPredicates.length)
  // Escape hatch: unchanged graph identity, deterministic ordering on repeat.
  assert.deepEqual(connectionGroupsFallback(graph, 'ex:alice'), alice)
  assert.deepEqual(connectionGroupsFallback(graph, 'ex:missing').summary, { outEdges: 0, inEdges: 0, degree: 0 })
})

test('nextDrawerFocusTarget wraps Tab in either direction and recovers escaped focus', () => {
  const focusables = [{ id: 'close' }, { id: 'copy' }, { id: 'relation' }]
  assert.equal(nextDrawerFocusTarget(focusables, focusables[0], true), focusables[2])
  assert.equal(nextDrawerFocusTarget(focusables, focusables[2], false), focusables[0])
  assert.equal(nextDrawerFocusTarget(focusables, focusables[1], false), focusables[2])
  assert.equal(nextDrawerFocusTarget(focusables, null, false), focusables[0])
  assert.equal(nextDrawerFocusTarget(focusables, null, true), focusables[2])
  assert.equal(nextDrawerFocusTarget([], null, false), null)
})

test('detailsSections: fixed section order with presence flags', () => {
  const base = { id: 'ex:alice', types: [], literals: [], source: null }
  const empty = detailsSections(base, { out: [], in: [] })
  assert.deepEqual(empty.map((section) => section.key), DETAILS_SECTIONS)
  assert.deepEqual(empty.map((section) => section.present), [true, false, false, false, true, false])

  const full = detailsSections(
    { id: 'ex:alice', types: [RDF_TYPE], literals: [{ p: RDFS_LABEL, value: 'Alice' }], source: null },
    { out: [{ predicate: 'ex:knows', count: 1, items: [] }], in: [] },
  )
  assert.deepEqual(full.map((section) => section.present), [true, true, true, true, true, false])
})

test('visibleGroupItems: default page, show-more and empty groups', () => {
  const group = { items: Array.from({ length: 12 }, (_, index) => ({ id: 'n' + String(index) })) }
  const first = visibleGroupItems(group, false, DETAILS_GROUP_LIMIT)
  assert.equal(first.items.length, DETAILS_GROUP_LIMIT)
  assert.equal(first.hiddenCount, 2)
  assert.equal(first.hasMore, true)
  const expanded = visibleGroupItems(group, true, DETAILS_GROUP_LIMIT)
  assert.equal(expanded.items.length, 12)
  assert.equal(expanded.hasMore, false)
  assert.deepEqual(visibleGroupItems(null, false, DETAILS_GROUP_LIMIT), { items: [], hiddenCount: 0, hasMore: false })
})

test('relationDrawnKey / countHiddenRelations: L1 relations still listed when not drawn', () => {
  assert.equal(relationDrawnKey('out', 'a', 'p', 'b'), 'a\u0000p\u0000b')
  assert.equal(relationDrawnKey('in', 'a', 'p', 'b'), 'b\u0000p\u0000a')
  const groups = normalizeConnectionGroups({
    out: [{ predicate: 'ex:knows', count: 2, items: [{ id: 'ex:bob' }, { id: 'ex:carol' }] }],
    in: [],
  })
  const drawn = new Set([relationDrawnKey('out', 'ex:alice', 'ex:knows', 'ex:bob')])
  assert.equal(countHiddenRelations(groups, 'ex:alice', drawn), 1)
  assert.equal(countHiddenRelations(groups, 'ex:alice', new Set()), 2)
  assert.equal(countHiddenRelations(groups, 'ex:alice', null), 0)
})

test('literalTruncation: shows kept vs total literal count', () => {
  assert.deepEqual(literalTruncation({ literals: [{ value: 'a' }, { value: 'b' }], literalsTruncated: 3 }),
    { shown: 2, dropped: 3, total: 5, truncated: true })
  assert.deepEqual(literalTruncation({}), { shown: 0, dropped: 0, total: 0, truncated: false })
  assert.deepEqual(literalTruncation(null), { shown: 0, dropped: 0, total: 0, truncated: false })
})
