/**
 * Static export of the currently displayed graph view (SVG / PNG).
 *
 * The exporter never serializes the live host DOM: the view hands over an
 * explicit scene snapshot (visible nodes, visible edges, positions, labels,
 * theme). RDF text is treated as untrusted text, so it is escaped and never
 * becomes markup, an attribute, a style rule or an external reference. PNG is
 * produced from the same safe SVG inside the browser; there is no server-side
 * renderer.
 *
 * Plain ECMAScript: concatenated into the Client bundle (see build/build.mjs)
 * and imported directly by Node tests. Browser APIs are only touched inside
 * `rasterizePng`, through an injectable environment.
 */

/** Hard candidate limits for one rasterized export (tuned later by benchmarks). */
export const EXPORT_LIMITS = Object.freeze({
  maxPixels: 16 * 1024 * 1024,
  maxSide: 8192,
  defaultScale: 1,
  allowedScales: [1, 2],
})

const SVG_NS = 'http://www.w3.org/2000/svg'
const FALLBACK_THEME = Object.freeze({
  background: '#ffffff',
  node: '#4f6bed',
  nodeText: '#1f2430',
  edge: '#9aa3b2',
  edgeText: '#6b7280',
  group: '#7c5cd6',
})

function exportIsObject(value) {
  return value !== null && typeof value === 'object'
}

