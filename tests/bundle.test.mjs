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
