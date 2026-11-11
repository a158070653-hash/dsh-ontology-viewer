import { test } from 'node:test'
import assert from 'node:assert/strict'
import { URL as NodeURL } from 'node:url'
import {
  buildNetworkScene,
  buildTreeScene,
  buildLayeredScene,
  renderSceneSvg,
  planPngExport,
  rasterizePng,
  exportSceneReady,
  displayedSceneReady,
  readHostThemeToken,
  escapeSvgText,
  safeSvgColor,
  exportThemeFromTokens,
  EXPORT_LIMITS,
} from '../src/graph-export.js'

const NODES = [
  { id: 'a', label: 'Alpha', kind: 'class' },
  { id: 'b', label: 'Beta', kind: 'individual' },
  { id: 'c', label: 'Gamma', kind: 'property' },
]
const POSITIONS = [
  { id: 'a', x: 100, y: 100 },
  { id: 'b', x: 300, y: 200 },
  { id: 'c', x: 500, y: 300 },
]
const EDGES = [
  { id: 'e1', source: 'a', target: 'b', label: 'rdfs:subClassOf', count: 1, sourceIds: ['s1'] },
  { id: 'e2', source: 'b', target: 'c', label: 'ex:p', count: 2, sourceIds: ['s1'] },
]

function network(options) {
  return buildNetworkScene(Object.assign({
    nodes: NODES,
    edges: EDGES,
    positions: POSITIONS,
    viewport: { width: 400, height: 300 },
    camera: { zoom: 1, panX: 0, panY: 0 },
    revision: 7,
    labels: true,
    theme: { background: '#000', node: '#111', edge: '#222', nodeText: '#333', edgeText: '#444' },
  }, options || {}))
}

/* ------------------------------------------------------------------ */
/* Scene construction                                                 */
/* ------------------------------------------------------------------ */

test('scene: viewport range crops and keeps only intersecting nodes', () => {
  const scene = network({ range: 'viewport' })
  assert.equal(scene.range, 'viewport')
  assert.deepEqual(scene.viewBox, { x: 0, y: 0, width: 400, height: 300 })
  assert.deepEqual(scene.nodes.map((node) => node.id), ['a', 'b'])
  assert.equal(scene.truncated.nodes, 1)
  assert.equal(scene.truncated.edges, 1, 'the b-c edge left the crop')
})

test('scene: layout range keeps the whole displayed set and its bounds', () => {
  const scene = network({ range: 'layout' })
  assert.equal(scene.range, 'layout')
  assert.equal(scene.nodes.length, 3)
  assert.equal(scene.edges.length, 2)
  assert.ok(scene.viewBox.width >= 400)
  assert.ok(scene.viewBox.height >= 200)
  assert.equal(scene.truncated.nodes, 0)
})

test('scene: dragged positions survive and unknown nodes are never invented', () => {
  const dragged = network({
    range: 'layout',
    positions: [
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 30, y: 40 },
    ],
  })
  assert.deepEqual(dragged.nodes.map((node) => [node.id, node.x, node.y]),
    [['a', 10, 20], ['b', 30, 40]])
  assert.equal(dragged.truncated.nodes, 1, 'a node without a position is reported, not guessed')
})

test('scene: camera zoom and pan define the viewport viewBox', () => {
  const scene = network({ range: 'viewport', camera: { zoom: 2, panX: -100, panY: -50 } })
  assert.deepEqual(scene.viewBox, { x: 50, y: 25, width: 200, height: 150 })
  assert.equal(scene.width, 400)
  assert.equal(scene.height, 300)
})

test('scene: stale or empty scenes are refused', () => {
  const scene = network({ range: 'layout' })
  assert.equal(exportSceneReady(scene, 7).ok, true)
  assert.equal(exportSceneReady(scene, 8).reason, 'stale-scene')
  assert.equal(exportSceneReady({ nodes: [], revision: 1 }).reason, 'empty-scene')
  assert.equal(exportSceneReady(null).reason, 'no-scene')
})