/** Coerce to a finite number, else return the fallback. */
function exportNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Escape text for XML character data; control characters are removed. */
export function escapeSvgText(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Only literal colors or numeric rgb()/hsl() functions are emitted. Anything
 * else (including `url(...)`, `var(...)` or expressions) falls back, so RDF
 * text can never reach a style attribute as a payload.
 */
export function safeSvgColor(value, fallback) {
  const color = typeof value === 'string' ? value.trim() : ''
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color
  if (/^rgba?\(\s*[\d.%\s,/]+\)$/.test(color)) return color
  if (/^hsla?\(\s*[\d.%\s,/a-z]+\)$/i.test(color) && color.indexOf('url') < 0) return color
  if (color === 'transparent') return color
  return typeof fallback === 'string' ? fallback : '#000000'
}

/** One-line label text with finite position; long labels are clipped. */
function exportLabelNode(value, maxLength) {
  const text = (value === null || value === undefined ? '' : String(value))
    // Control characters (including the NUL separators of tagged identities)
    // are never valid in exported text.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return text.slice(0, Math.max(0, maxLength - 1)) + '\u2026'
}

function exportTheme(theme) {
  const input = exportIsObject(theme) ? theme : {}
  return {
    background: safeSvgColor(input.background, FALLBACK_THEME.background),
    node: safeSvgColor(input.node, FALLBACK_THEME.node),
    nodeText: safeSvgColor(input.nodeText, FALLBACK_THEME.nodeText),
    edge: safeSvgColor(input.edge, FALLBACK_THEME.edge),
    edgeText: safeSvgColor(input.edgeText, FALLBACK_THEME.edgeText),
    group: safeSvgColor(input.group, FALLBACK_THEME.group),
  }
}

/** Normalize one node entry from the view's display data. */
function exportNode(entry, index) {
  if (!exportIsObject(entry)) return null
  const id = typeof entry.id === 'string' ? entry.id : 'n' + index
  return {
    id: id,
    x: exportNumber(entry.x, 0),
    y: exportNumber(entry.y, 0),
    label: exportLabelNode(entry.label, 160),
    kind: typeof entry.kind === 'string' ? entry.kind : 'individual',
    groupId: typeof entry.groupId === 'string' ? entry.groupId : null,
    memberCount: exportNumber(entry.memberCount, 0),
  }
}

/** Normalize one edge entry; positions come from the node position table. */
function exportEdge(entry, positions, index) {
  if (!exportIsObject(entry)) return null
  const source = typeof entry.source === 'string' ? entry.source : ''
  const target = typeof entry.target === 'string' ? entry.target : ''
  const from = positions.get(source)
  const to = positions.get(target)
  if (!from || !to) return null
  return {
    id: typeof entry.id === 'string' ? entry.id : 'e' + index,
    source: source,
    target: target,
    x1: exportNumber(from.x, 0),
    y1: exportNumber(from.y, 0),
    x2: exportNumber(to.x, 0),
    y2: exportNumber(to.y, 0),
    label: exportLabelNode(entry.label, 80),
    count: exportNumber(entry.count, 1),
  }
}

function exportPositions(list) {
  const map = new Map()
  for (const entry of list) {
    if (!exportIsObject(entry)) continue
    if (typeof entry.id !== 'string') continue
    map.set(entry.id, { x: exportNumber(entry.x, 0), y: exportNumber(entry.y, 0) })
  }
  return map
}

/**
 * Estimate the horizontal space a node label needs in the exported SVG. The
 * renderer draws node labels with a 10px system font starting at the node x,
 * so a fixed padding is not enough: long labels used to be centred outside the
 * viewBox and silently cropped from SVG/PNG output.
 */
function exportLabelWidth(label) {
  const text = typeof label === 'string' ? label : ''
  if (!text) return 0
  return Math.min(600, Math.ceil(text.length * 6.2))
}

/**
 * Bounds for a static scene that include each node label (drawn above the node
 * and extending to the right) so text never overflows the exported viewBox.
 */
function exportSceneBounds(nodes, padding) {
  const list = Array.isArray(nodes) ? nodes : []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of list) {
    if (!exportIsObject(node)) continue
    const x = exportNumber(node.x, NaN)
    const y = exportNumber(node.y, NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const right = x + exportLabelWidth(node.label)
    if (x < minX) minX = x
    if (right > maxX) maxX = right
    if (y - 14 < minY) minY = y - 14
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return null
  const pad = exportNumber(padding, 24)
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  }
}

function exportSceneBase(viewType, revision, range) {
  return {
    viewType: viewType,
    revision: exportNumber(revision, 0),
    range: range,
    viewBox: { x: 0, y: 0, width: 1, height: 1 },
    width: 1,
    height: 1,
    nodes: [],
    edges: [],
    labels: true,
    theme: exportTheme(null),
    truncated: { nodes: 0, edges: 0 },
    meta: {},
  }
}

/**
 * Build a scene from the network view.
 * @param {{nodes: any[], edges: any[], positions?: any[], width?: number,
 *          height?: number, camera?: {zoom?: number, panX?: number, panY?: number},
 *          viewport?: {width?: number, height?: number},
 *          range?: 'viewport'|'layout', labels?: boolean, theme?: object,
 *          revision?: number, truncated?: object, meta?: object}} options
 */
export function buildNetworkScene(options) {
  const opts = exportIsObject(options) ? options : {}
  const range = opts.range === 'layout' ? 'layout' : 'viewport'
  const scene = exportSceneBase('network', opts.revision, range)
  const nodeList = Array.isArray(opts.nodes) ? opts.nodes : []
  const edgeList = Array.isArray(opts.edges) ? opts.edges : []
  const positions = exportPositions(Array.isArray(opts.positions) ? opts.positions : nodeList)
  const camera = exportIsObject(opts.camera) ? opts.camera : {}
  const zoom = Math.max(0.01, exportNumber(camera.zoom, 1))
  const panX = exportNumber(camera.panX, 0)
  const panY = exportNumber(camera.panY, 0)
  const viewportWidth = Math.max(1, exportNumber(opts.viewport && opts.viewport.width, 900))
  const viewportHeight = Math.max(1, exportNumber(opts.viewport && opts.viewport.height, 600))
  const theme = exportTheme(opts.theme)

  for (let index = 0; index < nodeList.length; index++) {
    const raw = nodeList[index]
    if (!exportIsObject(raw) || typeof raw.id !== 'string') continue
    const point = positions.get(raw.id)
    if (!point) {
      scene.truncated.nodes += 1
      continue
    }
    const node = exportNode({
      id: raw.id,
      x: point.x,
      y: point.y,
      label: raw.label !== undefined ? raw.label : raw.id,
      kind: raw.kind,
    }, index)
    scene.nodes.push(node)
  }
  const nodeIds = new Set(scene.nodes.map((node) => node.id))
  for (let index = 0; index < edgeList.length; index++) {
    const edge = exportEdge(edgeList[index], positions, index)
    if (!edge || !nodeIds.has(edge.source)) continue
    scene.edges.push(edge)
  }

  if (range === 'viewport') {
    scene.viewBox = {
      x: panX === 0 ? 0 : -panX / zoom,
      y: panY === 0 ? 0 : -panY / zoom,
      width: viewportWidth / zoom,
      height: viewportHeight / zoom,
    }
    scene.width = Math.round(viewportWidth)
    scene.height = Math.round(viewportHeight)
    // Keep only geometry that intersects the crop.
    const view = scene.viewBox
    const inside = (node) => (
      node.x >= view.x && node.x <= view.x + view.width &&
      node.y >= view.y && node.y <= view.y + view.height
    )
    const kept = scene.nodes.filter(inside)
    scene.truncated.nodes += scene.nodes.length - kept.length
    scene.nodes = kept
    const keptIds = new Set(kept.map((node) => node.id))
    const before = scene.edges.length
    scene.edges = scene.edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
    scene.truncated.edges += before - scene.edges.length
  } else {
    const bounds = exportSceneBounds(scene.nodes, 32) || { x: 0, y: 0, width: 1, height: 1 }
    scene.viewBox = bounds
    scene.width = Math.round(bounds.width)
    scene.height = Math.round(bounds.height)
  }
  scene.labels = opts.labels !== false
  scene.theme = theme
  scene.meta = exportIsObject(opts.meta) ? opts.meta : {}
  return scene
}

/**
 * Build a scene from the class tree's expanded display references. Rows follow
 * the reference order (pre-order), columns follow the nesting depth, so the
 * export mirrors exactly the paths the user expanded.
 */
export function buildTreeScene(refs, options) {
  const opts = exportIsObject(options) ? options : {}
  const list = Array.isArray(refs) ? refs : []
  const scene = exportSceneBase('tree', opts.revision, opts.range === 'viewport' ? 'viewport' : 'layout')
  const rowHeight = 22
  const indent = 18
  const positions = new Map()
  const refById = new Map()
  for (let index = 0; index < list.length; index++) {
    const ref = list[index]
    if (!exportIsObject(ref)) continue
    const refId = typeof ref.refId === 'string' ? ref.refId : 'r' + index
    const depth = Math.max(0, exportNumber(ref.depth, 0))
    positions.set(refId, { x: 16 + indent * depth, y: 16 + rowHeight * index })
    refById.set(refId, {
      id: refId,
      x: 16 + indent * depth,
      y: 16 + rowHeight * index,
      label: (ref.cycle ? '\u21ba ' : '') + (ref.label || ref.entityId || ''),
      kind: ref.cycle ? 'cycle' : (ref.kind || 'class'),
    })
  }
  scene.nodes = Array.from(refById.values())
  for (const ref of list) {
    if (!exportIsObject(ref) || typeof ref.parentRefId !== 'string') continue
    const child = refById.get(ref.refId)
    const parent = refById.get(ref.parentRefId)
    if (!child || !parent) continue
    scene.edges.push({
      id: 't' + scene.edges.length,
      x1: parent.x,
      y1: parent.y,
      x2: child.x,
      y2: child.y,
      label: '',
      count: 1,
    })
  }
  const bounds = exportSceneBounds(scene.nodes, 20) || { x: 0, y: 0, width: 1, height: 1 }
  scene.viewBox = bounds
  scene.width = Math.round(bounds.width)
  scene.height = Math.round(bounds.height)
  scene.labels = opts.labels !== false
  scene.theme = exportTheme(opts.theme)
  scene.meta = exportIsObject(opts.meta) ? opts.meta : {}
  return scene
}

/**
 * Build a scene from the layered relation layout.
 */
export function buildLayeredScene(layout, options) {
  const opts = exportIsObject(options) ? options : {}
  const input = exportIsObject(layout) ? layout : {}
  const scene = exportSceneBase('layered', opts.revision, opts.range === 'viewport' ? 'viewport' : 'layout')
  const positions = exportPositions(input.nodes || [])
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  for (let index = 0; index < nodes.length; index++) {
    const entry = nodes[index]
    if (!exportIsObject(entry) || typeof entry.id !== 'string') continue
    const point = positions.get(entry.id)
    if (!point) continue
    scene.nodes.push(exportNode({
      id: entry.id,
      x: point.x,
      y: point.y,
      label: entry.label || entry.id,
      kind: entry.kind,
      groupId: entry.groupId,
      memberCount: entry.memberCount,
    }, index))
  }
  const byNode = new Map(scene.nodes.map((node) => [node.id, node]))
  const edges = Array.isArray(input.edges) ? input.edges : []
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]
    if (!exportIsObject(edge)) continue
    const from = byNode.get(edge.source)
    const to = byNode.get(edge.target)
    if (!from || !to) continue
    scene.edges.push({
      id: typeof edge.id === 'string' ? edge.id : 'le' + index,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      label: exportLabelNode(edge.label, 80),
      count: exportNumber(edge.count, 1),
    })
  }
  const bounds = exportSceneBounds(scene.nodes, 32) || { x: 0, y: 0, width: 1, height: 1 }
  scene.viewBox = bounds
  scene.width = Math.round(bounds.width)
  scene.height = Math.round(bounds.height)
  scene.labels = opts.labels !== false
  scene.theme = exportTheme(opts.theme)
  scene.meta = exportIsObject(opts.meta) ? opts.meta : {}
  return scene
}

