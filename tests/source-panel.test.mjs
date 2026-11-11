import test from 'node:test'
import assert from 'node:assert/strict'
import { createMultiview, exploreRootNotClass } from '../src/graph-view-multiview.js'

function fakeReact() {
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  return {
    createElement: h,
    useMemo: factory => factory(),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: initial => ({ current: initial }),
  }
}
function flatten(tree, into = []) {
  if (Array.isArray(tree)) return tree.forEach(item => flatten(item, into)), into
  if (tree && typeof tree === 'object') {
    into.push(tree)
    flatten(tree.children, into)
  }
  return into
}
function tr(key, fallback) { return fallback }

function panel(props) {
  const { SourcePanel } = createMultiview(fakeReact())
  return flatten(SourcePanel({ tr, ...props }))
}

test('SourcePanel renders every file status, warning badge and action with accessible names', () => {
  const sources = [
    { sourceId: 'ready', displayName: 'ready.ttl', origin: 'host', status: 'ready', format: 'turtle', tripleCount: 2 },
    { sourceId: 'empty', displayName: 'empty.nt', origin: 'browser', status: 'empty', tripleCount: 0 },
    { sourceId: 'bad', displayName: 'bad.owl', origin: 'host', status: 'error', errorCount: 1, warningCount: 2, truncated: true, stale: true },
    { sourceId: 'partial', displayName: 'partial.rdf', origin: 'browser', status: 'partial', tripleCount: 1 },
  ]
  const tree = panel({ sources, totals: { files: 4, bytes: 0, occurrences: 3 }, worksetIds: [],
    onSetWorkset() {}, onAddFiles() {}, onRequestReload() {}, onRemove() {}, onClose() {} })
  const text = tree.map(n => n.children?.flat?.().filter(x => typeof x === 'string').join(' ')).join(' ')
  assert.ok(JSON.stringify(tree).includes('ready.ttl'))
  assert.ok(JSON.stringify(tree).includes('empty.nt'))
  assert.ok(JSON.stringify(tree).includes('bad.owl'))
  assert.ok(JSON.stringify(tree).includes('partial.rdf'))
  const inputs = tree.filter(node => node.type === 'input')
  assert.ok(inputs.some(node => node.props.type === 'file' && node.props.multiple === true))
  assert.ok(inputs.some(node => node.props.type === 'checkbox' && node.props['aria-label'].includes('bad.owl')))
  assert.ok(tree.some(node => node.type === 'button' && node.props['aria-label'] === 'Add files'))
  assert.ok(JSON.stringify(tree).includes('Errors'))
  assert.ok(JSON.stringify(tree).includes('Warnings'))
  assert.ok(JSON.stringify(tree).includes('Truncated'))
  assert.ok(JSON.stringify(tree).includes('Changed on disk'))
})

test('SourcePanel checkbox removes one source from implicit all and can restore union', () => {
  let selection
  const sources = [{ sourceId: 'a', displayName: 'a.ttl' }, { sourceId: 'b', displayName: 'b.nt' }]
  const props = { sources, totals: { files: 2, occurrences: 2 }, worksetIds: [],
    onSetWorkset(next) { selection = next }, onAddFiles() {}, onRequestReload() {}, onRemove() {}, onClose() {} }
  let tree = panel(props)
  const checkbox = tree.find(node => node.type === 'input' && node.props.type === 'checkbox')
  checkbox.props.onChange({ target: { checked: false } })
  assert.deepEqual(selection, ['b'])
  tree = panel({ ...props, worksetIds: selection })
  const union = tree.find(node => node.type === 'button' && node.props['aria-label'] === 'All sources')
  assert.equal(union.props['aria-pressed'], false)
  union.props.onClick()
  assert.deepEqual(selection, [])
})

test('SourcePanel surfaces read rejection and browser reload affordance', () => {
  const tree = panel({ sources: [{ sourceId: 'bad', displayName: 'read-error.ttl', origin: 'browser', status: 'error' }],
    totals: { files: 1, occurrences: 0 }, worksetIds: [], onSetWorkset() {}, onAddFiles() {}, onRequestReload() {}, onRemove() {}, onClose() {} })
  assert.ok(tree.some(node => node.type === 'button' && node.props['aria-label'] === 'Reload read-error.ttl'))
  assert.ok(tree.some(node => node.type === 'span' && String(node.children[0] || '').includes('error')))
})


test('exploration root applicability depends on the anchor kind and on exploring', () => {
  const graph = { nodes: [
    { id: 'urn:Person', kind: 'individual' },
    { id: 'urn:Thing', kind: 'class' },
  ] }
  assert.equal(exploreRootNotClass(graph, 'urn:Person', true), true)
  assert.equal(exploreRootNotClass(graph, 'urn:Thing', true), false)
  assert.equal(exploreRootNotClass(graph, 'urn:Person', false), false)
  assert.equal(exploreRootNotClass(graph, null, true), false)
  assert.equal(exploreRootNotClass(null, 'urn:Person', true), false)
})
