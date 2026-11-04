/**
 * Interactive SVG view for the ontology graph.
 *
 * The host Client bundle concatenates this file inside one closure and passes
 * React in, so there are deliberately no imports and no JSX: every element is
 * built with React.createElement. The model helpers (layoutGraph, shortenIri,
 * matchNodes, subgraph, neighborhood) live in src/graph-model.js and are in
 * scope through the same closure.
 *
 * The component owns presentation state only (zoom, pan, selection, hover,
 * search). Parsing and truncation belong to the caller; `graph` is already a
 * Graph from buildGraph.
 */

/**
 * @param {any} React the host React 18 module
 * @returns {{ OntologyGraphView: function }}
 */
export function createOntologyGraphView(React) {
  const h = React.createElement
  const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

  const MIN_ZOOM = 0.15
  const MAX_ZOOM = 4
  const DEFAULT_SIZE = { width: 900, height: 600 }
  const LABEL_NODE_LIMIT = 260
  const LABEL_ZOOM = 0.8
  const NARROW_WIDTH = 640
  const FIT_PADDING = 30
  const SEARCH_LIMIT = 500

  const EMPTY_STATS = { triples: 0, nodes: 0, edges: 0, literals: 0, classes: 0, properties: 0, individuals: 0, blanks: 0, droppedNodes: 0 }
  const EMPTY_GRAPH = { nodes: [], edges: [], stats: EMPTY_STATS, warnings: [] }
  const KIND_LABELS = { class: '类', property: '属性', individual: '个体', blank: '空白节点', external: '外部引用' }

  let gridSequence = 0
  // --- small pure helpers ---------------------------------------------------
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function count(stats, key, fallback) {
    return typeof stats[key] === 'number' && Number.isFinite(stats[key]) ? stats[key] : fallback
  }

  function truncateText(value, maximum) {
    const text = typeof value === 'string' ? value : String(value === undefined || value === null ? '' : value)
    if (text.length <= maximum) return text
    return text.slice(0, Math.max(1, maximum - 1)) + '…'
  }

  function nodeRadius(degree) {
    return clamp(4 + Math.sqrt(Math.max(0, asNumber(degree, 0))) * 1.7, 4, 11)
  }

  function selfLoopPath(x, y, radius) {
    const lift = Math.max(16, radius * 2.6)
    return 'M ' + (x + radius * 0.65) + ' ' + (y - radius * 0.65) +
      ' C ' + (x + lift) + ' ' + (y - lift) + ', ' + (x - lift) + ' ' + (y - lift) +
      ', ' + (x - radius * 0.65) + ' ' + (y - radius * 0.65)
  }

  /** Fit an array of graph-space points into the viewport, returning zoom + pan. */
  function fitView(points, width, height, padding) {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
    for (const point of points) {
      if (!point) continue
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { zoom: 1, pan: { x: 0, y: 0 } }
    const pad = Math.min(asNumber(padding, FIT_PADDING), Math.min(width, height) * 0.4)
    const spanX = Math.max(0, maxX - minX)
    const spanY = Math.max(0, maxY - minY)
    const availableWidth = Math.max(1, width - pad * 2)
    const availableHeight = Math.max(1, height - pad * 2)
    const zoomX = spanX > 0.5 ? availableWidth / spanX : MAX_ZOOM
    const zoomY = spanY > 0.5 ? availableHeight / spanY : MAX_ZOOM
    const zoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, 1.6)
    const pan = { x: width / 2 - ((minX + maxX) / 2) * zoom, y: height / 2 - ((minY + maxY) / 2) * zoom }
    if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) return { zoom: 1, pan: { x: 0, y: 0 } }
    return { zoom, pan }
  }

  /** Validate the incoming graph and never let a malformed shape reach render. */
  function normalizeGraph(graph) {
    if (!graph || typeof graph !== 'object') return EMPTY_GRAPH
    const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
    const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
    const nodes = rawNodes.filter((node) => node && typeof node.id === 'string')
    const edges = rawEdges.filter((edge) =>
      edge && typeof edge.source === 'string' && typeof edge.target === 'string')
    const stats = graph.stats && typeof graph.stats === 'object' ? graph.stats : EMPTY_STATS
    const warnings = Array.isArray(graph.warnings) ? graph.warnings : []
    if (nodes === rawNodes && edges === rawEdges && stats === graph.stats && warnings === graph.warnings) return graph
    return { nodes, edges, stats, warnings }
  }

  // -------------------------------------------------------------------------
  // Styles: one <style> child in the root; every class is dov- prefixed and
  // every colour comes from a host token (with a literal fallback).
  // -------------------------------------------------------------------------

  const CSS = `
.dov-root { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; line-height: 1.45; }  .dov-header { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); }
.dov-source { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-weight: 600; }  .dov-stats { display: flex; align-items: center; gap: 8px; white-space: nowrap; color: var(--dsw-alias-label-tertiary, #8b9096); font-variant-numeric: tabular-nums; }
.dov-stat b { color: var(--dsw-alias-label-secondary, #57606a); font-weight: 600; }  .dov-spacer { flex: 1 1 20px; }
.dov-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }  .dov-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; padding: 0 9px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; }
.dov-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); color: var(--dsw-alias-label-primary, #1f2328); }  .dov-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .08)); }
.dov-btn[aria-pressed="true"] { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 10%, transparent); }  .dov-btn:disabled { opacity: .4; cursor: default; }
.dov-btn--icon { width: 26px; padding: 0; font-size: 15px; }  .dov-zoom { min-width: 40px; text-align: center; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; font-variant-numeric: tabular-nums; }
.dov-badge { flex: none; border-radius: 999px; padding: 1px 7px; font-size: 10px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-bg-layer-1, #ffffff); }  .dov-badge--warn { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 8%, transparent); }
.dov-search { box-sizing: border-box; display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 6px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); }  .dov-search:focus-within { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 55%, transparent); }
.dov-search-input { width: 132px; height: 24px; border: 0; outline: none; background: transparent; color: var(--dsw-alias-label-primary, #1f2328); font: inherit; font-size: 12px; }  .dov-search-input::placeholder { color: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-search-count { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }  .dov-search-count--none { opacity: .7; }
.dov-search-clear { border: 0; padding: 0 2px; background: transparent; color: var(--dsw-alias-label-tertiary, #8b9096); font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }  .dov-issues { flex: none; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 5%, var(--dsw-alias-bg-layer-1, #ffffff)); }
.dov-issues-toggle { display: flex; width: 100%; align-items: center; gap: 6px; padding: 5px 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }  .dov-issues-list { max-height: 120px; overflow: auto; margin: 0; padding: 0 10px 8px 26px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; }
.dov-issues-list li { margin: 2px 0; overflow-wrap: anywhere; }  .dov-body { flex: 1; min-height: 0; display: flex; position: relative; }
.dov-canvas { flex: 1; min-height: 0; position: relative; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #ffffff); }  .dov-svg { display: block; width: 100%; height: 100%; user-select: none; touch-action: none; cursor: grab; outline: none; }
.dov-svg[data-drag="pan"], .dov-svg[data-drag="node"] { cursor: grabbing; }  .dov-svg:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 55%, transparent); outline-offset: -2px; }
.dov-backdrop { pointer-events: none; }  .dov-grid-line { fill: none; stroke: var(--dsw-alias-border-l1, #e5e7eb); stroke-width: .6; opacity: .65; }
.dov-edge { fill: none; stroke: var(--dsw-alias-border-l2, #cfd4da); stroke-width: 1; stroke-linecap: round; opacity: .9; vector-effect: non-scaling-stroke; transition: opacity .12s ease, stroke .12s ease; }  .dov-edge--type { stroke-dasharray: 3 3; }
.dov-edge--subclass { stroke-dasharray: 7 3; }  .dov-edge--blank { stroke-dasharray: 1 3.2; }
.dov-edge.dov-is-active { stroke: var(--dsw-alias-brand-primary, #4d6bfe); opacity: 1; }  .dov-edge.dov-is-dim { opacity: .1; }
.dov-edge-label { fill: var(--dsw-alias-label-tertiary, #8b9096); font-size: 9px; pointer-events: none; paint-order: stroke; stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 3px; stroke-linejoin: round; }  .dov-node { cursor: pointer; transition: opacity .12s ease; }
.dov-node.dov-is-dim { opacity: .13; }  .dov-node-hit { fill: transparent; }
.dov-node-dot { stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 1.5; }  .dov-node-halo { fill: none; stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 1.5; opacity: .5; pointer-events: none; }
.dov-node--class .dov-node-dot { fill: var(--dsw-alias-brand-primary, #4d6bfe); }  .dov-node--property .dov-node-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-bg-layer-1, #ffffff)); }
.dov-node--individual .dov-node-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 30%, var(--dsw-alias-bg-layer-1, #ffffff)); }  .dov-node--blank .dov-node-dot { fill: var(--dsw-alias-bg-layer-2, #f7f8fa); stroke: var(--dsw-alias-label-tertiary, #8b9096); stroke-dasharray: 2 1.5; }
.dov-node--external .dov-node-dot { fill: var(--dsw-alias-label-tertiary, #8b9096); }  .dov-node.dov-is-active .dov-node-dot { stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 2; }
.dov-node.dov-is-selected .dov-node-halo { opacity: 1; stroke-width: 2; }  .dov-node.dov-is-match .dov-node-halo { opacity: .85; stroke-dasharray: 2 2; }
.dov-node-label { fill: var(--dsw-alias-label-secondary, #57606a); font-size: 10px; pointer-events: none; paint-order: stroke; stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 3px; stroke-linejoin: round; }  .dov-node.dov-is-selected .dov-node-label, .dov-node.dov-is-hovered .dov-node-label { fill: var(--dsw-alias-label-primary, #1f2328); font-weight: 600; }
.dov-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; pointer-events: none; }  .dov-empty-icon { width: 56px; height: 56px; color: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-empty-icon circle { fill: var(--dsw-alias-bg-layer-2, #f7f8fa); stroke: currentColor; stroke-width: 1.5; }  .dov-empty-icon line { stroke: currentColor; stroke-width: 1.5; }
.dov-empty-title { color: var(--dsw-alias-label-secondary, #57606a); font-size: 13px; font-weight: 600; }  .dov-empty-hint { max-width: 320px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-canvas-hint { position: absolute; left: 10px; bottom: 8px; max-width: calc(100% - 20px); padding: 2px 6px; border-radius: 4px; pointer-events: none; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 78%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }  .dov-canvas-badge { position: absolute; left: 10px; top: 10px; padding: 3px 9px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l1, #e5e7eb); pointer-events: none; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 86%, transparent); }
.dov-panel { flex: 0 0 300px; width: 300px; min-width: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-layer-2, #f7f8fa); border-left: .5px solid var(--dsw-alias-border-l1, #e5e7eb); }  .dov-panel-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dov-panel-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-weight: 600; }  .dov-panel-body { flex: 1; min-height: 0; overflow: auto; padding-bottom: 12px; }
.dov-section { padding: 10px 10px 0; }  .dov-section-title { margin-bottom: 5px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
.dov-iri-row { display: flex; align-items: flex-start; gap: 6px; }  .dov-iri { flex: 1; min-width: 0; color: var(--dsw-alias-label-primary, #1f2328); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; user-select: text; }
.dov-copy { flex: none; height: 22px; padding: 0 7px; border-radius: 5px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; cursor: pointer; }  .dov-copy:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dov-copy:disabled { opacity: .45; cursor: default; }  .dov-types { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.dov-type { max-width: 100%; border: 0; padding: 1px 0; background: transparent; color: var(--dsw-alias-brand-primary, #4d6bfe); font: inherit; font-size: 11px; text-align: left; overflow-wrap: anywhere; cursor: pointer; }  .dov-type:hover { text-decoration: underline; }
.dov-type--plain { color: var(--dsw-alias-label-secondary, #57606a); cursor: default; text-decoration: none; }  .dov-chip { flex: none; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 999px; padding: 0 6px; color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-bg-layer-1, #ffffff); font-size: 10px; line-height: 16px; }
.dov-chip--class { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 42%, transparent); }  .dov-literals { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dov-literals td { padding: 4px 0; border-top: .5px solid var(--dsw-alias-border-l1, #e5e7eb); vertical-align: top; font-size: 11px; overflow-wrap: anywhere; }  .dov-literals tr:first-child td { border-top: 0; }
.dov-lit-p { width: 38%; padding-right: 8px; color: var(--dsw-alias-label-tertiary, #8b9096); }  .dov-lit-v { color: var(--dsw-alias-label-primary, #1f2328); }
.dov-lit-meta { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }  .dov-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.dov-count { padding: 6px; border: .5px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); text-align: center; }  .dov-count b { display: block; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-variant-numeric: tabular-nums; }
.dov-count span { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }  .dov-muted { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-scrim { position: absolute; inset: 0; z-index: 3; border: 0; padding: 0; background: color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 20%, transparent); }  .dov-root--narrow .dov-source { max-width: 150px; }
.dov-root--narrow .dov-search-input { width: 96px; }  .dov-root--narrow .dov-canvas-hint { display: none; }
.dov-root--narrow .dov-panel { position: absolute; top: 0; right: 0; bottom: 0; z-index: 4; width: min(300px, calc(100% - 32px)); box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 24%, transparent); }  @media (prefers-reduced-motion: reduce) { .dov-node, .dov-edge { transition: none; } }
`

  // -------------------------------------------------------------------------
  // Component
  // -------------------------------------------------------------------------

  function OntologyGraphView(props) {
    const options = props || {}
    const { graph, t, sourceName, issues, truncated } = options
    const safeGraph = useMemo(() => normalizeGraph(graph), [graph])
    const isEmpty = safeGraph.nodes.length === 0
    // --- presentation state -------------------------------------------------
    const [size, setSize] = useState(DEFAULT_SIZE)
    const [layoutSeed, setLayoutSeed] = useState(1)
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [selectedId, setSelectedId] = useState(null)
    const [hoverId, setHoverId] = useState(null)
    const [query, setQuery] = useState('')
    const [labelsOn, setLabelsOn] = useState(true)
    const [focusOn, setFocusOn] = useState(false)
    const [panelOpen, setPanelOpen] = useState(true)
    const [issuesOpen, setIssuesOpen] = useState(false)
    const [copyState, setCopyState] = useState('idle')
    const [overrides, setOverrides] = useState({})
    const [dragKind, setDragKind] = useState(null)
    const canvasRef = useRef(null)
    const svgRef = useRef(null)
    const zoomRef = useRef(1)
    const panRef = useRef({ x: 0, y: 0 })
    const hoverRef = useRef(null)
    const dragRef = useRef(null)
    const pendingOverrideRef = useRef(null)
    const overrideFrameRef = useRef(0)
    const copyTimerRef = useRef(0)
    const gridIdRef = useRef(null)
    const fitStateRef = useRef({ graph: null, seed: 0, measured: false })
    if (gridIdRef.current === null) {
      gridSequence += 1
      gridIdRef.current = 'dov-grid-' + String(gridSequence)
    }
    const gridId = gridIdRef.current
    const narrow = size.width < NARROW_WIDTH
    // --- i18n helper --------------------------------------------------------
    const tr = (key, fallback) => {
      try {
        const value = typeof t === 'function' ? t(key, fallback) : undefined
        return typeof value === 'string' && value.length > 0 ? value : fallback
      } catch (error) {
        return fallback
      }
    }
    // --- derived structures (memoized, never recomputed on selection) ------
    const nodesById = useMemo(() => new Map(safeGraph.nodes.map((node) => [node.id, node])), [safeGraph])
    const adjacency = useMemo(() => {
      const map = new Map(safeGraph.nodes.map((node) => [node.id, []]))
      for (const edge of safeGraph.edges) {
        if (edge.source === edge.target) continue
        const from = map.get(edge.source)
        const to = map.get(edge.target)
        if (from) from.push(edge.target)
        if (to) to.push(edge.source)
      }
      return map
    }, [safeGraph])

    // Layout only depends on the graph, the measured size and the seed. Hover
    // and selection changes must never trigger a new layout.
    const layout = useMemo(() => layoutGraph(safeGraph, {
      width: size.width, height: size.height, iterations: 320, seed: layoutSeed, padding: 28,
    }), [safeGraph, size.width, size.height, layoutSeed])

    const positionById = useMemo(() => {
      const map = new Map()
      for (const point of layout) map.set(point.id, overrides[point.id] || { x: point.x, y: point.y })
      return map
    }, [layout, overrides])

    const pointList = useMemo(() => safeGraph.nodes
      .map((node) => positionById.get(node.id))
      .filter(Boolean), [safeGraph.nodes, positionById])

    const display = useMemo(() => {
      if (!focusOn || !selectedId || !nodesById.has(selectedId)) return safeGraph
      return subgraph(safeGraph, neighborhood(safeGraph, selectedId, 1))
    }, [safeGraph, focusOn, selectedId, nodesById])

    const matches = useMemo(() => matchNodes(safeGraph, query, SEARCH_LIMIT), [safeGraph, query])
    const matchSet = useMemo(() => new Set(matches), [matches])
    const searchActive = query.trim().length > 0
    const selectedNode = selectedId ? nodesById.get(selectedId) || null : null
    const activeId = hoverId && nodesById.has(hoverId) ? hoverId : (selectedNode ? selectedId : null)

    const activeSet = useMemo(() => {
      if (!activeId) return null
      return new Set([activeId].concat(adjacency.get(activeId) || []))
    }, [activeId, adjacency])

    const showNodeLabels = labelsOn && (display.nodes.length < LABEL_NODE_LIMIT || zoom >= LABEL_ZOOM)

    const issuesList = useMemo(() => {
      const fromProps = Array.isArray(issues) ? issues : []
      return fromProps.concat(safeGraph.warnings)
        .filter((message) => typeof message === 'string' && message.trim())
    }, [issues, safeGraph])

    const typeLabel = (kind) => tr('viewer.kind.' + kind, KIND_LABELS[kind] || kind || 'individual')
    // --- refs that mirror state for native listeners ------------------------
    useEffect(() => { zoomRef.current = zoom }, [zoom])
    useEffect(() => { panRef.current = pan }, [pan])
    useEffect(() => { hoverRef.current = hoverId }, [hoverId])
    // --- measure the canvas (ResizeObserver + debounce) ---------------------
    useLayoutEffect(() => {
      const element = canvasRef.current
      if (!element) return undefined
      let timer = 0
      const read = () => {
        const width = Math.round(element.clientWidth || 0)
        const height = Math.round(element.clientHeight || 0)
        if (width <= 0 || height <= 0) return
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height })
      }
      read()
      if (typeof ResizeObserver === 'undefined') return undefined
      const observer = new ResizeObserver(() => {
        clearTimeout(timer)
        timer = setTimeout(read, 120)
      })
      observer.observe(element)
      return () => {
        clearTimeout(timer)
        observer.disconnect()
      }
    }, [])
    // --- reset derived UI state when the layout changes ---------------------
    useEffect(() => {
      setOverrides((previous) => (Object.keys(previous).length === 0 ? previous : {}))
    }, [layout])

    useEffect(() => {
      if (selectedId && !nodesById.has(selectedId)) setSelectedId(null)
      if (hoverId && !nodesById.has(hoverId)) setHoverId(null)
    }, [nodesById, selectedId, hoverId])

    useEffect(() => {
      setCopyState('idle')
    }, [selectedId])

    useEffect(() => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      if (overrideFrameRef.current && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(overrideFrameRef.current)
      }
    }, [])
    // --- fit the layout into the viewport -----------------------------------
    const applyView = useCallback((nextZoom, nextPan) => {
      if (!Number.isFinite(nextZoom) || !Number.isFinite(nextPan.x) || !Number.isFinite(nextPan.y)) return
      zoomRef.current = nextZoom
      panRef.current = nextPan
      setZoom(nextZoom)
      setPan(nextPan)
    }, [])

    const fitPoints = useCallback((points) => {
      if (!points || points.length === 0) return
      const view = fitView(points, size.width, size.height, FIT_PADDING)
      applyView(view.zoom, view.pan)
    }, [applyView, size.width, size.height])

    useEffect(() => {
      if (layout.length === 0) return
      // Refit for a new graph/seed and the first truly measured size; later size changes keep the view.
      const fitted = fitStateRef.current
      const canvas = canvasRef.current
      const measured = Boolean(canvas) && Math.round(canvas.clientWidth) === size.width &&
        Math.round(canvas.clientHeight) === size.height
      const firstMeasured = measured && !fitted.measured
      if (fitted.graph === safeGraph && fitted.seed === layoutSeed && !firstMeasured) return
      fitted.graph = safeGraph
      fitted.seed = layoutSeed
      fitted.measured = measured
      const view = fitView(layout, size.width, size.height, FIT_PADDING)
      applyView(view.zoom, view.pan)
    }, [layout, safeGraph, layoutSeed, size.width, size.height, applyView])
    // --- zoom helpers -------------------------------------------------------
    const applyZoomAt = useCallback((nextZoom, cursorX, cursorY) => {
      const previous = zoomRef.current
      const target = clamp(asNumber(nextZoom, previous), MIN_ZOOM, MAX_ZOOM)
      if (Math.abs(target - previous) < 1e-9) return
      const currentPan = panRef.current
      const ratio = target / previous
      const nextPan = {
        x: cursorX - (cursorX - currentPan.x) * ratio,
        y: cursorY - (cursorY - currentPan.y) * ratio,
      }
      if (!Number.isFinite(nextPan.x) || !Number.isFinite(nextPan.y)) return
      zoomRef.current = target
      panRef.current = nextPan
      setZoom(target)
      setPan(nextPan)
    }, [])

    const zoomBy = useCallback((factor) => {
      applyZoomAt(zoomRef.current * factor, size.width / 2, size.height / 2)
    }, [applyZoomAt, size.width, size.height])

    // Native wheel listener so preventDefault actually stops the host scrollport.
    useEffect(() => {
      const svg = svgRef.current
      if (!svg || typeof svg.addEventListener !== 'function') return undefined
      const onWheel = (event) => {
        event.preventDefault()
        const bounds = svg.getBoundingClientRect()
        const scaleX = bounds.width > 0 ? size.width / bounds.width : 1
        const scaleY = bounds.height > 0 ? size.height / bounds.height : 1
        const cursorX = (event.clientX - bounds.left) * scaleX
        const cursorY = (event.clientY - bounds.top) * scaleY
        const mode = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1
        const delta = clamp(event.deltaY * mode, -120, 120)
        applyZoomAt(zoomRef.current * Math.exp(-delta * 0.0018), cursorX, cursorY)
      }
      svg.addEventListener('wheel', onWheel, { passive: false })
      return () => svg.removeEventListener('wheel', onWheel)
    }, [applyZoomAt, size.width, size.height])

    const centerOn = useCallback((id, requestedZoom) => {
      const point = positionById.get(id)
      if (!point) return
      const target = clamp(asNumber(requestedZoom, Math.max(zoomRef.current, 1.3)), MIN_ZOOM, MAX_ZOOM)
      applyView(target, {
        x: size.width / 2 - point.x * target,
        y: size.height / 2 - point.y * target,
      })
    }, [positionById, size.width, size.height, applyView])

    const selectNode = useCallback((id) => {
      setSelectedId(id)
      setPanelOpen(true)
    }, [])

    const selectAndCenter = useCallback((id) => {
      if (!nodesById.has(id)) return
      setSelectedId(id)
      setPanelOpen(true)
      centerOn(id, Math.max(zoomRef.current, 1.2))
    }, [nodesById, centerOn])

    const jumpToFirstMatch = useCallback(() => {
      const first = matches[0]
      if (!first) return
      setSelectedId(first)
      setPanelOpen(true)
      centerOn(first, Math.max(zoomRef.current, 1.4))
    }, [matches, centerOn])
    // --- copy IRI -----------------------------------------------------------
    const scheduleCopyReset = useCallback(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopyState('idle'), 1600)
    }, [])

    const copyIri = useCallback(() => {
      const text = selectedNode && typeof selectedNode.iri === 'string' ? selectedNode.iri : ''
      if (!text) return
      let pending = null
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard &&
            typeof navigator.clipboard.writeText === 'function') {
          pending = navigator.clipboard.writeText(text)
        }
      } catch (error) {
        pending = null
      }
      if (!pending || typeof pending.then !== 'function') {
        setCopyState('failed')
        scheduleCopyReset()
        return
      }
      pending.then(
        () => { setCopyState('copied'); scheduleCopyReset() },
        () => { setCopyState('failed'); scheduleCopyReset() },
      )
    }, [selectedNode, scheduleCopyReset])
    // --- pointer interaction ------------------------------------------------
    const queueOverride = useCallback((id, x, y) => {
      if (typeof requestAnimationFrame !== 'function') {
        setOverrides((previous) => ({ ...previous, [id]: { x, y } }))
        return
      }
      pendingOverrideRef.current = { id, x, y }
      if (overrideFrameRef.current) return
      overrideFrameRef.current = requestAnimationFrame(() => {
        overrideFrameRef.current = 0
        const pending = pendingOverrideRef.current
        pendingOverrideRef.current = null
        if (pending) {
          setOverrides((previous) => ({ ...previous, [pending.id]: { x: pending.x, y: pending.y } }))
        }
      })
    }, [])

    const nodeIdFromEvent = (event) => {
      const target = event && event.target
      if (!target || typeof target.closest !== 'function') return null
      const element = target.closest('[data-dov-node]')
      if (!element) return null
      const id = element.getAttribute('data-dov-node')
      return id && nodesById.has(id) ? id : null
    }

    const updateHover = (event) => {
      const id = nodeIdFromEvent(event)
      if (id === hoverRef.current) return
      hoverRef.current = id
      setHoverId(id)
    }

    const handlePointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const svg = svgRef.current
      if (!svg) return
      const id = nodeIdFromEvent(event)
      const point = id ? positionById.get(id) : null
      if (id && !point) return
      dragRef.current = {
        pointerId: event.pointerId,
        nodeId: id,
        moved: false,
        startClientX: event.clientX,
        startClientY: event.clientY,
        nodeStartX: point ? point.x : 0,
        nodeStartY: point ? point.y : 0,
        panStartX: panRef.current.x,
        panStartY: panRef.current.y,
      }
      setDragKind(id ? 'node' : 'pan')
      if (id && hoverRef.current !== id) {
        hoverRef.current = id
        setHoverId(id)
      }
      try {
        svg.setPointerCapture(event.pointerId)
      } catch (error) {
        // Pointer capture is best effort; dragging still works without it.
      }
      event.preventDefault()
    }

    const handlePointerMove = (event) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) {
        updateHover(event)
        return
      }
      const deltaX = event.clientX - drag.startClientX
      const deltaY = event.clientY - drag.startClientY
      if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) drag.moved = true
      if (!drag.moved) return
      if (drag.nodeId) {
        const currentZoom = zoomRef.current || 1
        const x = clamp(drag.nodeStartX + deltaX / currentZoom, 8, Math.max(8, size.width - 8))
        const y = clamp(drag.nodeStartY + deltaY / currentZoom, 8, Math.max(8, size.height - 8))
        queueOverride(drag.nodeId, x, y)
        return
      }
      const nextPan = { x: drag.panStartX + deltaX, y: drag.panStartY + deltaY }
      if (!Number.isFinite(nextPan.x) || !Number.isFinite(nextPan.y)) return
      panRef.current = nextPan
      setPan(nextPan)
    }

    const handlePointerUp = (event) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragKind(null)
      const svg = svgRef.current
      if (svg && typeof svg.releasePointerCapture === 'function') {
        try {
          if (svg.hasPointerCapture && svg.hasPointerCapture(event.pointerId)) {
            svg.releasePointerCapture(event.pointerId)
          }
        } catch (error) {
          // ignore capture-release races
        }
      }
      if (drag.moved) return
      setSelectedId(drag.nodeId || null)
      setPanelOpen(Boolean(drag.nodeId))
    }

    const handlePointerLeave = () => {
      if (dragRef.current) return
      hoverRef.current = null
      setHoverId(null)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (searchActive) setQuery('')
        else setSelectedId(null)
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(1.25)
      } else if (event.key === '-') {
        event.preventDefault()
        zoomBy(0.8)
      } else if (event.key === '0' || event.key.toLowerCase() === 'f') {
        event.preventDefault()
        fitPoints(pointList)
      }
    }

    const handleSearchKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        jumpToFirstMatch()
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        setQuery('')
        if (event.currentTarget && typeof event.currentTarget.blur === 'function') event.currentTarget.blur()
      }
    }

    const relayout = () => {
      setOverrides((previous) => (Object.keys(previous).length === 0 ? previous : {}))
      setLayoutSeed((seed) => seed + 1)
    }

    const toggleFocus = () => {
      if (!selectedNode) return
      setFocusOn((value) => !value)
    }
    // --- header -------------------------------------------------------------
    const stats = safeGraph.stats && typeof safeGraph.stats === 'object' ? safeGraph.stats : EMPTY_STATS
    const nodeCount = count(stats, 'nodes', safeGraph.nodes.length)
    const edgeCount = count(stats, 'edges', safeGraph.edges.length)
    const tripleCount = count(stats, 'triples', 0)
    const action = (key, label, onClick, extra) => h('button', {
      key,
      type: 'button',
      onClick,
      className: 'dov-btn' + (extra && extra.icon ? ' dov-btn--icon' : ''),
      disabled: extra && extra.disabled ? true : undefined,
      'aria-pressed': extra && extra.pressed !== undefined ? extra.pressed : undefined,
      title: extra && extra.title,
      'aria-label': extra && extra.title,
    }, label)

    const header = h('header', { key: 'header', className: 'dov-header' },
      h('span', { key: 'source', className: 'dov-source', title: typeof sourceName === 'string' ? sourceName : '' },
        typeof sourceName === 'string' && sourceName ? sourceName : tr('viewer.untitled', '未命名')),
      truncated ? h('span', { key: 'truncated', className: 'dov-badge dov-badge--warn' },
        tr('viewer.truncated', '输入已截断')) : null,
      h('div', { key: 'stats', className: 'dov-stats' },
        [['nodes', nodeCount, '节点'], ['edges', edgeCount, '边'], ['triples', tripleCount, '三元组']]
          .map(([statKey, value, fallback]) => h('span', { key: statKey, className: 'dov-stat' },
            h('b', null, String(value)), ' ', tr('viewer.' + statKey, fallback)))),
      h('div', { key: 'spacer', className: 'dov-spacer' }),
      h('div', { key: 'actions', className: 'dov-actions' },
        h('div', { key: 'search', className: 'dov-search' },
          h('input', {
            className: 'dov-search-input',
            type: 'text',
            value: query,
            placeholder: tr('viewer.searchPlaceholder', '搜索标签或 IRI'),
            'aria-label': tr('viewer.searchPlaceholder', '搜索标签或 IRI'),
            spellCheck: false,
            disabled: isEmpty,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: handleSearchKeyDown,
          }),
          searchActive ? h('span', {
            key: 'count',
            className: 'dov-search-count' + (matches.length === 0 ? ' dov-search-count--none' : ''),
          }, tr('viewer.results', '{n} 个结果').replace('{n}', String(matches.length))) : null,
          searchActive ? h('button', {
            key: 'clear',
            type: 'button',
            className: 'dov-search-clear',
            title: tr('viewer.clearSearch', '清除搜索'),
            'aria-label': tr('viewer.clearSearch', '清除搜索'),
            onClick: () => setQuery(''),
          }, '×') : null),
        action('labels', tr('viewer.labels', '标签'), () => setLabelsOn((value) => !value),
          { pressed: labelsOn, disabled: isEmpty }),
        action('focus', tr('viewer.focus', '只看选中节点周围'), toggleFocus,
          { pressed: focusOn && Boolean(selectedNode), disabled: !selectedNode }),
        action('relayout', '↻ ' + tr('viewer.relayout', '重新布局'), relayout, { disabled: isEmpty }),
        action('zoom-out', '−', () => zoomBy(0.8),
          { icon: true, disabled: isEmpty, title: tr('viewer.zoomOut', '缩小') }),
        h('span', { key: 'zoom', className: 'dov-zoom', 'aria-live': 'polite' }, Math.round(zoom * 100) + '%'),
        action('zoom-in', '+', () => zoomBy(1.25),
          { icon: true, disabled: isEmpty, title: tr('viewer.zoomIn', '放大') }),
        action('fit', tr('viewer.fit', '适配视图'), () => fitPoints(pointList), { disabled: isEmpty }),
        selectedNode ? action('details', tr('viewer.details', '详情'),
          () => setPanelOpen((value) => !value), { pressed: panelOpen }) : null))
    // --- issues banner ------------------------------------------------------
    const issuesBanner = issuesList.length === 0 ? null : h('div', { key: 'issues', className: 'dov-issues' },
      h('button', {
        type: 'button',
        className: 'dov-issues-toggle',
        'aria-expanded': issuesOpen,
        onClick: () => setIssuesOpen((value) => !value),
      },
        h('span', { 'aria-hidden': 'true' }, issuesOpen ? '▾' : '▸'),
        h('span', null, tr('viewer.issues', '解析提示') + ' (' + String(issuesList.length) + ')')),
      issuesOpen ? h('ul', { className: 'dov-issues-list' },
        issuesList.map((message, index) => h('li', { key: 'issue-' + String(index) }, message))) : null)
    // --- SVG scene ----------------------------------------------------------
    const edgeElements = []
    const edgeLabelElements = []
    for (const edge of display.edges) {
      const source = positionById.get(edge.source)
      const target = positionById.get(edge.target)
      if (!source || !target) continue
      const isActive = Boolean(activeId) && (edge.source === activeId || edge.target === activeId)
      const isDimmed = Boolean(activeId) && !isActive
      const classes = ['dov-edge', 'dov-edge--' + (edge.kind || 'object')]
      if (isActive) classes.push('dov-is-active')
      if (isDimmed) classes.push('dov-is-dim')
      const count = Math.max(1, asNumber(edge.count, 1))
      const width = 0.9 + Math.min(1.4, Math.log(count + 1) * 0.45)
      const radius = nodeRadius(nodesById.get(edge.source) && nodesById.get(edge.source).degree)
      if (edge.source === edge.target) {
        edgeElements.push(h('path', {
          key: edge.id,
          className: classes.join(' '),
          d: selfLoopPath(source.x, source.y, radius),
          style: { strokeWidth: width },
        }))
      } else {
        edgeElements.push(h('line', {
          key: edge.id,
          className: classes.join(' '),
          x1: source.x,
          y1: source.y,
          x2: target.x,
          y2: target.y,
          style: { strokeWidth: width },
        }))
      }

      // Edge labels only for the hovered/selected node's incident edges.
      if (isActive && edge.label) {
        const loop = edge.source === edge.target
        const midX = loop ? source.x : (source.x + target.x) / 2
        const midY = loop ? source.y - radius * 2.6 : (source.y + target.y) / 2
        edgeLabelElements.push(h('text', {
          key: 'label-' + edge.id,
          className: 'dov-edge-label',
          x: midX,
          y: midY - 3,
          textAnchor: 'middle',
        }, truncateText(edge.label, 34)))
      }
    }

    const nodeElements = []
    for (const node of display.nodes) {
      const point = positionById.get(node.id)
      if (!point) continue
      const radius = nodeRadius(node.degree)
      const isSelected = node.id === selectedId
      const isHovered = node.id === hoverId
      const isActive = node.id === activeId
      const isMatch = matchSet.has(node.id)
      const isDimmed = activeSet !== null && !activeSet.has(node.id)
      const classes = ['dov-node', 'dov-node--' + (node.kind || 'individual')]
      if (isSelected) classes.push('dov-is-selected')
      if (isHovered) classes.push('dov-is-hovered')
      if (isActive) classes.push('dov-is-active')
      if (isMatch) classes.push('dov-is-match')
      if (isDimmed) classes.push('dov-is-dim')
      const label = typeof node.label === 'string' && node.label ? node.label : (node.local || node.id)
      const renderLabel = showNodeLabels || isSelected || isHovered || isActive
      const children = [
        h('title', { key: 'title' }, label + '\n' + (node.iri || node.id)),
        h('circle', { key: 'hit', className: 'dov-node-hit', r: radius + 6 }),
      ]
      if (isSelected || isMatch) {
        children.push(h('circle', { key: 'halo', className: 'dov-node-halo', r: radius + 4 }))
      }
      children.push(h('circle', { key: 'dot', className: 'dov-node-dot', r: radius }))
      if (renderLabel) {
        children.push(h('text', {
          key: 'label', className: 'dov-node-label', y: radius + 13, textAnchor: 'middle',
        }, truncateText(label, 30)))
      }
      nodeElements.push(h('g', {
        key: node.id,
        className: classes.join(' '),
        'data-dov-node': node.id,
        transform: 'translate(' + point.x + ' ' + point.y + ')',
      }, children))
    }

    const scene = h('svg', {
      key: 'svg', ref: svgRef, className: 'dov-svg',
      viewBox: '0 0 ' + String(size.width) + ' ' + String(size.height),
      role: 'application', tabIndex: 0, 'aria-label': tr('viewer.title', '本体图谱'),
      'data-drag': dragKind || 'none',
      onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp, onPointerLeave: handlePointerLeave, onKeyDown: handleKeyDown,
    },
      h('title', { key: 'doc-title' }, tr('viewer.title', '本体图谱')),
      h('defs', { key: 'defs' },
        h('pattern', {
          id: gridId, width: 24, height: 24, patternUnits: 'userSpaceOnUse',
        }, h('path', { className: 'dov-grid-line', d: 'M 24 0 L 0 0 0 24' }))),
      h('rect', {
        key: 'backdrop',
        className: 'dov-backdrop',
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        fill: 'url(#' + gridId + ')',
      }),
      h('g', {
        key: 'scene',
        transform: 'translate(' + pan.x + ' ' + pan.y + ') scale(' + zoom + ')',
      },
        h('g', { key: 'edges' }, edgeElements),
        h('g', { key: 'edge-labels' }, edgeLabelElements),
        h('g', { key: 'nodes' }, nodeElements)))
    // --- canvas overlays ----------------------------------------------------
    const emptyOverlay = isEmpty ? h('div', { key: 'empty', className: 'dov-empty' },
      h('svg', { key: 'icon', className: 'dov-empty-icon', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
        h('line', { x1: 22, y1: 24, x2: 42, y2: 36 }), h('line', { x1: 22, y1: 40, x2: 42, y2: 28 }),
        h('circle', { cx: 20, cy: 24, r: 6 }), h('circle', { cx: 44, cy: 36, r: 6 }), h('circle', { cx: 20, cy: 40, r: 6 })),
      h('div', { key: 'title', className: 'dov-empty-title' }, tr('viewer.emptyTitle', '暂无可视化节点')),
      h('div', { key: 'hint', className: 'dov-empty-hint' }, tr('viewer.emptyHint', '这个文件没有可绘制的 RDF 三元组。'))) : null

    const focusBadge = focusOn && selectedNode ? h('div', { key: 'focus-badge', className: 'dov-canvas-badge' },
      tr('viewer.focusBadge', '仅显示选中节点周围（{n} 个节点）').replace('{n}', String(display.nodes.length))) : null

    const hint = isEmpty ? null : h('div', { key: 'hint', className: 'dov-canvas-hint' },
      tr('viewer.hint', '拖拽画布平移 · 滚轮缩放 · 点击节点查看详情'))

    const canvas = h('div', { key: 'canvas', className: 'dov-canvas', ref: canvasRef }, scene, emptyOverlay, focusBadge, hint)
    // --- detail panel -------------------------------------------------------
    let panel = null
    if (selectedNode && panelOpen) {
      const types = Array.isArray(selectedNode.types) ? selectedNode.types : []
      const literals = Array.isArray(selectedNode.literals) ? selectedNode.literals : []
      const iri = typeof selectedNode.iri === 'string' && selectedNode.iri ? selectedNode.iri : selectedNode.id
      const copyLabel = copyState === 'copied'
        ? tr('viewer.copied', '已复制')
        : copyState === 'failed' ? tr('viewer.copyFailed', '复制失败') : tr('viewer.copy', '复制')
      const countCell = (field, fallback) => h('div', { key: field, className: 'dov-count' },
        h('b', null, String(asNumber(selectedNode[field], 0))),
        h('span', null, tr('viewer.' + field, fallback)))

      const panelChildren = [
        h('div', { key: 'head', className: 'dov-panel-head' },
          h('span', { className: 'dov-panel-title', title: selectedNode.label || '' },
            selectedNode.label || selectedNode.local || selectedNode.id),
          h('span', { className: 'dov-chip dov-chip--' + (selectedNode.kind || 'individual') },
            typeLabel(selectedNode.kind)),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'dov-btn dov-btn--icon',
            title: tr('viewer.closePanel', '关闭详情'),
            'aria-label': tr('viewer.closePanel', '关闭详情'),
            onClick: () => setPanelOpen(false),
          }, '×')),
        h('div', { key: 'body', className: 'dov-panel-body' },
          h('section', { key: 'iri', className: 'dov-section' },
            h('div', { className: 'dov-section-title' }, tr('viewer.iri', 'IRI')),
            h('div', { className: 'dov-iri-row' },
              h('div', { className: 'dov-iri' }, iri),
              h('button', { type: 'button', className: 'dov-copy', title: tr('viewer.copy', '复制'), onClick: copyIri },
                copyLabel))),
          h('section', { key: 'types', className: 'dov-section' },
            h('div', { className: 'dov-section-title' }, tr('viewer.types', '类型')),
            types.length === 0
              ? h('div', { className: 'dov-muted' }, tr('viewer.noTypes', '没有 rdf:type 信息'))
              : h('div', { className: 'dov-types' }, types.map((type) => {
                const short = shortenIri(type)
                if (nodesById.has(type)) {
                  return h('button', {
                    key: type, type: 'button', className: 'dov-type', title: type,
                    onClick: () => selectAndCenter(type),
                  }, short)
                }
                return h('span', { key: type, className: 'dov-type dov-type--plain', title: type }, short)
              }))),
          h('section', { key: 'literals', className: 'dov-section' },
            h('div', { className: 'dov-section-title' }, tr('viewer.literals', '字面量属性')),
            literals.length === 0
              ? h('div', { className: 'dov-muted' }, tr('viewer.noLiterals', '没有字面量属性'))
              : h('table', { className: 'dov-literals' },
                h('tbody', null, literals.map((literal, index) => h('tr', { key: 'lit-' + String(index) },
                  h('td', { className: 'dov-lit-p', title: literal.p || '' },
                    literal.pLabel || shortenIri(literal.p || '')),
                  h('td', { className: 'dov-lit-v' },
                    typeof literal.value === 'string' ? literal.value : String(literal.value),
                    literal.lang ? h('span', { className: 'dov-lit-meta' }, ' @' + literal.lang) : null,
                    literal.dt ? h('span', { className: 'dov-lit-meta' },
                      ' ^^' + (localName(literal.dt) || literal.dt)) : null)))))),
          h('section', { key: 'counts', className: 'dov-section' },
            h('div', { className: 'dov-section-title' }, tr('viewer.structure', '连接')),
            h('div', { className: 'dov-counts' },
              countCell('outEdges', '出边'),
              countCell('inEdges', '入边'),
              countCell('degree', '度数')
            )
          )
        ),
      ]

      panel = h('aside', {
        key: 'panel',
        className: 'dov-panel',
        'aria-label': tr('viewer.details', '详情'),
      }, panelChildren)
    }

    const scrim = narrow && panel ? h('button', {
      key: 'scrim', type: 'button', className: 'dov-scrim',
      'aria-label': tr('viewer.closePanel', '关闭详情'),
      onClick: () => setPanelOpen(false),
    }) : null

    const body = h('div', { key: 'body', className: 'dov-body' }, canvas, scrim, panel)

    return h('div', {
      className: 'dov-root' + (narrow ? ' dov-root--narrow' : ''),
      style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' },
    },
      h('style', { key: 'style' }, CSS),
      header,
      issuesBanner,
      body)
  }

  return { OntologyGraphView }
}