test('scene: tree and layered scenes carry their expanded display sets', () => {
  const tree = buildTreeScene([
    { refId: 'r0', entityId: 'A', depth: 0, label: 'A' },
    { refId: 'r1', entityId: 'B', depth: 1, parentRefId: 'r0', label: 'B' },
    { refId: 'r2', entityId: 'B', depth: 5, parentRefId: 'r1', label: 'B', cycle: true },
  ], { revision: 3 })
  assert.equal(tree.viewType, 'tree')
  assert.equal(tree.nodes.length, 3)
  assert.equal(tree.edges.length, 2)
  assert.ok(tree.nodes[2].label.startsWith('\u21ba'))

  const layered = buildLayeredScene({
    nodes: [
      { id: 'A', x: 10, y: 10, label: 'A', kind: 'class' },
      { id: 'G', x: 50, y: 10, label: 'G', kind: 'group', groupId: 'G', memberCount: 2 },
    ],
    edges: [{ id: 'e', source: 'A', target: 'G', label: 'rdfs:subClassOf', count: 1 }],
  }, { revision: 3 })
  assert.equal(layered.viewType, 'layered')
  assert.equal(layered.edges.length, 1)
})

/* ------------------------------------------------------------------ */
/* SVG safety                                                         */
/* ------------------------------------------------------------------ */

test('svg: exported labels are escaped text, never markup', () => {
  const malicious = [
    '<script>alert(1)</script>',
    '"><img src=x onload=alert(1)>',
    '</text><foreignObject><script>x</script></foreignObject>',
    'a&b',
    "single'quote\"double",
  ]
  const scene = buildNetworkScene({
    nodes: malicious.map((label, index) => ({ id: 'm' + index, label: label, kind: 'class' })),
    edges: [],
    positions: malicious.map((label, index) => ({ id: 'm' + index, x: 10 * index, y: 10 })),
    range: 'layout',
  })
  const svg = renderSceneSvg(scene)
  const tags = svg.replace(/>[^<]*</g, '><')
  const lowerTags = tags.toLowerCase()
  assert.ok(!lowerTags.includes('<script'))
  assert.ok(!lowerTags.includes('<foreignobject'))
  assert.ok(!lowerTags.includes('<img'))
  assert.ok(!lowerTags.includes('onload'))
  assert.ok(!lowerTags.includes('onerror'))
  assert.ok(!lowerTags.includes('href'))
  assert.ok(!lowerTags.includes('<a '))
  assert.ok(!lowerTags.includes('url('))
  assert.ok(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(svg.includes('&amp;'))
  assert.ok(svg.includes('&quot;'))
  assert.ok(svg.includes('&apos;'))
  // The document is balanced and uses only the SVG namespace.
  assert.equal((svg.match(/<svg /g) || []).length, 1)
  assert.equal((svg.match(/<\/svg>/g) || []).length, 1)
})

test('svg: no external references, entity declarations or CSS payloads', () => {
  const scene = buildNetworkScene({
    nodes: [
      { id: 'a', label: 'url(javascript:alert(1))', kind: 'class' },
      { id: 'b', label: '<!DOCTYPE x [<!ENTITY e "y">]>', kind: 'class' },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', label: 'href="http://evil.example"' }],
    positions: [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 40, y: 10 }],
    range: 'layout',
    theme: { node: 'url(http://evil.example/x.png)', background: 'javascript:alert(1)' },
  })
  const svg = renderSceneSvg(scene)
  const tags = svg.replace(/>[^<]*</g, '><')
  const lowerTags = tags.toLowerCase()
  assert.ok(!lowerTags.includes('href'), 'RDF URLs must not become attributes')
  assert.ok(!lowerTags.includes('xlink'))
  assert.ok(!lowerTags.includes('url('))
  assert.ok(!lowerTags.includes('<!doctype'))
  assert.ok(!lowerTags.includes('<!entity'))
  assert.ok(!lowerTags.includes('<image'))
  assert.ok(!lowerTags.includes('javascript:'))
  assert.ok(!lowerTags.includes('style='))
  // A rejected theme color falls back to a literal color.
  assert.ok(svg.includes('#ffffff') || svg.includes('#000000'))
})

test('svg: invalid geometry and control characters are neutralized', () => {
  const scene = buildNetworkScene({
    nodes: [{ id: 'a', label: 'ok\u0000\u0007label', kind: 'class' }],
    edges: [],
    positions: [{ id: 'a', x: NaN, y: Infinity }],
    range: 'layout',
  })
  const svg = renderSceneSvg(scene)
  assert.ok(!svg.includes('NaN'))
  assert.ok(!svg.includes('Infinity'))
  assert.ok(!/\u0000/.test(svg))
  const text = escapeSvgText('x\u0007y')
  assert.equal(text, 'xy')
})

test('colors: only literal or numeric functional colors survive', () => {
  assert.equal(safeSvgColor('#abc', '#000'), '#abc')
  assert.equal(safeSvgColor('#aabbcc', '#000'), '#aabbcc')
  assert.equal(safeSvgColor('rgb(1, 2, 3)', '#000'), 'rgb(1, 2, 3)')
  assert.equal(safeSvgColor('url(http://x)', '#000'), '#000')
  assert.equal(safeSvgColor('var(--x)', '#000'), '#000')
  assert.equal(safeSvgColor('expression(alert(1))', '#000'), '#000')
  const theme = exportThemeFromTokens((name) => (name === '--dsw-alias-brand-primary' ? '#123456' : 'url(x)'))
  assert.equal(theme.node, '#123456')
  assert.equal(theme.background, '#ffffff')
})

/* ------------------------------------------------------------------ */
/* PNG planning and rasterization fallback                            */
/* ------------------------------------------------------------------ */

test('png: pixel and side budgets are checked before allocation', () => {
  const scene = network({ range: 'layout' })
  const ok = planPngExport(scene, { scale: 1 })
  assert.equal(ok.ok, true)
  assert.equal(ok.pixels, scene.width * scene.height)

  const huge = { width: 9000, height: 10, nodes: [{}], revision: 1 }
  assert.equal(planPngExport(huge, { scale: 1 }).reason, 'max-side')

  const big = { width: 5000, height: 5000, nodes: [{}], revision: 1 }
  assert.equal(planPngExport(big, { scale: 1 }).reason, 'max-pixels')

  // Only the declared scales are accepted; anything else falls back to 1x.
  assert.equal(planPngExport(scene, { scale: 3 }).scale, 1)
  assert.equal(planPngExport(scene, { scale: 2 }).scale, 2)
  const sceneSmall = { width: 100, height: 100, nodes: [{}], revision: 1 }
  assert.equal(planPngExport(sceneSmall, { scale: 2 }).pixels, 40000)
  assert.ok(EXPORT_LIMITS.allowedScales.includes(1))
})

test('png: missing browser capabilities fail without inventing a server', async () => {
  const scene = network({ range: 'layout' })
  const plan = planPngExport(scene, { scale: 1 })
  const svg = renderSceneSvg(scene)
  const missing = await rasterizePng(svg, plan, {})
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'unavailable')

  const noPlan = await rasterizePng(svg, { ok: false, reason: 'max-pixels' }, {})
  assert.equal(noPlan.ok, false)
  assert.equal(noPlan.reason, 'max-pixels')
})

