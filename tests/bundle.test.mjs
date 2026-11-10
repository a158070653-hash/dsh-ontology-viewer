/**
 * Bundle wiring test: load the built `client.js` the way the browser module
 * loader does, then run `apply` against a recording fake context.
 *
 * This checks that the shipped single-file artifact really registers the two
 * extension points with the contracts DSH and dsh-better-sidebar expect. It is
 * not a visual test: the graph components are never mounted here.
 *
 * Run: node --test tests/bundle.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.resolve(here, '..', 'client.js')
const EXPECTED_EXTENSIONS = ['ttl', 'turtle', 'owl', 'rdf', 'rdfxml', 'jsonld', 'nt', 'n3', 'nq', 'trig']

/** Minimal React surface: the module only needs createElement plus hook identities at load time. */
function fakeReact() {
  const noop = () => {}
  const identity = (value) => value
  return {
    createElement: (...args) => ({ type: args[0], props: args[1] ?? null }),
    useRef: (initial) => ({ current: initial }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
    useReducer: (reducer, initial) => [initial, noop],
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useEffect: noop,
    useLayoutEffect: noop,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function loadBundle() {
  const source = readFileSync(bundlePath, 'utf8')
  let definition = null
  const window = { __ModuleLoader__: { load: (value) => { definition = value } } }
  const sandbox = {
    window,
    console,
    TextDecoder,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    encodeURIComponent,
    decodeURIComponent,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js must call window.__ModuleLoader__.load')
  return definition
}

function recordingContext() {
  const record = {
    localeNamespaces: [],
    documentPreviews: [],
    slots: [],
    fileViewers: [],
    fileIcons: [],
    effects: 0,
  }
  const ctx = {
    effect(fn, label) {
      record.effects += 1
      record[label ?? 'anonymous'] = true
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(deps, callback) {
      for (const dep of deps) {
        if (!(dep in ctx)) throw new Error(`fake context has no service for injected dependency: ${dep}`)
      }
      callback(ctx)
      return ctx
    },
    locale: {
      register(namespace, dictionaries) {
        record.localeNamespaces.push({ namespace, dictionaries })
        return () => {}
      },
      bind: () => (key) => key,
      subscribe: () => () => {},
      getLocale: () => ({ id: 'zh' }),
    },
    documentPreviews: {
      register(definition) {
        record.documentPreviews.push(definition)
        return () => {}
      },
    },
    slots: {
      register(options, component) {
        record.slots.push({ options, component })
        return () => {}
      },
      inject(_key, callback) {
        callback()
        return () => {}
      },
    },
    betterSidebar: {
      registerFileViewer(descriptor) {
        record.fileViewers.push(descriptor)
        return () => {}
      },
      registerFileIcon(descriptor) {
        record.fileIcons.push(descriptor)
        return () => {}
      },
    },
  }
  return { ctx, record }
}

test('client bundle loads and declares its exported plugin shape', () => {
  const definition = loadBundle()
  assert.equal(definition.id, 'dsh-ontology-viewer')
  assert.equal(typeof definition.factory, 'function')

  const plugin = definition.factory((name) => {
    if (name === 'react') return fakeReact()
    throw new Error(`unexpected require(${name})`)
  })
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply registers the document preview metadata and its slot body', () => {
  const definition = loadBundle()
  const plugin = definition.factory(() => fakeReact())
  const { ctx, record } = recordingContext()
  plugin.apply(ctx)

  assert.equal(record.documentPreviews.length, 1)
  const preview = record.documentPreviews[0]
  assert.equal(preview.id, 'dsh-ontology-viewer/graph')
  assert.deepEqual([...preview.extensions], EXPECTED_EXTENSIONS)
  assert.equal(preview.loading, 'bytes-complete')
  assert.equal(preview.wrap, false)
  assert.equal(preview.priority, 'extension')
  assert.equal(typeof preview.title, 'function')
  assert.equal(typeof preview.title(), 'string')

  const body = record.slots.find((entry) => entry.options.key === preview.id)
  assert.ok(body, 'a body must be registered under the same key as the metadata id')
  assert.equal(body.options.name, 'sidebar.right.tab.document')
  assert.equal(typeof body.component, 'function')
})

test('apply registers the better-sidebar viewer, icon, and locale dictionaries', () => {
  const definition = loadBundle()
  const plugin = definition.factory(() => fakeReact())
  const { ctx, record } = recordingContext()
  plugin.apply(ctx)

  assert.equal(record.fileViewers.length, 1)
  const viewer = record.fileViewers[0]
  assert.equal(viewer.id, 'dsh-ontology-viewer')
  assert.deepEqual([...viewer.exts], EXPECTED_EXTENSIONS)
  assert.equal(viewer.fetchStrategy, 'fsRead')
  assert.equal(typeof viewer.component, 'function')
  assert.equal(typeof viewer.title, 'function')

  assert.equal(record.fileIcons.length, 1)
  assert.deepEqual([...record.fileIcons[0].exts], EXPECTED_EXTENSIONS)
  const icon = record.fileIcons[0].icon('a/b.ttl', 14)
  assert.equal(icon.type, 'svg')

  assert.equal(record.localeNamespaces.length, 1)
  const { namespace, dictionaries } = record.localeNamespaces[0]
  assert.equal(namespace, 'dshOntology')
  for (const locale of ['zh', 'en']) {
    assert.ok(dictionaries[locale], `missing ${locale} dictionary`)
    assert.ok(dictionaries[locale]['viewer.title'], `missing ${locale} viewer.title`)
  }
})

test('the bundle has no leftover module syntax', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.equal(/^\s*export\s/m.test(source), false, 'client.js must not contain ES module exports')
  assert.equal(/^\s*import\s/m.test(source), false, 'client.js must not contain ES module imports')
  assert.equal(source.includes('React.createElement'), true)
})

test('the bundle embeds the background worker source', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.equal(source.includes('ONTOLOGY_WORKER_SOURCE'), true, 'client.js must embed the worker source constant')
  assert.equal(source.includes('self.onmessage'), true, 'the embedded worker source must install a message handler')
  assert.equal(source.includes('worker-entry.js'), true, 'the worker source is generated from src/worker-entry.js')
  // The worker source is a string literal inside the factory, never a second request.
  assert.equal(/importScripts\s*\(/.test(source), false, 'the worker must not load extra scripts')
})

test('locale dictionaries carry the new structured UI keys', () => {
  const definition = loadBundle()
  const plugin = definition.factory(() => fakeReact())
  const { ctx, record } = recordingContext()
  plugin.apply(ctx)
  const { dictionaries } = record.localeNamespaces[0]
  for (const locale of ['zh', 'en']) {
    for (const key of ['viewer.filters', 'viewer.explore', 'viewer.truncation', 'state.degraded', 'diag.triple-limit']) {
      assert.equal(typeof dictionaries[locale][key], 'string', `missing ${locale} ${key}`)
    }
  }
})

/** Extract the embedded worker source string from the built bundle. */
function embeddedWorkerSource(source) {
  const marker = 'const ONTOLOGY_WORKER_SOURCE = '
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'client.js must declare ONTOLOGY_WORKER_SOURCE')
  const quote = source.indexOf('"', start + marker.length)
  assert.ok(quote >= 0, 'worker source must be a JSON string literal')
  let escaped = false
  for (let index = quote + 1; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '"') {
      return JSON.parse(source.slice(quote, index + 1))
    }
  }
  throw new Error('unterminated ONTOLOGY_WORKER_SOURCE literal')
}

test('embedded worker source runs compute and relayout successfully', () => {
  const workerSource = embeddedWorkerSource(readFileSync(bundlePath, 'utf8'))
  assert.match(workerSource, /self\.onmessage/)
  assert.equal(/^\s*export\s/m.test(workerSource), false)
  assert.equal(/^\s*import\s/m.test(workerSource), false)

  const outbox = []
  const self = {
    postMessage: (message) => outbox.push(message),
    onmessage: null,
  }
  const sandbox = { self, console, TextDecoder, TextEncoder, Date, Math, JSON, Float64Array }
  vm.createContext(sandbox)
  vm.runInContext(workerSource, sandbox, { filename: 'ontology-worker.js' })
  assert.equal(typeof self.onmessage, 'function', 'worker must install self.onmessage')

  self.onmessage({
    data: {
      type: 'compute',
      id: 'test-1',
      text: '@prefix ex: <http://example.org/> . ex:a ex:b ex:c . ex:a ex:label "hello" .',
      resourceAddress: 'file:///data/sample.ttl',
      displayName: 'sample.ttl',
      limits: { maxTriples: 1000, maxNodes: 100, maxEdges: 100, maxLiteralsPerNode: 10, maxLiteralLength: 4096, maxDepth: 64 },
      layout: { width: 400, height: 300, seed: 1, iterations: 10 },
    },
  })

  const graphMessage = outbox.find((message) => message.type === 'graph')
  assert.ok(graphMessage, 'worker must answer with a graph message')
  assert.equal(graphMessage.id, 'test-1')
  assert.equal(graphMessage.graph.nodes.length, 2)
  assert.equal(graphMessage.graph.source.address, 'file:///data/sample.ttl')
  assert.equal(graphMessage.baseSource, 'resource')

  const layoutMessage = outbox.find((message) => message.type === 'layout')
  assert.ok(layoutMessage, 'worker must answer with a layout message')
  assert.ok(layoutMessage.positions instanceof Float64Array)
  assert.equal(layoutMessage.positions.length, graphMessage.graph.nodes.length * 2)

  outbox.length = 0
  self.onmessage({ data: { type: 'relayout', id: 'test-1', width: 500, height: 320, seed: 2, iterations: 10 } })
  const relayout = outbox.find((message) => message.type === 'layout')
  assert.ok(relayout, 'relayout must reuse the cached graph')
  assert.equal(relayout.positions.length, graphMessage.graph.nodes.length * 2)
})
