import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { createOntologyRunner, computeOntology } from '../src/ontology-job.js'
import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, layoutGraph, createLayoutTask } from '../src/graph-model.js'
import {
  createWorkspace,
  addSource,
  removeSource,
  replaceSource,
  workspaceAdmission,
  composeWorkspaceGraph,
} from '../src/ontology-workspace.js'
import {
  entityKeyForTerm,
  statementIdFor,
  graphIdentityFor,
} from '../src/ontology-identity.js'

const REAL_IMPL = {
  parseOntology,
  buildGraph,
  layoutGraph,
  createLayoutTask,
}
const IMPL_WITHOUT_CHUNKED_LAYOUT = {
  parseOntology,
  buildGraph,
  layoutGraph,
}

const TINY_TTL = `@prefix ex: <http://example.org/> .
ex:a ex:knows ex:b .
ex:a ex:name "Alice" .
ex:b ex:name "Bob" .
`

const TINY_GRAPH = {
  nodes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
  edges: [{ id: 'e0', source: 'a', target: 'b', p: 'http://example.org/knows' }],
  stats: { nodes: 2, edges: 1 },
  warnings: [],
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Deterministic, manually drained scheduler used to drive the chunked path. */
function createFakeScheduler() {
  const queue = []
  let drained = 0
  const scheduler = (callback) => {
    const entry = { callback, cancelled: false }
    queue.push(entry)
    return () => { entry.cancelled = true }
  }
  scheduler.pending = () => queue.length
  scheduler.totalDrained = () => drained
  scheduler.drain = () => {
    const batch = queue.splice(0)
    for (const entry of batch) {
      if (entry.cancelled) continue
      drained += 1
      entry.callback()
    }
    return batch.length
  }
  scheduler.drainAll = async () => {
    for (let guard = 0; guard < 1000; guard += 1) {
      await flush()
      if (queue.length === 0) {
        await flush()
        if (queue.length === 0) return
      }
      scheduler.drain()
    }
    throw new Error('scheduler did not settle')
  }
  return scheduler
}

/** Fake worker exposing exactly the surface the job module uses. */
function createFakeWorker() {
  const worker = {
    messages: [],
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage(message) { worker.messages.push(message) },
    terminate() { worker.terminated += 1 },
    emit(data) {
      if (typeof worker.onmessage === 'function') worker.onmessage({ data })
    },
    fail(message) {
      if (typeof worker.onerror === 'function') worker.onerror({ message: message || 'worker crashed' })
    },
  }
  return worker
}

function createWorkerFactory() {
  const workers = []
  const factory = () => {
    const worker = createFakeWorker()
    workers.push(worker)
    return worker
  }
  factory.workers = workers
  return factory
}

function stateEvents(events) {
  return events.filter((event) => event.type === 'state')
}

// ---------------------------------------------------------------------------
// computeOntology: low-level contract
// ---------------------------------------------------------------------------

test('computeOntology computes on the degraded main-thread path without a worker source', async () => {
  const states = []
  const scheduler = createFakeScheduler()
  const pending = computeOntology({
    text: TINY_TTL,
    displayName: 'tiny.ttl',
    resourceAddress: '/tmp/tiny.ttl',
  }, {
    impl: REAL_IMPL,
    scheduler,
    onState: (event) => states.push(event),
  })
  await scheduler.drainAll()
  const result = await pending

  assert.equal(result.status, 'ready')
  assert.equal(result.degraded, true)
  assert.equal(result.graph.nodes.length, 2)
  assert.equal(result.positions.length, 2)
  assert.deepEqual(
    result.positions.map((point) => point.id),
    result.graph.nodes.map((node) => node.id),
  )
  assert.deepEqual(result.positions.map((point) => point.id).sort(), result.graph.nodes.map((node) => node.id).sort())
  for (const point of result.positions) {
    assert.equal(typeof point.x, 'number')
    assert.equal(typeof point.y, 'number')
  }
  assert.equal(result.graph.source.address, '/tmp/tiny.ttl')
  assert.equal(typeof result.timing.parse, 'number')
  assert.equal(typeof result.timing.build, 'number')
  assert.equal(typeof result.timing.layout, 'number')
  assert.ok(result.timing.total >= 0)
  // Chunked layout may report several `layout` progress states; the stage
  // order is what matters here.
  const statusOrder = []
  for (const event of stateEvents(states)) {
    if (statusOrder[statusOrder.length - 1] !== event.status) statusOrder.push(event.status)
  }
  assert.deepEqual(statusOrder, ['parsing', 'modeling', 'layout', 'ready'])
  assert.ok(stateEvents(states).every((event) => event.degraded === true))
})

test('computeOntology uses the embedded worker protocol when a worker is injected', async () => {
  const worker = createFakeWorker()
  const states = []
  const pending = computeOntology({
    text: TINY_TTL,
    displayName: 'tiny.ttl',
    resourceAddress: '/tmp/tiny.ttl',
  }, {
    impl: REAL_IMPL,
    workerFactory: () => worker,
    workerTimeoutMs: 200,
    onState: (event) => states.push(event),
  })
  await flush()

  assert.equal(worker.messages.length, 1)
  const request = worker.messages[0]
  assert.equal(request.type, 'compute')
  assert.equal(request.id, 1)
  assert.equal(request.text, TINY_TTL)
  assert.equal(request.resourceAddress, '/tmp/tiny.ttl')
  assert.equal(request.displayName, 'tiny.ttl')
  assert.equal(request.limits.maxTriples, 120000)
  assert.equal(request.limits.maxNodes, 1500)
  assert.equal(request.layout.width, 900)
  assert.equal(request.layout.height, 600)
  assert.equal(request.layout.seed, 1)
  assert.equal(request.layout.iterations, 320)

  worker.emit({
    type: 'graph',
    id: 1,
    graph: TINY_GRAPH,
    base: 'http://example.org/',
    baseSource: 'document',
    prefixes: { ex: 'http://example.org/' },
    diagnostics: [{ code: 'base-unavailable', severity: 'warning', count: 1 }],
    stats: { tripleCount: 3 },
    truncation: null,
    timing: { parse: 1, build: 2, layout: 3 },
  })
  worker.emit({ type: 'layout', id: 1, positions: Float64Array.from([10, 20, 30, 40]), timing: { layout: 3 } })

  const result = await pending
  assert.equal(result.status, 'ready')
  assert.equal(result.degraded, false)
  assert.equal(result.graph, TINY_GRAPH)
  assert.equal(result.baseSource, 'document')
  assert.deepEqual(result.positions, [
    { id: 'a', x: 10, y: 20 },
    { id: 'b', x: 30, y: 40 },
  ])
  assert.deepEqual(result.timing, { parse: 1, build: 2, layout: 3, total: 6 })
  assert.equal(worker.terminated, 1, 'the one-shot worker is released after the result')
  assert.deepEqual(stateEvents(states).map((event) => event.status), ['parsing', 'layout', 'ready'])
})

test('computeOntology reports a worker parse error without falling back', async () => {
  const worker = createFakeWorker()
  const pending = computeOntology({ text: TINY_TTL }, {
    impl: REAL_IMPL,
    workerFactory: () => worker,
    workerTimeoutMs: 200,
    scheduler: createFakeScheduler(),
  })
  await flush()
  worker.emit({ type: 'error', id: 1, message: 'worker exploded' })
  const result = await pending
  assert.equal(result.status, 'error')
  assert.equal(result.message, 'worker exploded')
  assert.equal(result.degraded, false)
  assert.equal(worker.terminated, 1)
})

test('computeOntology falls back to the degraded path when the worker errors', async () => {
  const worker = createFakeWorker()
  const scheduler = createFakeScheduler()
  const states = []
  const pending = computeOntology({ text: TINY_TTL }, {
    impl: REAL_IMPL,
    workerFactory: () => worker,
    workerTimeoutMs: 200,
    scheduler,
    onState: (event) => states.push(event),
  })
  await flush()
  worker.fail('worker crashed')
  await scheduler.drainAll()
  const result = await pending

  assert.equal(result.status, 'ready')
  assert.equal(result.degraded, true)
  assert.equal(result.graph.nodes.length, 2)
  assert.ok(stateEvents(states).some((event) => event.status === 'parsing' && event.degraded === true))
})

test('computeOntology honours a pre-aborted signal and never throws on empty input', async () => {
  const controller = new AbortController()
  controller.abort()
  const aborted = await computeOntology({ text: TINY_TTL }, {
    impl: REAL_IMPL,
    forceMainThread: true,
    signal: controller.signal,
  })
  assert.equal(aborted.cancelled, true)
  assert.equal(aborted.status, 'error')

  const scheduler = createFakeScheduler()
  const pending = computeOntology({}, { impl: REAL_IMPL, forceMainThread: true, scheduler })
  await scheduler.drainAll()
  const result = await pending
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.graph.nodes, [])
  assert.deepEqual(result.positions, [])
})