test('png: decode and encoding failures report a reason for the SVG fallback', async () => {
  const scene = network({ range: 'layout' })
  const plan = planPngExport(scene, { scale: 1 })
  const svg = renderSceneSvg(scene)

  const decodeFailure = await rasterizePng(svg, plan, {
    Image: class { set src(value) { setTimeout(() => this.onerror && this.onerror(), 0) } },
    Blob: class { constructor(parts) { this.parts = parts } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: { createElement: () => ({}) },
  })
  assert.equal(decodeFailure.ok, false)
  assert.match(String(decodeFailure.reason), /decode|failed/i)

  let revoked = 0
  const nullBlob = await rasterizePng(svg, plan, {
    Image: class {
      set src(value) { setTimeout(() => this.onload && this.onload(), 0) }
    },
    Blob: class { constructor(parts) { this.parts = parts } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => { revoked += 1 } },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (callback) => callback(null),
      }),
    },
  })
  assert.equal(nullBlob.ok, false)
  assert.equal(nullBlob.reason, 'to-blob-failed')
  assert.equal(revoked, 1, 'the object URL is released even on failure')

  const success = await rasterizePng(svg, plan, {
    Image: class {
      set src(value) { setTimeout(() => this.onload && this.onload(), 0) }
    },
    Blob: class { constructor(parts) { this.parts = parts } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (callback, type) => callback({ type: type, size: 1 }),
      }),
    },
  })
  assert.equal(success.ok, true)
  assert.equal(success.width, plan.width)
  assert.equal(success.height, plan.height)
})