/**
 * Read one host theme token. Tokens live on <body> in the live Client (the
 * documentElement carries none), so both roots are probed before the literal
 * fallback is used. `getStyle` is injectable for tests.
 */
export function readHostThemeToken(name, fallback, documentLike, getStyle) {
  try {
    const doc = documentLike || (typeof document === 'undefined' ? null : document)
    const style = typeof getStyle === 'function'
      ? getStyle
      : (typeof getComputedStyle === 'function' ? getComputedStyle : null)
    if (doc && style) {
      for (const root of [doc.body, doc.documentElement]) {
        if (!root) continue
        const value = style(root).getPropertyValue(name)
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    }
  } catch (error) {
    // fall through to the literal fallback
  }
  return fallback
}

/**
 * True when the graph view's displayed-scene report belongs to `graph` and the
 * layout has finished. Object identity matters: a re-rendered but stale report
 * must never be exported as the current view.
 */
export function displayedSceneReady(displayed, graph) {
  return Boolean(displayed && displayed.ready === true && displayed.graph === graph)
}

/** True when the scene is ready to export (finished layout, known revision). */
export function exportSceneReady(scene, currentRevision) {
  if (!exportIsObject(scene)) return { ok: false, reason: 'no-scene' }
  if (!Array.isArray(scene.nodes) || scene.nodes.length === 0) {
    return { ok: false, reason: 'empty-scene' }
  }
  if (typeof currentRevision === 'number' && Number.isFinite(currentRevision) &&
    exportNumber(scene.revision, -1) !== currentRevision) {
    return { ok: false, reason: 'stale-scene' }
  }
  return { ok: true, reason: null }
}

/**
 * Render the scene to a standalone SVG document string.
 *
 * Only static SVG elements are emitted. All text is escaped character data,
 * sizes and coordinates are finite, colors are literal, and no external
 * reference (image, href, CSS import, font) is ever produced.
 */
export function renderSceneSvg(scene) {
  const input = exportIsObject(scene) ? scene : {}
  const viewBox = exportIsObject(input.viewBox) ? input.viewBox : { x: 0, y: 0, width: 1, height: 1 }
  const width = Math.max(1, Math.round(exportNumber(input.width, 1)))
  const height = Math.max(1, Math.round(exportNumber(input.height, 1)))
  const theme = exportTheme(input.theme)
  const labels = input.labels !== false
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  const parts = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    '<svg xmlns="' + SVG_NS + '" width="' + width + '" height="' + height +
    '" viewBox="' + exportNumber(viewBox.x, 0) + ' ' + exportNumber(viewBox.y, 0) + ' ' +
    Math.max(1, exportNumber(viewBox.width, 1)) + ' ' + Math.max(1, exportNumber(viewBox.height, 1)) +
    '" role="img">',
  )
  const view = {
    x: exportNumber(viewBox.x, 0),
    y: exportNumber(viewBox.y, 0),
    width: Math.max(1, exportNumber(viewBox.width, 1)),
    height: Math.max(1, exportNumber(viewBox.height, 1)),
  }
  parts.push(
    '<rect x="' + view.x + '" y="' + view.y + '" width="' + view.width + '" height="' + view.height +
    '" fill="' + theme.background + '"/>',
  )
  const strokeWidth = Math.max(0.5, Math.min(2, view.width / 900))
  for (const edge of edges) {
    if (!exportIsObject(edge)) continue
    parts.push(
      '<line x1="' + exportNumber(edge.x1, 0) + '" y1="' + exportNumber(edge.y1, 0) +
      '" x2="' + exportNumber(edge.x2, 0) + '" y2="' + exportNumber(edge.y2, 0) +
      '" stroke="' + theme.edge + '" stroke-width="' + strokeWidth + '" stroke-opacity="0.7"/>',
    )
  }
  const radius = Math.max(2, Math.min(8, view.width / 220))
  for (const node of nodes) {
    if (!exportIsObject(node)) continue
    const color = node.kind === 'group' ? theme.group : theme.node
    parts.push(
      '<circle cx="' + exportNumber(node.x, 0) + '" cy="' + exportNumber(node.y, 0) +
      '" r="' + radius + '" fill="' + color + '"/>',
    )
    if (labels && typeof node.label === 'string' && node.label) {
      parts.push(
        '<text x="' + exportNumber(node.x, 0) + '" y="' +
        (exportNumber(node.y, 0) - radius - 3) + '" fill="' + theme.nodeText +
        '" font-size="10" font-family="system-ui, sans-serif">' + escapeSvgText(node.label) + '</text>',
      )
    }
  }
  if (labels) {
    for (const edge of edges) {
      if (!exportIsObject(edge) || !edge.label) continue
      const midX = (exportNumber(edge.x1, 0) + exportNumber(edge.x2, 0)) / 2
      const midY = (exportNumber(edge.y1, 0) + exportNumber(edge.y2, 0)) / 2
      parts.push(
        '<text x="' + midX + '" y="' + midY + '" fill="' + theme.edgeText +
        '" font-size="9" font-family="system-ui, sans-serif" text-anchor="middle">' +
        escapeSvgText(edge.label) + '</text>',
      )
    }
  }
  parts.push('</svg>')
  return parts.join('')
}