// ---------------------------------------------------------------------------
// createOntologyRunner: worker events, staleness, cancellation, relayout
// ---------------------------------------------------------------------------

test('createOntologyRunner emits graph, layout and ready events from worker messages', async () => {
  const factory = createWorkerFactory()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    onEvent: (event) => events.push(event),
  })
  const generation = runner.submit({
    text: TINY_TTL,
    displayName: 'tiny.ttl',
    resourceAddress: '/tmp/tiny.ttl',
  })
  assert.equal(generation, 1)
  await flush()

  assert.equal(factory.workers.length, 1)
  const worker = factory.workers[0]
  assert.equal(worker.messages.length, 1)
  assert.equal(worker.messages[0].type, 'compute')
  assert.equal(worker.messages[0].id, 1)

  worker.emit({
    type: 'graph',
    id: 1,
    graph: TINY_GRAPH,
    base: '',
    baseSource: 'none',
    prefixes: {},
    diagnostics: [],
    stats: {},
    truncation: null,
    timing: { parse: 1, build: 1, layout: 1 },
  })
  worker.emit({ type: 'layout', id: 1, positions: Float64Array.from([1, 2, 3, 4]), timing: { layout: 1 } })
  await flush()

  const graphEvent = events.find((event) => event.type === 'graph')
  assert.ok(graphEvent)
  assert.equal(graphEvent.generation, 1)
  assert.equal(graphEvent.graph, TINY_GRAPH)
  assert.equal(graphEvent.degraded, false)
  assert.equal(graphEvent.stats !== undefined, true)

  const layoutEvent = events.find((event) => event.type === 'layout')
  assert.ok(layoutEvent)
  assert.equal(layoutEvent.generation, 1)
  assert.deepEqual(layoutEvent.positions, [
    { id: 'a', x: 1, y: 2 },
    { id: 'b', x: 3, y: 4 },
  ])
  assert.ok(stateEvents(events).some((event) => event.status === 'ready' && event.generation === 1))
  assert.equal(worker.terminated, 0, 'the worker stays alive for relayout')

  runner.dispose()
  assert.equal(worker.terminated, 1)
})

