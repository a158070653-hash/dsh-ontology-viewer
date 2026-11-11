import test from 'node:test'
import assert from 'node:assert/strict'

import { createSessionRegistry, registryAcquire, registryClear } from '../src/ontology-workspace-registry.js'

function source(sourceId, revision = 1, byteSize = 1, triples = [{}]) {
  return { sourceId, revision, byteSize, displayName: sourceId + '.ttl', parsed: { triples } }
}

test('missing or invalid session identity never creates a shared default', () => {
  const registry = createSessionRegistry()
  for (const id of [undefined, null, '', '  ', 0, {}]) {
    assert.equal(registryAcquire(registry, id), null)
  }
  assert.equal(registry.sessions.size, 0)
})

test('session and workspace isolation, and last release clears only its workspace', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session', 'first')
  const b = registryAcquire(registry, 'session', 'first')
  const otherWorkspace = registryAcquire(registry, 'session', 'second')
  const otherSession = registryAcquire(registry, 'another', 'first')
  assert.equal(a.publish(source('one')).ok, true)
  assert.equal(b.list().length, 1)
  assert.deepEqual(otherWorkspace.list(), [])
  assert.deepEqual(otherSession.list(), [])
  a.release()
  assert.equal(b.list().length, 0, 'released owner contributions disappear')
  b.release()
  assert.equal(registry.sessions.get('session').has('first'), false)
  assert.equal(registry.sessions.get('session').has('second'), true)
  otherWorkspace.release()
  otherSession.release()
  assert.equal(registry.sessions.size, 0)
})

test('same local source id from different owners has stable separate shared IDs', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session')
  const b = registryAcquire(registry, 'session')
  const first = a.publish(source('src1'))
  b.publish(source('src1'))
  assert.equal(a.list().length, 2)
  assert.notEqual(first.source.sharedId, b.list()[1].sharedId)
  assert.equal(a.publish(source('src1', 2)).source.sharedId, first.source.sharedId)
  assert.equal(b.list()[1].ownerId, b.ownerId)
  assert.equal(a.remove('src1').ok, true)
  assert.deepEqual(b.list().map((item) => item.ownerId), [b.ownerId])
  a.release()
  b.release()
})

test('publish and replaceSources are idempotent by version or object identity', () => {
  const registry = createSessionRegistry()
  const handle = registryAcquire(registry, 'session')
  const seen = []
  handle.subscribe((records) => seen.push(records.map((record) => record.sharedId)))
  const original = source('a')
  assert.equal(handle.publish(original).changed, true)
  assert.equal(handle.publish(original).changed, false)
  assert.equal(handle.publish(source('a')).changed, false, 'same revision is unchanged')
  assert.equal(handle.replaceSources([source('a')]).changed, false)
  assert.equal(handle.replaceSources([source('a', 2), source('b')]).changed, true)
  assert.equal(handle.replaceSources([source('b'), source('a', 2)]).changed, false)
  assert.equal(handle.replaceSources([source('b')]).changed, true)
  assert.deepEqual(seen.map((item) => item.length), [0, 1, 2, 1])
  handle.release()
})

test('unversioned snapshots broadcast once per object, and no source text is retained', () => {
  const handle = registryAcquire(createSessionRegistry(), 'session')
  const input = { sourceId: 'a', byteSize: 3, text: 'secret RDF', parsed: { triples: [{}] } }
  assert.equal(handle.publish(input).changed, true)
  assert.equal(handle.publish(input).changed, false)
  assert.equal(handle.publish({ ...input }).changed, true)
  assert.equal(handle.list()[0].text, undefined)
  assert.equal(JSON.stringify(handle.list()).includes('secret RDF'), false)
  assert.equal(handle.publish({ sourceId: 'bad', text: 'only raw text' }).reason, 'invalid-source')
  handle.release()
})