/**
 * Check the pixel budget before allocating any raster buffer.
 * @returns {{ok: boolean, width: number, height: number, scale: number,
 *            pixels: number, reason: string|null}}
 */
export function planPngExport(scene, options) {
  const input = exportIsObject(scene) ? scene : {}
  const opts = exportIsObject(options) ? options : {}
  const width = Math.max(1, Math.round(exportNumber(input.width, 1)))
  const height = Math.max(1, Math.round(exportNumber(input.height, 1)))
  const allowed = EXPORT_LIMITS.allowedScales
  let scale = exportNumber(opts.scale, EXPORT_LIMITS.defaultScale)
  if (allowed.indexOf(scale) < 0) scale = EXPORT_LIMITS.defaultScale
  const maxPixels = exportNumber(opts.maxPixels, EXPORT_LIMITS.maxPixels)
  const maxSide = exportNumber(opts.maxSide, EXPORT_LIMITS.maxSide)
  const pixelWidth = Math.round(width * scale)
  const pixelHeight = Math.round(height * scale)
  const pixels = pixelWidth * pixelHeight
  if (pixelWidth > maxSide || pixelHeight > maxSide) {
    return {
      ok: false, width: width, height: height, scale: scale,
      pixels: pixels, reason: 'max-side',
    }
  }
  if (pixels > maxPixels) {
    return {
      ok: false, width: width, height: height, scale: scale,
      pixels: pixels, reason: 'max-pixels',
    }
  }
  return { ok: true, width: width, height: height, scale: scale, pixels: pixels, reason: null }
}