test('a stale worker result is dropped after a newer submit', async () => {
  const factory = createWorkerFactory()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL })
  await flush()
  const first = factory.workers[0]

  runner.submit({ text: TINY_TTL })
  await flush()
  assert.equal(first.terminated, 1, 'the superseded worker is terminated')
  const second = factory.workers[1]

  first.emit({ type: 'graph', id: 1, graph: TINY_GRAPH })
  first.emit({ type: 'layout', id: 1, positions: Float64Array.from([1, 2, 3, 4]) })
  await flush()
  assert.equal(events.filter((event) => event.type === 'graph').length, 0)
  assert.equal(events.filter((event) => event.type === 'layout').length, 0)

  second.emit({ type: 'graph', id: 2, graph: TINY_GRAPH })
  second.emit({ type: 'layout', id: 2, positions: Float64Array.from([5, 6, 7, 8]) })
  await flush()
  const graphEvents = events.filter((event) => event.type === 'graph')
  assert.equal(graphEvents.length, 1)
  assert.equal(graphEvents[0].generation, 2)
  assert.equal(events.filter((event) => event.type === 'layout')[0].generation, 2)
  runner.dispose()
})

test('cancel terminates the worker and suppresses every later event', async () => {
  const factory = createWorkerFactory()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL })
  await flush()
  const worker = factory.workers[0]
  const before = events.length

  runner.cancel()
  assert.equal(worker.terminated, 1)
  worker.emit({ type: 'graph', id: 1, graph: TINY_GRAPH })
  worker.emit({ type: 'layout', id: 1, positions: Float64Array.from([1, 2, 3, 4]) })
  await flush()
  assert.equal(events.length, before, 'cancelled jobs must not emit')
  runner.dispose()
})

