import test from 'node:test'
import assert from 'node:assert/strict'
import {
  incidentConnectionGroups,
  incidentRelationDetails,
  nodeGraphKinds,
  visibleGroupItems,
  statementIdDisplay,
} from '../src/graph-view-details.js'

const graph = {
  nodes: [
    { id: 'urn:s', label: 'Subject', kind: 'individual' },
    { id: 'urn:p', label: 'Predicate', kind: 'property' },
    { id: 'urn:o', label: 'Object', kind: 'individual' },
    { id: 'literal:value', label: 'literal', kind: 'literal' },
  ],
  sources: [
    { sourceId: 'src-a', displayName: 'alpha.ttl', absolutePath: 'C:/ontology/alpha.ttl', navigationAddress: 'dsh-resource://alpha' },
    { sourceId: 'src-b', displayName: 'beta.trig', absolutePath: null, navigationAddress: null },
  ],
  edges: [
    { id: 'edge-1', source: 'urn:s', p: 'urn:p', target: 'urn:o', count: 3,
      sourceIds: ['src-a', 'src-b'], statementIds: ['st-1', 'st-2'],
      graphs: [
        { kind: 'default', sourceIds: ['src-a'] },
        { kind: 'iri', value: 'urn:graph:one', sourceIds: ['src-b'] },
        { kind: 'unknown', sourceIds: ['src-b'] },
      ] },
    { id: 'edge-lit', source: 'urn:s', p: 'urn:p', target: 'literal:value', count: 1,
      sourceIds: [], statementIds: [], graphs: [] },
  ],
}

test('incident relation details preserve SPO, count, all sources, graph provenance and null location', () => {
  const relations = incidentRelationDetails(graph, 'urn:s', {
    'src-a': 'A', 'src-b': 'B',
  })
  assert.equal(relations.length, 2)
  const edge = relations[0]
  assert.deepEqual([edge.subject, edge.predicate, edge.object, edge.count], ['urn:s', 'urn:p', 'urn:o', 3])
  assert.deepEqual(edge.sources.map((source) => [source.id, source.label]), [['src-a', 'alpha.ttl'], ['src-b', 'beta.trig']])
  assert.equal(edge.sources[0].absolutePath, 'C:/ontology/alpha.ttl')
  assert.equal(edge.sources[0].navigationAddress, 'dsh-resource://alpha')
  assert.deepEqual(edge.graphs.map((item) => [item.kind, item.value]), [
    ['default', null], ['iri', 'urn:graph:one'], ['unknown', null],
  ])
  assert.deepEqual(edge.graphs[1].sourceIds, ['src-b'])
  assert.deepEqual(edge.statementIds, ['st-1', 'st-2'])
  assert.equal(edge.location, null)
})

test('literal-object relations retain provenance and absent graph identity is unknown', () => {
  const literal = incidentRelationDetails(graph, 'literal:value')[0]
  assert.equal(literal.object, 'literal:value')
  assert.deepEqual(literal.sourceIds, [])
  assert.deepEqual(literal.graphs, [{ kind: 'unknown', value: null, sourceIds: [], sources: [] }])
  assert.equal(literal.location, null)
})

test('incident groups page DOM items without dropping retained relations and node graph kinds mark missing identity unknown', () => {
  const groups = incidentConnectionGroups(graph, 'urn:s')
  assert.equal(groups.out.reduce((sum, group) => sum + group.items.length, 0), 2)
  const page = visibleGroupItems(groups.out[0], false, 1)
  assert.equal(page.items.length, 1)
  assert.equal(page.hiddenCount, 1)
  assert.equal(page.hasMore, true)
  assert.equal(nodeGraphKinds({ edges: [{ source: 'urn:s', target: 'urn:o', graphs: [{ kind: 'unknown' }] }] }, 'urn:s').unknown, 1)
})

test('statement ids render without tagged control separators', () => {
  const id = 'statement\u0000src1\u00002'
  const shown = statementIdDisplay(id)
  assert.equal(/[\u0000-\u001f]/.test(shown), false)
  assert.match(shown, /src1/)
  assert.equal(statementIdDisplay(null), '')
  assert.equal(statementIdDisplay('x'.repeat(400)).length, 160)
})