test('replaceSources and publish reject limits atomically without eviction', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session')
  const b = registryAcquire(registry, 'session')
  const seen = []
  b.subscribe((items) => seen.push(items.length))
  assert.equal(a.replaceSources(Array.from({ length: 16 }, (_, i) => source('s' + i))).ok, true)
  assert.equal(b.publish(source('extra')).reason, 'file-limit')
  assert.equal(a.list().length, 16)
  assert.equal(a.replaceSources([source('oversize', 1, 24 * 1024 * 1024 + 1)]).reason, 'byte-budget')
  assert.equal(a.list().length, 16)
  assert.equal(a.replaceSources([source('huge', 1, 1, Array(120001).fill({}))]).reason, 'occurrence-budget')
  assert.equal(a.list().length, 16)
  assert.equal(a.publish(source('s0', 1, 24 * 1024 * 1024 + 1)).reason, 'byte-budget',
    'a reused revision cannot bypass the byte budget')
  assert.equal(a.publish(source('s0', 1, 1, Array(120001).fill({}))).reason, 'occurrence-budget',
    'a reused revision cannot bypass the occurrence budget')
  assert.deepEqual(seen, [0, 16], 'failed transactions do not broadcast')
  assert.equal(a.remove('s0').ok, true)
  assert.equal(b.publish(source('extra')).ok, true, 'removal releases capacity')
  a.release()
  b.release()
})

test('subscriber failures are isolated on initial call and broadcast', () => {
  const handle = registryAcquire(createSessionRegistry(), 'session')
  const seen = []
  handle.subscribe(() => { throw new Error('listener failed') })
  const unsubscribe = handle.subscribe((items) => seen.push(items.length))
  handle.publish(source('a'))
  unsubscribe()
  handle.publish(source('b'))
  assert.deepEqual(seen, [0, 1])
  handle.release()
})

test('releasing a handle removes only its subscriptions', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session')
  const b = registryAcquire(registry, 'session')
  const seenA = []
  const seenB = []
  a.subscribe((items) => seenA.push(items.length))
  b.subscribe((items) => seenB.push(items.length))
  a.release()
  b.publish(source('b'))
  assert.deepEqual(seenA, [0])
  assert.deepEqual(seenB, [0, 0, 1])
  b.release()
})

test('one callback shared across handles retains independent subscriptions', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session')
  const b = registryAcquire(registry, 'session')
  const seen = []
  const callback = (items) => seen.push(items.length)
  a.subscribe(callback)
  b.subscribe(callback)
  a.release()
  b.publish(source('b'))
  assert.deepEqual(seen, [0, 0, 0, 1])
  b.release()
})

test('clear invalidates old handles and subscriptions; later acquires cannot revive them', () => {
  const registry = createSessionRegistry()
  const a = registryAcquire(registry, 'session')
  const seen = []
  a.subscribe((items) => seen.push(items.length))
  a.publish(source('old'))
  registryClear(registry)
  const b = registryAcquire(registry, 'session')
  b.publish(source('new'))
  assert.deepEqual(a.list(), [])
  assert.equal(a.publish(source('revived')).reason, 'released')
  assert.equal(a.replaceSources([source('revived')]).reason, 'released')
  assert.equal(a.remove('old').reason, 'released')
  assert.deepEqual(seen, [0, 1])
  a.release()
  assert.deepEqual(b.list().map((item) => item.sourceId), ['new'])
  b.release()
  assert.equal(registry.sessions.size, 0)
})

test('published snapshots are isolated from caller mutation and subscriber mutation', () => {
  const handle = registryAcquire(createSessionRegistry(), 'session')
  const input = source('a', 1, 1, [{ s: 'before', graph: { kind: 'default' } }])
  handle.publish(input)
  input.parsed.triples[0].s = 'after'
  input.parsed.triples[0].graph.kind = 'unknown'
  assert.equal(handle.list()[0].parsed.triples[0].s, 'before')
  assert.equal(handle.list()[0].parsed.triples[0].graph.kind, 'default')
  handle.subscribe((items) => { items[0].parsed.triples[0].s = 'corrupt' })
  assert.equal(handle.list()[0].parsed.triples[0].s, 'before')
  handle.release()
})