test('relayout reuses the worker cache and neither re-parses nor rebuilds', async () => {
  const factory = createWorkerFactory()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL })
  await flush()
  const worker = factory.workers[0]
  worker.emit({ type: 'graph', id: 1, graph: TINY_GRAPH })
  worker.emit({ type: 'layout', id: 1, positions: Float64Array.from([1, 2, 3, 4]) })
  await flush()

  runner.relayout({ width: 400, height: 300, seed: 3, iterations: 100 })
  await flush()
  assert.equal(worker.messages.length, 2, 'no second compute message')
  const relayoutMessage = worker.messages[1]
  assert.equal(relayoutMessage.type, 'relayout')
  assert.equal(relayoutMessage.id, 1)
  assert.equal(relayoutMessage.width, 400)
  assert.equal(relayoutMessage.height, 300)
  assert.equal(relayoutMessage.seed, 3)
  assert.equal(relayoutMessage.iterations, 100)

  worker.emit({ type: 'layout', id: 1, positions: Float64Array.from([9, 8, 7, 6]), timing: { layout: 2 } })
  await flush()
  const layoutEvents = events.filter((event) => event.type === 'layout')
  assert.equal(layoutEvents.length, 2)
  assert.deepEqual(layoutEvents[1].positions, [
    { id: 'a', x: 9, y: 8 },
    { id: 'b', x: 7, y: 6 },
  ])
  runner.dispose()
})

test('a worker failure falls back to the degraded main path once per runner', async () => {
  const factory = createWorkerFactory()
  const scheduler = createFakeScheduler()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    scheduler,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL, displayName: 'tiny.ttl' })
  await flush()
  factory.workers[0].fail('crashed')
  await scheduler.drainAll()

  const firstGraph = events.filter((event) => event.type === 'graph')
  assert.equal(firstGraph.length, 1)
  assert.equal(firstGraph[0].degraded, true)
  assert.ok(stateEvents(events).some((event) => event.status === 'parsing' && event.degraded === true))
  assert.ok(stateEvents(events).some((event) => event.status === 'ready'))

  runner.submit({ text: TINY_TTL, displayName: 'tiny.ttl' })
  await scheduler.drainAll()
  assert.equal(factory.workers.length, 1, 'the degraded mode is sticky: no worker is rebuilt')
  const graphEvents = events.filter((event) => event.type === 'graph')
  assert.equal(graphEvents.length, 2)
  assert.equal(graphEvents[1].generation, 2)
  assert.equal(graphEvents[1].degraded, true)
  runner.dispose()
})

test('the degraded main path applies the stricter budgets', async () => {
  const scheduler = createFakeScheduler()
  const captured = {}
  const fakeParsed = { prefixes: {}, base: '', baseSource: 'none', triples: [], stats: {}, warnings: [], diagnostics: [] }
  const fakeGraph = { nodes: [], edges: [], stats: {}, warnings: [] }
  const impl = {
    parseOntology: (text, options) => {
      captured.parseOptions = options
      return fakeParsed
    },
    buildGraph: (parsed, options) => {
      captured.buildOptions = options
      return fakeGraph
    },
    layoutGraph: () => [],
  }
  const runner = createOntologyRunner({
    impl,
    scheduler,
    forceMainThread: true,
    onEvent: () => {},
  })
  runner.submit({
    text: TINY_TTL,
    displayName: 'tiny.ttl',
    resourceAddress: '/tmp/tiny.ttl',
    limits: { maxTriples: 500000, maxNodes: 9000, maxEdges: 90000 },
  })
  await scheduler.drainAll()

  assert.equal(captured.parseOptions.maxTriples, 60000)
  assert.equal(captured.parseOptions.maxLiteralLength, 16384)
  assert.equal(captured.parseOptions.maxDepth, 256)
  assert.equal(captured.parseOptions.resourceAddress, '/tmp/tiny.ttl')
  assert.equal(captured.buildOptions.maxNodes, 800)
  assert.equal(captured.buildOptions.maxEdges, 3000)
  assert.equal(captured.buildOptions.source.address, '/tmp/tiny.ttl')
  runner.dispose()
})

