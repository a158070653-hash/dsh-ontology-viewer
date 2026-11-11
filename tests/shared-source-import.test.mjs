import test from 'node:test'
import assert from 'node:assert/strict'
import { createOntologyRunner } from '../src/ontology-job.js'
import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, layoutGraph } from '../src/graph-model.js'
import { createWorkspace, addSource, replaceSource, removeSource, workspaceAdmission, composeWorkspaceGraph } from '../src/ontology-workspace.js'
import * as identity from '../src/ontology-identity.js'

const impl = { parseOntology, buildGraph, layoutGraph, createWorkspace, addSource, replaceSource, removeSource, workspaceAdmission, composeWorkspaceGraph, identity }

test('shared parsed snapshot preserves base/origin and does not reparse', async () => {
  let parses = 0
  const events = []
  const runner = createOntologyRunner({ forceMainThread: true,
    impl: { ...impl, parseOntology: (...args) => { parses++; return parseOntology(...args) } },
    onEvent: event => events.push(event) })
  const parsed = parseOntology('<x> <http://e/p> <y> .', { absolutePath: 'D:/one/a.ttl' })
  runner.importSource({ sourceId: 'shared-a', origin: 'browser', displayName: 'a.ttl', parsed,
    byteSize: 30, revision: 1, absolutePath: 'D:/one/a.ttl' })
  assert.equal(parses, 0)
  const snapshot = runner.sourceSnapshots()[0]
  assert.equal(snapshot.origin, 'browser')
  assert.equal(snapshot.parsed.base, parsed.base)
  assert.equal(snapshot.parsed.triples.length, 1)
  runner.importSource({ ...snapshot, replace: true, revision: 2 })
  assert.equal(runner.workspaceInfo().totals.files, 1)
  assert.equal(parses, 0)
  runner.dispose()
  assert.deepEqual(runner.sourceSnapshots(), [])
})