test('rasterizePng: accepts URL constructors and facades and releases raster resources', async () => {
  const scene = network({ range: 'layout' })
  const plan = planPngExport(scene, { scale: 1 })
  const svg = renderSceneSvg(scene)
  for (const URLImpl of [NodeURL, {
    createObjectURL: NodeURL.createObjectURL,
    revokeObjectURL: NodeURL.revokeObjectURL,
  }]) {
    let imageInstance = null
    let canvasInstance = null
    const result = await rasterizePng(svg, plan, {
      Image: class FakeImage {
        constructor() {
          imageInstance = this
          this.onload = null
          this.onerror = null
          this.src = ''
        }
        set src(value) {
          this.currentSrc = value
          if (value) setTimeout(() => this.onload && this.onload(), 0)
        }
      },
      Blob,
      URL: URLImpl,
      document: {
        createElement: () => {
          canvasInstance = {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (callback, type) => callback({ type: type, size: 1 }),
          }
          return canvasInstance
        },
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.width, plan.width)
    assert.equal(result.height, plan.height)
    assert.equal(imageInstance.onload, null)
    assert.equal(imageInstance.onerror, null)
    assert.equal(imageInstance.currentSrc, '')
    assert.equal(canvasInstance.width, 0)
    assert.equal(canvasInstance.height, 0)
  }
})

test('rasterizePng: a module globalThis without DOM still uses the page window', async () => {
  const saved = globalThis.window
  globalThis.window = {
    Image: class FakeImage {
      constructor() { this.onload = null; this.onerror = null }
      set src(value) { setTimeout(() => { if (this.onerror) this.onerror(new Error('decode')) }, 0) }
    },
    Blob: function FakeBlob() {},
    URL: { createObjectURL() { return 'blob:fake' }, revokeObjectURL() {} },
    document: { createElement() { return { getContext() { return null } } } },
  }
  try {
    const result = await rasterizePng('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { ok: true, width: 8, height: 8, scale: 1 }, null)
    assert.notEqual(result.ok, true)
    assert.notEqual(result.reason, 'unavailable', 'window constructors were detected')
  } finally {
    if (saved === undefined) delete globalThis.window
    else globalThis.window = saved
  }
})

test('displayed scene: the export report must belong to the current graph identity', () => {
  const graph = { nodes: [{ id: 'a' }], edges: [] }
  const displayed = { graph: graph, ready: true, nodes: [{ id: 'a' }], edges: [], positions: [{ id: 'a', x: 1, y: 1 }] }
  assert.equal(displayedSceneReady(displayed, graph), true)
  assert.equal(displayedSceneReady(displayed, { nodes: [{ id: 'a' }], edges: [] }), false,
    'a re-normalized graph is a different identity and must not be exported')
  assert.equal(displayedSceneReady(Object.assign({}, displayed, { ready: false }), graph), false)
  assert.equal(displayedSceneReady(null, graph), false)
})

test('host theme tokens are read from body first, then documentElement', () => {
  const body = { tokens: { '--t': ' #123456 ' } }
  const root = { tokens: { '--t': '#000000', '--only-root': '#abcdef' } }
  const doc = { body, documentElement: root }
  const getStyle = (element) => ({ getPropertyValue: (name) => (element.tokens && element.tokens[name]) || '' })
  assert.equal(readHostThemeToken('--t', '#fff', doc, getStyle), '#123456', 'body wins when both define the token')
  assert.equal(readHostThemeToken('--only-root', '#fff', doc, getStyle), '#abcdef', 'documentElement is the fallback root')
  assert.equal(readHostThemeToken('--missing', '#fff', doc, getStyle), '#fff')
  assert.equal(readHostThemeToken('--t', '#fff', null, getStyle), '#fff', 'no document means the literal fallback')
  const throwing = () => { throw new Error('style unavailable') }
  assert.equal(readHostThemeToken('--t', '#fafafa', doc, throwing), '#fafafa')
})

test('scene bounds include node labels so long text is not cropped', () => {
  const longLabel = 'A very long class label that would overflow a point-based viewBox'
  const tree = buildTreeScene([
    { refId: 'r0', entityId: 'A', depth: 0, label: longLabel },
    { refId: 'r1', entityId: 'B', depth: 1, parentRefId: 'r0', label: 'B' },
  ], { revision: 7 })
  const right = tree.nodes[0].x + Math.ceil(longLabel.length * 6.2)
  assert.ok(tree.viewBox.x <= tree.nodes[0].x - 19, 'left padding keeps the row start inside')
  assert.ok(tree.viewBox.x + tree.viewBox.width >= right, 'label end stays inside the viewBox')
  assert.ok(tree.width > tree.nodes[0].x - tree.viewBox.x + longLabel.length * 5, 'width grows with the label')

  const layered = buildLayeredScene({
    nodes: [
      { id: 'A', x: 10, y: 10, label: longLabel, kind: 'class' },
      { id: 'B', x: 200, y: 10, label: 'B', kind: 'class' },
    ],
    edges: [{ id: 'e', source: 'A', target: 'B', label: 'rdfs:subClassOf', count: 1 }],
  }, { revision: 7 })
  const layeredRight = layered.nodes[0].x + Math.ceil(longLabel.length * 6.2)
  assert.ok(layered.viewBox.x + layered.viewBox.width >= layeredRight, 'layered labels stay inside')
})