test('chunked layout runs step by step and cancellation stops it between steps', async () => {
  const scheduler = createFakeScheduler()
  const task = {
    steps: 0,
    cancelled: false,
    step() {
      this.steps += 1
      const done = this.steps >= 3
      return { done, progress: done ? 1 : this.steps / 3 }
    },
    result() {
      return this.steps >= 3 && !this.cancelled
        ? [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }]
        : null
    },
    cancel() { this.cancelled = true },
  }
  const events = []
  const impl = {
    parseOntology: () => ({ prefixes: {}, base: '', baseSource: 'none', triples: [], stats: {}, warnings: [], diagnostics: [] }),
    buildGraph: () => ({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [], stats: {}, warnings: [] }),
    layoutGraph: () => [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }],
    createLayoutTask: () => task,
  }
  const runner = createOntologyRunner({
    impl,
    scheduler,
    forceMainThread: true,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL })
  await scheduler.drainAll()

  const graphEvent = events.find((event) => event.type === 'graph')
  assert.ok(graphEvent)
  const layoutEvent = events.find((event) => event.type === 'layout')
  assert.ok(layoutEvent)
  assert.deepEqual(layoutEvent.positions, [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }])
  assert.equal(task.steps >= 3, true, 'the layout task ran to completion in chunks')
  assert.ok(scheduler.totalDrained() >= 5, 'layout was scheduled across multiple ticks')
  runner.dispose()

  // Cancellation between chunks: the pending task is cancelled and no result is emitted.
  const scheduler2 = createFakeScheduler()
  const task2 = {
    steps: 0,
    cancelled: false,
    step() { this.steps += 1; return { done: false, progress: this.steps / 10 } },
    result() { return null },
    cancel() { this.cancelled = true },
  }
  const impl2 = { ...impl, createLayoutTask: () => task2 }
  const events2 = []
  const runner2 = createOntologyRunner({
    impl: impl2,
    scheduler: scheduler2,
    forceMainThread: true,
    onEvent: (event) => events2.push(event),
  })
  runner2.submit({ text: TINY_TTL })
  // The endless task keeps scheduling chunks: pump a few by hand, then cancel.
  for (let index = 0; index < 10; index += 1) {
    await flush()
    scheduler2.drain()
  }
  assert.ok(task2.steps >= 1, 'the chunked layout started')
  runner2.cancel()
  for (let index = 0; index < 5; index += 1) {
    await flush()
    scheduler2.drain()
  }
  assert.equal(task2.cancelled, true)
  assert.equal(events2.filter((event) => event.type === 'layout').length, 0)
  assert.ok(!stateEvents(events2).some((event) => event.status === 'ready'))
  runner2.dispose()
})

test('dispose terminates the worker and blocks further submits', async () => {
  const factory = createWorkerFactory()
  const events = []
  const runner = createOntologyRunner({
    workerFactory: factory,
    impl: REAL_IMPL,
    workerTimeoutMs: 200,
    onEvent: (event) => events.push(event),
  })
  runner.submit({ text: TINY_TTL })
  await flush()
  const worker = factory.workers[0]
  const before = events.length
  runner.dispose()
  assert.equal(worker.terminated, 1)
  worker.emit({ type: 'graph', id: 1, graph: TINY_GRAPH })
  await flush()
  assert.equal(events.length, before)

  const generationBefore = runner.submit({ text: TINY_TTL })
  assert.equal(factory.workers.length, 1, 'disposed runners do not create workers')
  assert.equal(generationBefore, 1)
  await flush()
})

// ---------------------------------------------------------------------------
// Worker entry: the real protocol implementation (run in a VM sandbox)
// ---------------------------------------------------------------------------

function createWorkerSandbox() {
  const posted = []
  const self = {
    performance: { now: () => performance.now() },
    postMessage(message, transfer) { posted.push({ message, transfer }) },
  }
  const sandbox = {
    self,
    parseOntology,
    buildGraph,
    layoutGraph,
    performance,
  }
  vm.createContext(sandbox)
  const source = readFileSync(new URL('../src/worker-entry.js', import.meta.url), 'utf8')
  vm.runInContext(source, sandbox, { filename: 'worker-entry.js' })
  return { self, posted }
}

