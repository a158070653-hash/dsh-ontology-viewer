import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph } from '../src/graph-model.js'

test('node provenance maps accepted occurrence roles to each source separately', () => {
  const graph = buildGraph({ triples: [], prefixes: {} }, { statements: [
    { s: 'http://e/A', p: 'http://e/p', o: 'http://e/B', oKind: 'iri', sourceId: 'source-a', statementId: 'a1' },
    { s: 'http://e/C', p: 'http://e/q', o: 'http://e/A', oKind: 'iri', sourceId: 'source-b', statementId: 'b1' },
    { s: 'http://e/A', p: 'http://e/r', o: 'label', oKind: 'literal', sourceId: 'source-b', statementId: 'b2' },
  ] })
  const a = graph.nodes.find(node => node.id === 'http://e/A')
  assert.deepEqual(a.provenance.roles.sort(), ['object', 'subject'])
  assert.deepEqual(a.provenance.bySource.map(item => [item.sourceId, item.roles, item.statementIds]), [
    ['source-a', ['subject'], ['a1']],
    ['source-b', ['object', 'subject'], ['b1', 'b2']],
  ])
})
