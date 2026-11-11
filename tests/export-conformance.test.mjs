/**
 * Export conformance for the tree and layered views (6.3).
 *
 * The workspace exports the *displayed* set: tree rows after expansion and
 * search filtering, and the layered layout of the projected graph. These tests
 * compose the real view functions so the exported scene can never gain rows or
 * nodes the user is not currently looking at.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTreeScene, buildLayeredScene } from '../src/graph-export.js'
import { buildHierarchy, expandHierarchy, layoutLayeredGraph } from '../src/ontology-views.js'
import { filterTreeRows, treeSearchPlan, RDFS_SUBCLASSOF_IRI } from '../src/graph-view-multiview.js'
import { filterGraph } from '../src/graph-model.js'

const CLASS_GRAPH = {
  nodes: [
    { id: 'urn:A', label: 'A', kind: 'class' },
    { id: 'urn:B', label: 'B', kind: 'class' },
    { id: 'urn:C', label: 'C', kind: 'class' },
    { id: 'urn:i', label: 'i', kind: 'individual' },
  ],
  edges: [
    { id: 'e1', source: 'urn:B', target: 'urn:A', p: RDFS_SUBCLASSOF_IRI, label: 'subClassOf', sourceIds: ['s1'] },
    { id: 'e2', source: 'urn:C', target: 'urn:B', p: RDFS_SUBCLASSOF_IRI, label: 'subClassOf', sourceIds: ['s1'] },
    { id: 'e3', source: 'urn:i', target: 'urn:C', p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', label: 'type', sourceIds: ['s1'] },
  ],
  warnings: [],
}

function treeRows(expandedIds, query) {
  const hierarchy = buildHierarchy(CLASS_GRAPH, { mode: 'class' })
  const expanded = expandHierarchy(hierarchy, { expandedIds, maxRefs: 200, maxDepth: 6 })
  return filterTreeRows(expanded.refs, hierarchy, treeSearchPlan(hierarchy, query))
}

test('tree export only contains the displayed (expanded) rows', () => {
  const rows = treeRows(['urn:A'], '')
  const labels = rows.map((row) => row.label)
  assert.ok(labels.includes('A'))
  assert.ok(labels.includes('B'))
  assert.equal(labels.includes('C'), false, 'a collapsed grandchild is not part of the displayed set')
  const scene = buildTreeScene(rows, { revision: 3, theme: {}, meta: { sources: 1 } })
  assert.deepEqual(scene.nodes.map((node) => node.label).sort(), ['A', 'B'])
  assert.equal(scene.nodes.some((node) => node.label === 'C'), false)
  assert.equal(scene.edges.length, 1, 'only the visible parent link becomes an export edge')
})

test('tree export follows the search filter to the matched path only', () => {
  const rows = treeRows(['urn:A', 'urn:B'], 'B')
  const labels = rows.map((row) => row.label)
  assert.ok(labels.includes('B'), 'the match is visible')
  const scene = buildTreeScene(rows, { revision: 4 })
  assert.deepEqual(scene.nodes.map((node) => node.label).sort(), labels.slice().sort())
})

test('layered export carries exactly the projected layout, never filtered-out nodes', () => {
  const projection = filterGraph(CLASS_GRAPH, { kinds: ['class'] })
  assert.equal(projection.graph.nodes.some((node) => node.kind === 'individual'), false)
  const layout = layoutLayeredGraph(projection.graph, { width: 600, height: 400 })
  const scene = buildLayeredScene(layout, { revision: 5 })
  const layoutIds = layout.nodes.map((node) => node.id).sort()
  assert.deepEqual(scene.nodes.map((node) => node.id).sort(), layoutIds)
  assert.equal(scene.nodes.some((node) => node.id === 'urn:i'), false, 'the filtered individual is not exported')
  assert.ok(scene.edges.length <= layout.edges.length, 'no edge is invented at export time')
  for (const edge of scene.edges) {
    for (const coordinate of [edge.x1, edge.y1, edge.x2, edge.y2]) {
      assert.ok(Number.isFinite(coordinate), 'exported geometry stays finite')
    }
  }
})

test('layered export keeps collapsed cycle groups instead of their members', () => {
  const cyclic = {
    nodes: [
      { id: 'urn:x', label: 'x', kind: 'class' },
      { id: 'urn:y', label: 'y', kind: 'class' },
    ],
    edges: [
      { id: 'c1', source: 'urn:x', target: 'urn:y', p: RDFS_SUBCLASSOF_IRI, label: 'subClassOf', sourceIds: ['s1'] },
      { id: 'c2', source: 'urn:y', target: 'urn:x', p: RDFS_SUBCLASSOF_IRI, label: 'subClassOf', sourceIds: ['s1'] },
    ],
    warnings: [],
  }
  const layout = layoutLayeredGraph(cyclic, { predicates: [RDFS_SUBCLASSOF_IRI], width: 600, height: 400 })
  const groups = layout.nodes.filter((node) => node.kind === 'group')
  assert.equal(groups.length, 1, 'the two classes collapse into one group node')
  const scene = buildLayeredScene(layout, { revision: 6 })
  assert.equal(scene.nodes.length, 1)
  assert.equal(scene.nodes[0].kind, 'group')
  assert.equal(scene.nodes[0].memberCount, 2)
  assert.equal(scene.edges.length, 0, 'internal cycle edges are not exported as visible relations')
})

test('exported labels never carry tagged control separators', () => {
  const scene = buildLayeredScene({
    nodes: [{ id: 'group\u0000urn:A', label: 'a\u0000b', x: 0, y: 0 }],
    edges: [],
  }, { revision: 7 })
  assert.equal(scene.nodes[0].label.includes('\u0000'), false)
  assert.match(scene.nodes[0].label, /a b/)
})