test('the worker entry speaks the documented compute/relayout/error protocol', () => {
  const { self, posted } = createWorkerSandbox()
  self.onmessage({
    data: {
      type: 'compute',
      id: 7,
      text: TINY_TTL,
      resourceAddress: '/tmp/tiny.ttl',
      displayName: 'tiny.ttl',
      limits: {
        maxTriples: 1000,
        maxNodes: 100,
        maxEdges: 100,
        maxLiteralsPerNode: 5,
        maxLiteralLength: 100,
        maxDepth: 10,
      },
      layout: { width: 400, height: 300, seed: 2, iterations: 20 },
    },
  })

  assert.equal(posted.length, 2, 'compute posts a graph message and a layout message')
  const graphMessage = posted[0].message
  assert.equal(graphMessage.type, 'graph')
  assert.equal(graphMessage.id, 7)
  assert.ok(Array.isArray(graphMessage.graph.nodes))
  assert.ok(graphMessage.graph.nodes.length >= 2)
  assert.equal(graphMessage.baseSource, 'resource')
  assert.equal(graphMessage.graph.source.address, '/tmp/tiny.ttl')
  assert.equal(graphMessage.graph.source.displayName, 'tiny.ttl')
  assert.ok(graphMessage.timing.parse >= 0)
  assert.ok(graphMessage.timing.build >= 0)
  assert.ok(graphMessage.timing.layout >= 0)

  const layoutMessage = posted[1].message
  assert.equal(layoutMessage.type, 'layout')
  assert.equal(layoutMessage.id, 7)
  assert.equal(Object.prototype.toString.call(layoutMessage.positions), '[object Float64Array]')
  assert.equal(layoutMessage.positions.length, graphMessage.graph.nodes.length * 2)
  assert.ok(posted[1].transfer && posted[1].transfer.length === 1, 'the layout array is transferred')

  posted.length = 0
  self.onmessage({ data: { type: 'relayout', id: 7, width: 500, height: 350, seed: 3, iterations: 10 } })
  assert.equal(posted.length, 1)
  assert.equal(posted[0].message.type, 'layout')
  assert.equal(posted[0].message.positions.length, graphMessage.graph.nodes.length * 2)

  posted.length = 0
  self.onmessage({ data: { type: 'relayout', id: 99, width: 1, height: 1, seed: 1, iterations: 1 } })
  assert.equal(posted.length, 1)
  assert.equal(posted[0].message.type, 'error')
  assert.equal(posted[0].message.id, 99)
  assert.match(posted[0].message.message, /relayout requested before a graph is available/)
})

// ---------------------------------------------------------------------------
// Workspace runner: multi-file parse, compose and removal
// ---------------------------------------------------------------------------

const WORKSPACE_IMPL = {
  ...REAL_IMPL,
  createWorkspace,
  addSource,
  removeSource,
  replaceSource,
  workspaceAdmission,
  composeWorkspaceGraph,
  identity: { entityKeyForTerm, statementIdFor, graphIdentityFor },
}

const FILE_ONE = '@prefix ex: <http://e/> .\nex:a ex:p ex:shared .\n'
const FILE_TWO = '@prefix ex: <http://e/> .\nex:b ex:q ex:shared .\n'

test('workspace main-thread composition discards a superseded layout', async () => {
  const events = []
  const scheduler = createFakeScheduler()
  const runner = createOntologyRunner({ impl: WORKSPACE_IMPL, scheduler,
    forceMainThread: true, onEvent: event => events.push(event) })
  runner.parseSource({ text: FILE_ONE, displayName: 'one.ttl' })
  const old = runner.compose({ layout: { iterations: 40 } })
  runner.parseSource({ text: FILE_TWO, displayName: 'two.ttl' })
  const current = runner.compose({ layout: { iterations: 1 } })
  await scheduler.drainAll()
  assert.ok(events.some(event => event.type === 'layout' && event.generation === current))
  assert.equal(events.some(event => event.type === 'layout' && event.generation === old), false)
  runner.dispose()
})