/** Resolve the browser primitives needed for rasterization. */
function exportBrowserEnvironment(explicit) {
  if (exportIsObject(explicit)) return explicit
  const env = {}
  try {
    // Client modules can run with a per-module `globalThis` that lacks DOM
    // constructors even though the page owns them; `window` is the browser
    // root the caller actually renders into.
    const root = typeof window !== 'undefined' && window
      ? window
      : (typeof globalThis !== 'undefined' ? globalThis : null)
    if (root) {
      env.Image = root.Image
      env.document = root.document
      env.Blob = root.Blob
      env.URL = root.URL
    }
  } catch (error) {
    // ignore: not a browser
  }
  return env
}

/**
 * Rasterize one safe SVG string to a PNG Blob.
 *
 * The rasterization runs only in the browser through an Image element and a
 * canvas. Every failure (missing APIs, image decode failure, a null Blob, an
 * oversized canvas) returns `{ok:false, reason}` so the caller can offer the
 * SVG export instead; it never falls back to a server.
 */
export async function rasterizePng(svg, plan, environment) {
  const env = exportBrowserEnvironment(environment)
  const deps = exportIsObject(env) ? env : {}
  if (!plan || plan.ok !== true) {
    return { ok: false, reason: plan && plan.reason ? plan.reason : 'budget' }
  }
  if (typeof svg !== 'string' || svg === '') return { ok: false, reason: 'no-svg' }
  const hasImage = typeof deps.Image === 'function'
  const hasBlob = typeof deps.Blob === 'function'
  const URLImpl = deps.URL
  const hasUrl = (typeof URLImpl === 'object' || typeof URLImpl === 'function') && URLImpl !== null &&
    typeof URLImpl.createObjectURL === 'function' && typeof URLImpl.revokeObjectURL === 'function'
  if (!hasImage || !hasBlob || !hasUrl || !deps.document) {
    return { ok: false, reason: 'unavailable' }
  }
  let canvas = null
  let image = null
  try {
    const blob = new deps.Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URLImpl.createObjectURL(blob)
    try {
      image = await new Promise((resolve, reject) => {
        image = new deps.Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('image decode failed'))
        image.src = url
      })
      canvas = deps.document.createElement('canvas')
      canvas.width = plan.width * plan.scale
      canvas.height = plan.height * plan.scale
      const context = canvas.getContext && canvas.getContext('2d')
      if (!context) return { ok: false, reason: 'no-canvas-context' }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise((resolve) => {
        if (typeof canvas.toBlob !== 'function') {
          resolve(null)
          return
        }
        canvas.toBlob((value) => resolve(value || null), 'image/png')
      })
      if (!png) return { ok: false, reason: 'to-blob-failed' }
      return { ok: true, blob: png, width: canvas.width, height: canvas.height }
    } finally {
      URLImpl.revokeObjectURL(url)
    }
  } catch (error) {
    return {
      ok: false,
      reason: error && error.message ? String(error.message) : 'rasterize-failed',
    }
  } finally {
    if (image) {
      image.onload = null
      image.onerror = null
      image.src = ''
    }
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    image = null
    canvas = null
  }
}

/** Theme tokens for an export, resolved from computed style values. */
export function exportThemeFromTokens(readToken) {
  const read = (name, fallback) => {
    try {
      if (typeof readToken === 'function') {
        const value = readToken(name)
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
    } catch (error) {
      // fall through to the fallback
    }
    return fallback
  }
  return {
    background: safeSvgColor(read('--dsw-alias-bg-layer-1', FALLBACK_THEME.background), FALLBACK_THEME.background),
    node: safeSvgColor(read('--dsw-alias-brand-primary', FALLBACK_THEME.node), FALLBACK_THEME.node),
    nodeText: safeSvgColor(read('--dsw-alias-label-primary', FALLBACK_THEME.nodeText), FALLBACK_THEME.nodeText),
    edge: safeSvgColor(read('--dsw-alias-border-l1', FALLBACK_THEME.edge), FALLBACK_THEME.edge),
    edgeText: safeSvgColor(read('--dsw-alias-label-secondary', FALLBACK_THEME.edgeText), FALLBACK_THEME.edgeText),
    group: safeSvgColor(read('--dsw-alias-brand-primary', FALLBACK_THEME.group), FALLBACK_THEME.group),
  }
}