test('workspace runner: main-thread parse admits sources and compose builds L1', async () => {
  const events = []
  const scheduler = createFakeScheduler()
  const runner = createOntologyRunner({
    impl: WORKSPACE_IMPL,
    scheduler,
    forceMainThread: true,
    onEvent: (event) => events.push(event),
  })
  runner.parseSource({
    text: FILE_ONE, displayName: 'one.ttl', absolutePath: 'D:/one.ttl',
  })
  runner.parseSource({
    text: FILE_TWO, displayName: 'two.ttl', absolutePath: 'D:/two.ttl',
  })
  const sources = events.filter((event) => event.type === 'source')
  assert.equal(sources.length, 2)
  assert.deepEqual(sources.map((event) => event.status), ['ready', 'ready'])
  assert.equal(sources[1].totals.files, 2)
  assert.equal(sources[1].sources.length, 2)
  assert.equal(sources[0].summary.tripleCount, 1)
  assert.equal(sources[0].summary.displayName, 'one.ttl')

  const firstSourceId = sources[0].sourceId
  events.length = 0
  runner.compose({ sourceIds: [firstSourceId], layout: { width: 400, height: 300, seed: 1 } })
  await scheduler.drainAll()

  const graphEvent = events.find((event) => event.type === 'graph')
  assert.ok(graphEvent)
  assert.equal(graphEvent.sourceIds.length, 1)
  assert.equal(graphEvent.occurrences, 1)
  assert.deepEqual(graphEvent.graph.nodes.map((node) => node.id).sort(),
    ['http://e/a', 'http://e/shared'])
  const layoutEvent = events.find((event) => event.type === 'layout')
  assert.ok(layoutEvent)
  assert.equal(layoutEvent.positions.length, 2)
  assert.ok(events.some((event) => event.type === 'state' && event.status === 'ready'))
  runner.dispose()
})

test('workspace runner: compose never re-parses unchanged sources, and removal drops contributions', async () => {
  let parseCalls = 0
  const impl = {
    ...WORKSPACE_IMPL,
    parseOntology: (...args) => { parseCalls += 1; return parseOntology(...args) },
  }
  const events = []
  const scheduler = createFakeScheduler()
  const runner = createOntologyRunner({
    impl, scheduler, forceMainThread: true, onEvent: (event) => events.push(event),
  })
  runner.parseSource({ text: FILE_ONE, displayName: 'one.ttl', absolutePath: 'D:/one.ttl' })
  runner.parseSource({ text: FILE_TWO, displayName: 'two.ttl', absolutePath: 'D:/two.ttl' })
  assert.equal(parseCalls, 2)

  events.length = 0
  const info = runner.workspaceInfo()
  runner.compose({})
  await scheduler.drainAll()
  runner.compose({})
  await scheduler.drainAll()
  assert.equal(parseCalls, 2, 'switching/composing must not re-parse')
  const graphs = events.filter((event) => event.type === 'graph')
  assert.equal(graphs.length, 2)
  assert.equal(graphs[0].graph.nodes.length, 3)
  assert.equal(info.totals.files, 2)
  assert.equal(info.totals.occurrences, 2)

  const secondId = info.sources[1].sourceId
  events.length = 0
  runner.dropSource(secondId)
  const removed = events.find((event) => event.type === 'sources')
  assert.ok(removed)
  assert.equal(removed.removedSourceId, secondId)
  assert.equal(removed.sources.length, 1)
  assert.equal(runner.workspaceInfo().totals.occurrences, 1)

  events.length = 0
  runner.compose({})
  await scheduler.drainAll()
  const after = events.find((event) => event.type === 'graph')
  assert.equal(after.graph.nodes.some((node) => node.id === 'http://e/b'), false)
  runner.dispose()
})

test('workspace runner: an over-budget source is rejected with a reason', () => {
  const events = []
  const impl = {
    ...WORKSPACE_IMPL,
    createWorkspace: (options) => createWorkspace({ ...(options || {}), limits: { maxFiles: 1 } }),
  }
  const runner = createOntologyRunner({
    impl, forceMainThread: true, onEvent: (event) => events.push(event),
  })
  runner.parseSource({ text: FILE_ONE, displayName: 'one.ttl', absolutePath: 'D:/one.ttl' })
  runner.parseSource({ text: FILE_TWO, displayName: 'two.ttl', absolutePath: 'D:/two.ttl' })
  const sources = events.filter((event) => event.type === 'source')
  assert.equal(sources.length, 2)
  assert.equal(sources[0].status, 'ready')
  assert.equal(sources[1].status, 'rejected')
  assert.equal(sources[1].reason, 'file-limit')
  assert.equal(runner.workspaceInfo().totals.files, 1)
  runner.dispose()
})

test('workspace runner: worker path sends parse/compose and applies stale guards', async () => {
  const events = []
  const worker = createFakeWorker()
  const runner = createOntologyRunner({
    impl: WORKSPACE_IMPL,
    workerFactory: () => worker,
    workerTimeoutMs: 500,
    onEvent: (event) => events.push(event),
  })
  runner.parseSource({ text: FILE_ONE, displayName: 'one.ttl', absolutePath: 'D:/one.ttl' })
  assert.equal(worker.messages.length, 1)
  const parseMessage = worker.messages[0]
  assert.equal(parseMessage.type, 'parse-source')
  assert.equal(parseMessage.text, FILE_ONE)
  assert.equal(parseMessage.absolutePath, 'D:/one.ttl')
  assert.equal(parseMessage.maxTriples, 120000)

  const parsed = parseOntology(FILE_ONE, { format: 'turtle', absolutePath: 'D:/one.ttl' })
  worker.emit({
    type: 'source',
    id: parseMessage.id,
    sourceId: 'src1',
    revision: 1,
    status: 'ready',
    parsed,
  })
  const sourceEvent = events.find((event) => event.type === 'source')
  assert.ok(sourceEvent)
  assert.equal(sourceEvent.sourceId, 'src1')
  assert.equal(sourceEvent.summary.status, 'ready')
  assert.equal(sourceEvent.summary.tripleCount, 1)

  events.length = 0
  worker.messages.length = 0
  runner.compose({ sourceIds: ['src1'], layout: { width: 500, height: 320, seed: 2 } })
  assert.equal(worker.messages.length, 1)
  const composeMessage = worker.messages[0]
  assert.equal(composeMessage.type, 'compose')
  assert.deepEqual(composeMessage.sourceIds, ['src1'])
  assert.equal(composeMessage.layout.width, 500)

  const graph = buildGraph(parsed, { sourceId: 'src1' })
  worker.emit({ type: 'graph', id: composeMessage.id, graph, statements: 1, occurrences: 1, sourceIds: ['src1'] })
  worker.emit({
    type: 'layout',
    id: composeMessage.id,
    positions: Float64Array.from([1, 2, 3, 4, 5, 6]),
    timing: { layout: 4 },
  })
  const graphEvent = events.find((event) => event.type === 'graph')
  assert.ok(graphEvent)
  assert.equal(graphEvent.degraded, false)
  assert.equal(graphEvent.statements, 1)
  const layoutEvent = events.find((event) => event.type === 'layout')
  assert.equal(layoutEvent.positions.length, 2)

  // A response that arrives after disposal must not be published.
  events.length = 0
  runner.dispose()
  worker.emit({ type: 'source', id: 999, sourceId: 'src9', revision: 1, status: 'ready', parsed })
  assert.equal(events.length, 0)
})

test('workspace runner: worker failure falls back to the main thread', async () => {
  const events = []
  const worker = createFakeWorker()
  const scheduler = createFakeScheduler()
  const runner = createOntologyRunner({
    impl: WORKSPACE_IMPL,
    scheduler,
    workerFactory: () => worker,
    workerTimeoutMs: 50,
    onEvent: (event) => events.push(event),
  })
  runner.parseSource({ text: FILE_ONE, displayName: 'one.ttl', absolutePath: 'D:/one.ttl' })
  worker.fail('boom')
  await flush()
  const sourceEvent = events.find((event) => event.type === 'source')
  assert.ok(sourceEvent, 'the degraded parse still admits the source')
  assert.equal(sourceEvent.status, 'ready')
  assert.ok(events.some((event) => event.type === 'state' && event.degraded === true &&
    /unavailable/.test(String(event.message))))
  runner.dispose()
})
