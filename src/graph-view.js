/**
 * Interactive SVG view for the ontology graph (orchestration layer).
 *
 * Split from a formerly single 899-line component: the stylesheet lives in
 * graph-view-style.js, the toolbar/search/filter/explore/banner components in
 * graph-view-controls.js, and the details panel in graph-view-details.js. The
 * Client bundle concatenates those files before this one inside one closure and
 * passes React in, so there are deliberately no imports and no JSX: every
 * element is built with React.createElement.
 *
 * Data layers (design §1.5): the `graph` prop is L1 (retained model). Filtering
 * projects it (L2), exploration expands a budgeted BFS (L3), and the draw
 * budget projects rendered edges (L4). Search, details and all totals read L1;
 * only the SVG and the "drawn" counter read L4. Layout positions arrive from
 * the caller as props -- this view never runs layoutGraph.
 *
 * Props contract:
 * {
 *   graph, t, sourceName,
 *   issues: string[],
 *   diagnostics: [{ code, severity, count, sample?, message }],
 *   budgets: { parse?, nodes?, literals?, edges? } each { total, kept, truncated, reason },
 *   positions: [{ id, x, y }] | null,
 *   layoutStatus: 'idle'|'parsing'|'modeling'|'layout'|'ready'|'error',
 *   degraded: boolean,
 *   surfaceLimit: { kind:'plugin'|'surface', bytes, surface:'preview'|'sidebar' } | null,
 *   onRelayout: (seed) => void,
 *   onReportVisible?: (info) => void,
 * }
 */

/**
 * @param {any} React the host React 18 module
 * @returns {{ OntologyGraphView: function }}
 */
export function createOntologyGraphView(React) {
  const h = React.createElement
  const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React
  const Controls = createGraphViewControls(React)
  const Details = createGraphViewDetails(React)

  let gridSequence = 0
  let searchSequence = 0

  // --- small pure helpers ---------------------------------------------------
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function countStat(stats, key, fallback) {
    return typeof stats === 'object' && stats !== null && Number.isFinite(stats[key]) ? stats[key] : fallback
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

  /** Fit graph-space points into the viewport, returning zoom + pan. */
  function fitView(points, width, height, padding) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of points) {
      if (!point) continue
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { zoom: 1, pan: { x: 0, y: 0 } }
    const pad = Math.min(asNumber(padding, GRAPH_FIT_PADDING), Math.min(width, height) * 0.4)
    const spanX = Math.max(0, maxX - minX)
    const spanY = Math.max(0, maxY - minY)
    const availableWidth = Math.max(1, width - pad * 2)
    const availableHeight = Math.max(1, height - pad * 2)
    const zoomX = spanX > 0.5 ? availableWidth / spanX : GRAPH_MAX_ZOOM
    const zoomY = spanY > 0.5 ? availableHeight / spanY : GRAPH_MAX_ZOOM
    const zoom = clamp(Math.min(zoomX, zoomY), GRAPH_MIN_ZOOM, 1.6)
    const pan = { x: width / 2 - ((minX + maxX) / 2) * zoom, y: height / 2 - ((minY + maxY) / 2) * zoom }
    if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) return { zoom: 1, pan: { x: 0, y: 0 } }
    return { zoom, pan }
  }

  /** Validate the incoming graph and never let a malformed shape reach render. */
  function normalizeGraph(graph) {
    if (!graph || typeof graph !== 'object') return GRAPH_EMPTY_GRAPH
    const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
    const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
    const nodes = rawNodes.filter((node) => node && typeof node.id === 'string')
    const edges = rawEdges.filter((edge) =>
      edge && typeof edge.source === 'string' && typeof edge.target === 'string')
    const rawStats = graph.stats && typeof graph.stats === 'object' ? graph.stats : GRAPH_EMPTY_STATS
    const stats = Object.assign({}, GRAPH_EMPTY_STATS, rawStats)
    const warnings = Array.isArray(graph.warnings) ? graph.warnings : []
    const truncation = graph.truncation && typeof graph.truncation === 'object' ? graph.truncation : null
    const source = graph.source && typeof graph.source === 'object' ? graph.source : null
    const unchanged = nodes === rawNodes && edges === rawEdges && rawStats === graph.stats &&
      warnings === graph.warnings && truncation === (graph.truncation || null) && source === (graph.source || null)
    if (unchanged) return graph
    return { nodes, edges, stats, warnings, truncation, source }
  }

  /** Composite edge identity (s, p, o) used to mark "not drawn" relations. */
  function edgeIdentity(source, predicate, target) {
    return source + '\u0000' + predicate + '\u0000' + target
  }

  // -------------------------------------------------------------------------
  // Component
  // -------------------------------------------------------------------------

  function OntologyGraphView(props) {
    const options = props || {}
    const graph = options.graph
    const t = options.t
    const sourceName = typeof options.sourceName === 'string' ? options.sourceName : ''
    const propIssues = Array.isArray(options.issues) ? options.issues : []
    const propDiagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : []
    const budgets = options.budgets && typeof options.budgets === 'object' ? options.budgets : null
    const positionsProp = Array.isArray(options.positions) ? options.positions : null
    const layoutStatus = typeof options.layoutStatus === 'string' ? options.layoutStatus : 'ready'
    const degraded = options.degraded === true
    const surfaceLimit = options.surfaceLimit && typeof options.surfaceLimit === 'object' ? options.surfaceLimit : null
    const onRelayout = typeof options.onRelayout === 'function' ? options.onRelayout : null
    const onReportVisible = typeof options.onReportVisible === 'function' ? options.onReportVisible : null

    const safeGraph = useMemo(() => normalizeGraph(graph), [graph])
    const isEmptyGraph = safeGraph.nodes.length === 0

    // --- i18n helper --------------------------------------------------------
    const tr = useCallback((key, fallback) => {
      try {
        const value = typeof t === 'function' ? t(key, fallback) : undefined
        return typeof value === 'string' && value.length > 0 ? value : fallback
      } catch (error) {
        return fallback
      }
    }, [t])
    const kindLabel = useCallback((kind) => {
      const fallback = VIEW_KIND_LABELS[kind] || kind || 'individual'
      return tr('viewer.kind.' + kind, fallback)
    }, [tr])
    const shortIri = useCallback((iri) => {
      if (typeof shortenIri === 'function') {
        try {
          return shortenIri(iri)
        } catch (error) {
          return typeof iri === 'string' ? iri : ''
        }
      }
      return typeof iri === 'string' ? iri : ''
    }, [])

    // --- presentation state -------------------------------------------------
    const [size, setSize] = useState(GRAPH_DEFAULT_SIZE)
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [selectedId, setSelectedId] = useState(null)
    const [hoverId, setHoverId] = useState(null)
    const [query, setQuery] = useState('')
    const [searchIndex, setSearchIndex] = useState(0)
    const [searchFocused, setSearchFocused] = useState(false)
    const [labelsOn, setLabelsOn] = useState(true)
    const [panelOpen, setPanelOpen] = useState(true)
    const [activePanel, setActivePanel] = useState('none')
    const [filterState, setFilterState] = useState(() => emptyFilterState())
    const [exploreState, setExploreState] = useState(() => createExploreState())
    const [notice, setNotice] = useState(null)
    const [issuesOpen, setIssuesOpen] = useState(false)
    const [copyState, setCopyState] = useState('idle')
    const [overrides, setOverrides] = useState({})
    const [dragKind, setDragKind] = useState(null)
    const [rovingId, setRovingId] = useState(null)

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
    const listboxIdRef = useRef(null)
    const fitStateRef = useRef({ graph: null, positions: null, measured: false })
    const relayoutSeedRef = useRef(1)
    const graphIdentityRef = useRef(safeGraph)
    const nodeElsRef = useRef(new Map())
    // Must be initialized before effects/dependency arrays reference it.
    const focusGraphCanvas = useCallback(() => {
      const svg = svgRef.current
      if (svg && typeof svg.focus === 'function') {
        try { svg.focus({ preventScroll: true }) } catch (error) { svg.focus() }
      }
    }, [])
    if (gridIdRef.current === null) {
      gridSequence += 1
      gridIdRef.current = 'dov-grid-' + String(gridSequence)
    }
    if (listboxIdRef.current === null) {
      searchSequence += 1
      listboxIdRef.current = 'dov-search-list-' + String(searchSequence)
    }
    const gridId = gridIdRef.current
    const listboxId = listboxIdRef.current
    const narrow = size.width < GRAPH_NARROW_WIDTH

    // --- derived graph structures (L1) --------------------------------------
    const nodesById = useMemo(() => {
      const map = new Map()
      for (const node of safeGraph.nodes) map.set(node.id, node)
      return map
    }, [safeGraph])
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
    const predicateOptions = useMemo(() => derivePredicateOptions(safeGraph), [safeGraph])

    // --- L2: filter projection ---------------------------------------------
    const filterActive = isFilterActive(filterState)
    // While exploring, the 1-hop direction filter is inert: direction belongs to
    // exploreNeighborhood (design §5.1 / model contract). Kind and predicate
    // conditions still project the graph before exploration.
    const filterCriteriaForView = useMemo(() => {
      const criteria = filterCriteria(filterState, selectedId)
      if (exploreState.on) delete criteria.direction
      return criteria
    }, [filterState, selectedId, exploreState.on])
    const filteredGraph = useMemo(() => {
      if (!filterActive) return safeGraph
      if (typeof filterGraph !== 'function') return safeGraph
      try {
        return normalizeProjectionResult(filterGraph(safeGraph, filterCriteriaForView), safeGraph)
      } catch (error) {
        return safeGraph
      }
    }, [safeGraph, filterActive, filterCriteriaForView])

    // --- L3: exploration projection ----------------------------------------
    const exploreActive = exploreState.on && Boolean(selectedId) && nodesById.has(selectedId)
    const exploreResult = useMemo(() => {
      if (!exploreActive) {
        return { graph: filteredGraph, truncated: false, nextCursor: null, totalNodes: null, totalEdges: null }
      }
      if (typeof exploreNeighborhood !== 'function') {
        return { graph: filteredGraph, truncated: false, nextCursor: null, totalNodes: null, totalEdges: null }
      }
      try {
        return normalizeExploreResult(
          exploreNeighborhood(filteredGraph, exploreCriteria(exploreState, selectedId, filterState)),
          filteredGraph,
        )
      } catch (error) {
        return { graph: filteredGraph, truncated: false, nextCursor: null, totalNodes: null, totalEdges: null }
      }
    }, [filteredGraph, exploreActive, selectedId, exploreState, filterState])
    const exploredGraph = exploreResult.graph
    const exploreCanMore = exploreResult.truncated === true &&
      ((exploreResult.nextCursor !== null && exploreResult.nextCursor !== undefined) ||
        exploreResult.depthCapped !== true)

    // --- L4: draw budget projection ----------------------------------------
    const matches = useMemo(() => {
      if (!query.trim() || typeof matchNodes !== 'function') return []
      try {
        return matchNodes(safeGraph, query, GRAPH_SEARCH_LIMIT)
      } catch (error) {
        return []
      }
    }, [safeGraph, query])
    const matchSet = useMemo(() => new Set(matches), [matches])
    const drawPriorityIds = useMemo(() => {
      const ids = []
      if (typeof selectedId === 'string') ids.push(selectedId)
      for (const id of matches.slice(0, GRAPH_SEARCH_VISIBLE)) {
        if (id !== selectedId) ids.push(id)
      }
      return ids
    }, [selectedId, matches])
    const drawnResult = useMemo(() => {
      if (typeof applyEdgeBudget !== 'function') return normalizeDrawnResult(null, exploredGraph, selectedId)
      try {
        return normalizeDrawnResult(
          applyEdgeBudget(exploredGraph, { maxEdges: GRAPH_EDGE_BUDGET, priorityIds: drawPriorityIds }),
          exploredGraph,
          selectedId,
        )
      } catch (error) {
        return normalizeDrawnResult(null, exploredGraph, selectedId)
      }
    }, [exploredGraph, drawPriorityIds, selectedId])

    // --- positions (layout is computed by the caller, never here) -----------
    const positionById = useMemo(() => {
      const map = new Map()
      if (!Array.isArray(positionsProp)) return map
      for (const point of positionsProp) {
        if (!point || typeof point.id !== 'string') continue
        const x = asNumber(point.x, NaN)
        const y = asNumber(point.y, NaN)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        const override = overrides ? overrides[point.id] : null
        map.set(point.id, override && Number.isFinite(override.x) && Number.isFinite(override.y)
          ? { x: override.x, y: override.y }
          : { x, y })
      }
      return map
    }, [positionsProp, overrides])
    const hasPositions = positionById.size > 0
    const renderableNodes = useMemo(() => drawnResult.nodes.filter((node) =>
      node && typeof node.id === 'string' && positionById.has(node.id)), [drawnResult, positionById])
    const renderableIds = useMemo(() => new Set(renderableNodes.map((node) => node.id)), [renderableNodes])
    const renderedEdges = useMemo(() => {
      if (renderableIds.size === 0) return []
      return drawnResult.edges.filter((edge) =>
        edge && typeof edge.source === 'string' && typeof edge.target === 'string' &&
        renderableIds.has(edge.source) && renderableIds.has(edge.target))
    }, [drawnResult, renderableIds])
    const drawnEdgeKeys = useMemo(() => {
      const set = new Set()
      for (const edge of drawnResult.edges) {
        if (edge && typeof edge.source === 'string' && typeof edge.target === 'string') {
          set.add(edgeIdentity(edge.source, edge.p, edge.target))
        }
      }
      return set
    }, [drawnResult])
    const fitPointsList = useMemo(() => {
      const points = []
      if (!hasPositions) return points
      for (const node of renderableNodes) {
        const point = positionById.get(node.id)
        if (point) points.push(point)
      }
      return points
    }, [renderableNodes, positionById, hasPositions])

    const totalNodes = safeGraph.nodes.length
    const totalEdges = safeGraph.edges.length
    const visibleNodeCount = hasPositions ? renderableNodes.length : exploredGraph.nodes.length
    const visibleEdgeCount = hasPositions ? renderedEdges.length : (Array.isArray(drawnResult.edges) ? drawnResult.edges.length : 0)
    const layoutPending = totalNodes > 0 && !hasPositions
    const layoutBusy = layoutStatus === 'parsing' || layoutStatus === 'modeling' || layoutStatus === 'layout'
    const layoutFailed = layoutPending && layoutStatus === 'error'
    const filteredEmpty = filterActive && filteredGraph.nodes.length === 0 && totalNodes > 0

    // --- search -------------------------------------------------------------
    const searchActive = query.trim().length > 0
    const searchResults = useMemo(() => {
      const results = []
      for (const id of matches.slice(0, GRAPH_SEARCH_VISIBLE)) {
        const node = nodesById.get(id)
        if (!node) continue
        results.push({
          id,
          label: typeof node.label === 'string' && node.label ? node.label : (node.local || node.id),
          kind: node.kind || 'individual',
          iri: typeof node.iri === 'string' && node.iri ? node.iri : node.id,
        })
      }
      return results
    }, [matches, nodesById])
    const searchState = searchSelection(searchResults, searchIndex)
    const searchOpen = searchActive && searchFocused
    const activeId = highlightAnchor(
      exploreActive,
      selectedId && nodesById.has(selectedId) ? selectedId : null,
      hoverId && nodesById.has(hoverId) ? hoverId : null,
    )
    const activeSet = useMemo(() => highlightNeighborhood(activeId, adjacency), [activeId, adjacency])
    const selectedNode = selectedId ? nodesById.get(selectedId) || null : null
    const showNodeLabels = labelsOn && (renderableNodes.length < GRAPH_LABEL_NODE_LIMIT || zoom >= GRAPH_LABEL_ZOOM)
    const drawnInfo = {
      kept: drawnResult.stats.keptEdges,
      hidden: drawnResult.stats.hiddenEdges,
      total: drawnResult.stats.totalEdges,
    }
    const budgetRecords = useMemo(() => collectBudgetRecords({
      budgets,
      graph: safeGraph,
      drawn: drawnResult,
      explore: exploreResult,
    }), [budgets, safeGraph, drawnResult, exploreResult])
    const diagnosticGroups = useMemo(() => groupDiagnostics(propDiagnostics, propIssues), [propDiagnostics, propIssues])
    // --- empty/computing state selection -----------------------------------
    let emptyKind = null
    if (isEmptyGraph) emptyKind = 'empty-file'
    else if (filteredEmpty) emptyKind = 'filtered'
    else if (layoutPending && !layoutFailed) emptyKind = 'computing'
    else if (layoutFailed) emptyKind = 'layout-error'
    else if (!hasPositions || renderableNodes.length === 0) emptyKind = 'no-drawable'

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

    // --- reset per-document state when the source graph changes -------------
    useEffect(() => {
      if (graphIdentityRef.current === safeGraph) return
      graphIdentityRef.current = safeGraph
      setSelectedId(null)
      setHoverId(null)
      setQuery('')
      setSearchIndex(0)
      setSearchFocused(false)
      setActivePanel('none')
      setFilterState(emptyFilterState())
      setExploreState(createExploreState())
      setNotice(null)
      setOverrides({})
      setRovingId(null)
      setIssuesOpen(false)
      fitStateRef.current = { graph: null, positions: null, measured: false }
    }, [safeGraph])

    // Drag overrides belong to one layout result; a new layout clears them.
    useEffect(() => {
      setOverrides((previous) => (Object.keys(previous).length === 0 ? previous : {}))
    }, [positionsProp])

    useEffect(() => {
      if (selectedId && !nodesById.has(selectedId)) setSelectedId(null)
      if (hoverId && !nodesById.has(hoverId)) setHoverId(null)
    }, [nodesById, selectedId, hoverId])

    useEffect(() => {
      setCopyState('idle')
    }, [selectedId])

    // Closing the details panel returns keyboard focus to the graph canvas, so
    // a host-level focus container cannot leave the next key with DSH.
    const panelWasOpenRef = useRef(false)
    useEffect(() => {
      const wasOpen = panelWasOpenRef.current
      panelWasOpenRef.current = Boolean(panelOpen && selectedId)
      if (!wasOpen || (panelOpen && selectedId)) return
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusGraphCanvas)
      else focusGraphCanvas()
    }, [panelOpen, selectedId, focusGraphCanvas])

    useEffect(() => {
      setExploreState((previous) => {
        const next = shouldResetExplore(previous, {
          anchorId: selectedId,
          anchorVisible: Boolean(selectedId && nodesById.has(selectedId)),
        })
        return next === previous ? previous : next
      })
    }, [selectedId, nodesById])

    useEffect(() => {
      setSearchIndex((previous) => {
        const next = searchSelection(searchResults, previous).index
        return next === previous ? previous : next
      })
    }, [searchResults])

    useEffect(() => {
      if (!selectedNode || !filterActive) return
      if (isNodeVisibleUnderFilter(selectedNode, filterState, safeGraph)) return
      const label = selectedNode.label || selectedNode.local || selectedNode.id
      setNotice((previous) => (previous && previous.kind === 'selection-hidden' && previous.nodeLabel === label
        ? previous
        : { kind: 'selection-hidden', nodeLabel: label }))
    }, [selectedNode, filterActive, filterState, safeGraph])

    useEffect(() => {
      if (!onReportVisible) return
      try {
        onReportVisible({
          visibleNodes: visibleNodeCount,
          totalNodes,
          visibleEdges: visibleEdgeCount,
          totalEdges,
          drawnEdges: renderedEdges.length,
          filteredNodes: filteredGraph.nodes.length,
          exploredNodes: exploredGraph.nodes.length,
          filterActive,
          exploreActive,
          degraded,
          layoutStatus,
        })
      } catch (error) {
        // Reporting is best effort; never break the view for it.
      }
    }, [onReportVisible, visibleNodeCount, totalNodes, visibleEdgeCount, totalEdges, renderedEdges.length,
      filteredGraph, exploredGraph, filterActive, exploreActive, degraded, layoutStatus])

    useEffect(() => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      if (overrideFrameRef.current && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(overrideFrameRef.current)
      }
    }, [])

    // --- view transform helpers --------------------------------------------
    const applyView = useCallback((nextZoom, nextPan) => {
      if (!Number.isFinite(nextZoom) || !Number.isFinite(nextPan.x) || !Number.isFinite(nextPan.y)) return
      zoomRef.current = nextZoom
      panRef.current = nextPan
      setZoom(nextZoom)
      setPan(nextPan)
    }, [])

    const fitPoints = useCallback((points) => {
      if (!points || points.length === 0) return
      const view = fitView(points, size.width, size.height, GRAPH_FIT_PADDING)
      applyView(view.zoom, view.pan)
    }, [applyView, size.width, size.height])

    // Fit once per layout result (new positions, new graph) and on first real
    // measurement; later size changes keep the user's current viewport.
    useEffect(() => {
      if (fitPointsList.length === 0) return
      const fitted = fitStateRef.current
      const canvas = canvasRef.current
      const measured = Boolean(canvas) && Math.round(canvas.clientWidth) === size.width &&
        Math.round(canvas.clientHeight) === size.height
      const firstMeasured = measured && !fitted.measured
      if (fitted.graph === safeGraph && fitted.positions === positionsProp && !firstMeasured) return
      fitted.graph = safeGraph
      fitted.positions = positionsProp
      fitted.measured = measured
      const view = fitView(fitPointsList, size.width, size.height, GRAPH_FIT_PADDING)
      applyView(view.zoom, view.pan)
    }, [fitPointsList, safeGraph, positionsProp, size.width, size.height, applyView])

    const applyZoomAt = useCallback((nextZoom, cursorX, cursorY) => {
      const previous = zoomRef.current
      const target = clamp(asNumber(nextZoom, previous), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
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

    // Native wheel listener keeps DSH-level handlers from capturing graph
    // scrolling. The keydown listener is installed later, after every callback
    // it references has been initialised (see below).
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
      if (!point) return false
      const target = clamp(asNumber(requestedZoom, Math.max(zoomRef.current, 1.3)), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM)
      applyView(target, {
        x: size.width / 2 - point.x * target,
        y: size.height / 2 - point.y * target,
      })
      return true
    }, [positionById, size.width, size.height, applyView])

    const labelOf = useCallback((id) => {
      const node = nodesById.get(id)
      return node ? (node.label || node.local || node.id) : String(id)
    }, [nodesById])

    const selectNode = useCallback((id, options) => {
      const target = typeof id === 'string' && nodesById.has(id) ? id : null
      if (target && (!options || options.focusGraph !== false)) focusGraphCanvas()
      setSelectedId(target)
      setPanelOpen(Boolean(target))
      if (target) setRovingId(target)
      setNotice(null)
      if (target && exploreState.on && target !== selectedId) {
        setExploreState((previous) => resetExploreCursor(previous))
        setNotice({ kind: 'explore-root-switched', nodeLabel: labelOf(target) })
      }
      if (target && filterActive) {
        const node = nodesById.get(target)
        if (node && !isNodeVisibleUnderFilter(node, filterState, safeGraph)) {
          setNotice({ kind: 'selection-hidden', nodeLabel: labelOf(target) })
        }
      }
    }, [nodesById, exploreState.on, selectedId, filterActive, filterState, safeGraph, labelOf, focusGraphCanvas])

    const selectAndCenter = useCallback((id) => {
      if (!nodesById.has(id)) return
      selectNode(id)
      centerOn(id, Math.max(zoomRef.current, 1.2))
    }, [nodesById, selectNode, centerOn])

    const selectFromSearch = useCallback((id) => {
      selectAndCenter(id)
      setSearchFocused(false)
    }, [selectAndCenter])

    const clearSearch = useCallback(() => {
      setQuery('')
      setSearchIndex(0)
      setSearchFocused(false)
    }, [])

    // --- key handling -------------------------------------------------------
    const handleNodeKeyDown = useCallback((event, id) => {
      if (!ownsGraphKeyboardFocus(event.target, svgRef.current)) return
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        event.stopPropagation()
        selectNode(id)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setSelectedId(null)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        const order = renderableNodes.map((node) => node.id)
        if (order.length === 0) return
        const current = order.indexOf(id)
        const step = (event.key === 'ArrowDown' || event.key === 'ArrowRight') ? 1 : -1
        const nextIndex = current < 0 ? 0 : (current + step + order.length) % order.length
        const nextId = order[nextIndex]
        setRovingId(nextId)
        const element = nodeElsRef.current.get(nextId)
        if (element && typeof element.focus === 'function') element.focus()
      }
    }, [renderableNodes, selectNode])

    const handleCanvasKeyDown = useCallback((event) => {
      const action = graphShortcutAction(event.key, event.target, svgRef.current)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      if (action === 'escape') {
        if (searchActive) clearSearch()
        else setSelectedId(null)
      } else if (action === 'zoom-in') {
        zoomBy(1.25)
      } else if (action === 'zoom-out') {
        zoomBy(0.8)
      } else if (action === 'fit') {
        fitPoints(fitPointsList)
      }
    }, [searchActive, clearSearch, zoomBy, fitPoints, fitPointsList])

    const handleSearchKeyDown = useCallback((event) => {
      const count = searchResults.length
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setSearchFocused(true)
        setSearchIndex((previous) => moveSearchIndex(previous, 1, count))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setSearchFocused(true)
        setSearchIndex((previous) => moveSearchIndex(previous, -1, count))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const target = searchState.id || (searchResults[0] ? searchResults[0].id : null)
        if (target) selectFromSearch(target)
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        clearSearch()
        if (event.currentTarget && typeof event.currentTarget.blur === 'function') event.currentTarget.blur()
      }
    }, [searchResults, searchState, selectFromSearch, clearSearch])

    // Window capture runs before the host's document-level focus manager. Only
    // graph-owned focus targets are handled, so DSH controls keep their keys.
    // The effect is declared after every callback it closes over (no TDZ reads).
    useEffect(() => {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
      const onKeyDown = (event) => {
        const svg = svgRef.current
        if (!ownsGraphKeyboardFocus(event.target, svg)) return
        const action = graphShortcutAction(event.key, event.target, svg)
        if (action) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          if (action === 'escape') {
            if (searchActive) clearSearch()
            else setSelectedId(null)
          } else if (action === 'zoom-in') {
            zoomBy(1.25)
          } else if (action === 'zoom-out') {
            zoomBy(0.8)
          } else if (action === 'fit') {
            fitPoints(fitPointsList)
          }
          return
        }
        const order = renderableNodes.map((node) => node.id)
        const arrow = event.key === 'ArrowDown' || event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' || event.key === 'ArrowLeft' ||
          event.key === 'Home' || event.key === 'End'
        const current = rovingId && order.indexOf(rovingId) >= 0
          ? rovingId
          : (selectedId && order.indexOf(selectedId) >= 0 ? selectedId : order[0])
        if (arrow) {
          const next = moveRovingId(order, current, event.key)
          if (!next) return
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          setRovingId(next)
          const element = nodeElsRef.current.get(next)
          if (element && typeof element.focus === 'function') element.focus()
          return
        }
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          if (!current) return
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          selectNode(current)
        }
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [searchActive, clearSearch, zoomBy, fitPoints, fitPointsList, renderableNodes, rovingId, selectedId, selectNode])

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
      focusGraphCanvas()
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
      if (drag.nodeId) selectNode(drag.nodeId)
      else {
        setSelectedId(null)
        setPanelOpen(false)
      }
    }

    const handlePointerLeave = () => {
      if (dragRef.current) return
      hoverRef.current = null
      setHoverId(null)
    }

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

    // --- filter / exploration / layout actions ------------------------------
    const updateFilter = useCallback((updater) => {
      setFilterState((previous) => normalizeFilterState(updater(normalizeFilterState(previous))))
      setExploreState((previous) => resetExploreCursor(previous))
      setNotice(null)
    }, [])
    const toggleKind = useCallback((kind) => updateFilter((previous) => ({
      ...previous,
      kinds: toggleFilterValue(previous.kinds, kind),
    })), [updateFilter])
    const togglePredicate = useCallback((predicate) => updateFilter((previous) => ({
      ...previous,
      predicates: toggleFilterValue(previous.predicates, predicate),
    })), [updateFilter])
    const setFilterDirection = useCallback((direction) => updateFilter((previous) => ({
      ...previous,
      direction,
    })), [updateFilter])
    const clearFilters = useCallback(() => {
      setFilterState(emptyFilterState())
      setExploreState((previous) => resetExploreCursor(previous))
      setNotice(null)
    }, [])

    const toggleExplore = useCallback(() => {
      if (!selectedNode) return
      setExploreState((previous) => ({
        ...createExploreState(previous),
        on: !previous.on,
        cursor: null,
        extension: 0,
      }))
    }, [selectedNode])
    const setExploreDepth = useCallback((depth) => {
      setExploreState((previous) => withExploreDepth(previous, depth))
    }, [])
    const setExploreDirection = useCallback((direction) => {
      setExploreState((previous) => withExploreDirection(previous, direction))
    }, [])
    const continueExplore = useCallback(() => {
      setExploreState((previous) => advanceExplore(previous, exploreResult))
    }, [exploreResult])
    const backToFull = useCallback(() => {
      setExploreState((previous) => ({
        ...createExploreState(previous),
        on: false,
        cursor: null,
        extension: 0,
      }))
    }, [])

    const relayout = useCallback(() => {
      setOverrides((previous) => (Object.keys(previous).length === 0 ? previous : {}))
      relayoutSeedRef.current += 1
      if (onRelayout) {
        try {
          onRelayout(relayoutSeedRef.current)
        } catch (error) {
          // The caller owns the layout task; a failure must not break the view.
        }
      }
    }, [onRelayout])

    const toggleFilterPanel = useCallback(() => {
      setActivePanel((previous) => (previous === 'filter' ? 'none' : 'filter'))
    }, [])
    const toggleExplorePanel = useCallback(() => {
      setActivePanel((previous) => (previous === 'explore' ? 'none' : 'explore'))
    }, [])
    const closeTopOverlay = useCallback(() => {
      setActivePanel((previous) => {
        if (previous !== 'none') return 'none'
        setPanelOpen(false)
        return previous
      })
    }, [])
    const locateSelection = useCallback(() => {
      const id = selectedId
      setFilterState(emptyFilterState())
      setExploreState((previous) => ({
        ...createExploreState(previous),
        on: false,
        cursor: null,
        extension: 0,
      }))
      setNotice(null)
      if (id) centerOn(id, Math.max(zoomRef.current, 1.2))
    }, [selectedId, centerOn])

    // --- SVG scene ----------------------------------------------------------
    const edgeElements = []
    const edgeLabelElements = []
    for (const edge of renderedEdges) {
      const source = positionById.get(edge.source)
      const target = positionById.get(edge.target)
      if (!source || !target) continue
      const isActive = highlightRelation(edge.source, edge.target, activeId)
      const isDimmed = Boolean(activeId) && !isActive
      const classes = ['dov-edge', 'dov-edge--' + (edge.kind || 'object')]
      if (isActive) classes.push('dov-is-active')
      if (isDimmed) classes.push(exploreActive ? 'dov-is-context' : 'dov-is-dim')
      const multiplicity = Math.max(1, asNumber(edge.count, 1))
      const width = 0.9 + Math.min(1.4, Math.log(multiplicity + 1) * 0.45)
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

    const rovingTargetId = rovingId && renderableIds.has(rovingId)
      ? rovingId
      : (selectedId && renderableIds.has(selectedId)
        ? selectedId
        : (renderableNodes.length > 0 ? renderableNodes[0].id : null))
    const nodeElements = []
    for (const node of renderableNodes) {
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
      if (isDimmed) classes.push(exploreActive ? 'dov-is-context' : 'dov-is-dim')
      if (node.id === rovingId) classes.push('dov-is-focus')
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
        role: 'button',
        'data-dov-graph-focus': true,
        tabIndex: node.id === rovingTargetId ? 0 : -1,
        'aria-label': label + '，' + kindLabel(node.kind),
        'aria-pressed': isSelected,
        onFocus: () => setRovingId(node.id),
        onKeyDown: (event) => {
        if (!event.defaultPrevented) handleNodeKeyDown(event, node.id)
      },
        ref: (element) => {
          if (element) nodeElsRef.current.set(node.id, element)
          else nodeElsRef.current.delete(node.id)
        },
      }, children))
    }

    const scene = h('svg', {
      key: 'svg', ref: svgRef, className: 'dov-svg',
      viewBox: '0 0 ' + String(size.width) + ' ' + String(size.height),
      role: 'application', tabIndex: 0, 'data-dov-graph-focus': true, 'aria-label': tr('viewer.title', '本体图谱'),
      'data-drag': dragKind || 'none',
      onClick: () => {
        // Re-focus after the host's click handling; DSH may move focus on click.
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusGraphCanvas)
        else focusGraphCanvas()
      },
      onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp, onPointerLeave: handlePointerLeave, onKeyDown: handleCanvasKeyDown,
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

    // --- toolbar + banners --------------------------------------------------
    const toolbar = h(Controls.PrimaryToolbar, {
      key: 'toolbar',
      tr,
      sourceName,
      kindLabel,
      shortIri,
      badge: budgetRecords.length > 0 ? tr('viewer.truncated', '输入已截断') : null,
      counts: {
        nodes: visibleNodeCount,
        totalNodes,
        edges: visibleEdgeCount,
        totalEdges,
        triples: countStat(safeGraph.stats, 'triples', 0),
      },
      drawn: drawnInfo,
      labelsOn,
      onToggleLabels: () => setLabelsOn((value) => !value),
      zoom,
      onZoomIn: () => zoomBy(1.25),
      onZoomOut: () => zoomBy(0.8),
      onFit: () => fitPoints(fitPointsList),
      onRelayout: relayout,
      relayoutBusy: layoutBusy,
      search: {
        query,
        active: searchActive,
        open: searchOpen,
        results: searchResults,
        activeIndex: searchState.index,
        listboxId,
        disabled: isEmptyGraph,
        onChange: (value) => {
          setQuery(value)
          setSearchIndex(0)
          setSearchFocused(true)
        },
        onKeyDown: handleSearchKeyDown,
        onFocus: () => setSearchFocused(true),
        onBlur: () => setSearchFocused(false),
        onClear: clearSearch,
        onSelect: selectFromSearch,
        onHover: (index) => setSearchIndex(index),
      },
      filterActive,
      filterOpen: activePanel === 'filter',
      onToggleFilter: toggleFilterPanel,
      exploreOn: exploreState.on,
      exploreOpen: activePanel === 'explore',
      onToggleExplore: toggleExplorePanel,
      canExplore: Boolean(selectedNode),
      selectedNode,
      panelOpen,
      onToggleDetails: () => setPanelOpen((value) => !value),
      isEmpty: isEmptyGraph,
    })

    const statusBanner = h(Controls.StatusBanner, {
      key: 'banners',
      tr,
      open: issuesOpen,
      onToggle: () => setIssuesOpen((value) => !value),
      budgetRecords,
      diagnosticGroups,
      degraded,
      surfaceLimit,
    })

    const noticeBar = notice ? h(Controls.NoticeBar, {
      key: 'notice',
      tr,
      notice,
      filterActive,
      onClearFilters: clearFilters,
      onLocate: locateSelection,
      onDismiss: () => setNotice(null),
    }) : null

    // --- canvas overlays ----------------------------------------------------
    const overlay = emptyKind
      ? h(Controls.EmptyState, {
        key: 'empty',
        tr,
        kind: emptyKind,
        onRestore: clearFilters,
        onBack: backToFull,
        onRelayout: relayout,
      })
      : null
    const exploreBadge = exploreActive ? h('div', { key: 'explore-badge', className: 'dov-canvas-badge' },
      formatTemplate(tr('viewer.focusBadge', '仅显示选中节点周围（{n} 个节点）'),
        { n: exploredGraph.nodes.length }) +
      ' · ' + formatTemplate(tr('viewer.hops', '{n} 跳'), { n: exploreState.depth })) : null
    const busyBadge = layoutBusy && hasPositions ? h('div', {
      key: 'busy',
      className: 'dov-canvas-badge dov-canvas-badge--busy',
    }, tr('state.layout', '正在计算布局…')) : null
    const hint = emptyKind === null && renderableNodes.length > 0
      ? h('div', { key: 'hint', className: 'dov-canvas-hint' },
        tr('viewer.hint', '拖拽画布平移 · 滚轮缩放 · 点击节点查看详情'))
      : null
    const canvas = h('div', { key: 'canvas', className: 'dov-canvas', ref: canvasRef },
      scene, overlay, exploreBadge, busyBadge, hint)

    // --- secondary panels + details ----------------------------------------
    const filterPanel = activePanel === 'filter' ? h(Controls.FilterPanel, {
      key: 'filter-panel',
      tr,
      kindLabel,
      filter: filterState,
      predicateOptions,
      counts: {
        nodes: { visible: filteredGraph.nodes.length, total: totalNodes },
        edges: { visible: filteredGraph.edges.length, total: totalEdges },
      },
      anchorLabel: selectedNode ? (selectedNode.label || selectedNode.local || selectedNode.id) : '',
      exploreOn: exploreState.on,
      onToggleKind: toggleKind,
      onTogglePredicate: togglePredicate,
      onDirection: setFilterDirection,
      onClear: clearFilters,
      onClose: () => setActivePanel('none'),
    }) : null
    const explorePanel = activePanel === 'explore' ? h(Controls.ExplorePanel, {
      key: 'explore-panel',
      tr,
      explore: exploreState,
      selectedLabel: selectedNode ? (selectedNode.label || selectedNode.local || selectedNode.id) : '',
      keptNodes: exploredGraph.nodes.length,
      keptEdges: exploredGraph.edges.length,
      totalNodes: exploreResult.totalNodes,
      totalEdges: exploreResult.totalEdges,
      truncated: exploreResult.truncated === true,
      canMore: exploreCanMore,
      onToggle: toggleExplore,
      onDepth: setExploreDepth,
      onDirection: setExploreDirection,
      onMore: continueExplore,
      onClose: () => setActivePanel('none'),
    }) : null
    const details = selectedNode && panelOpen ? h(Details.DetailsPanel, {
      key: 'details',
      tr,
      narrow,
      open: true,
      node: selectedNode,
      graph: safeGraph,
      kindLabel,
      shortenIri: shortIri,
      drawnEdgeKeys,
      canSelectNode: (id) => nodesById.has(id),
      onSelectNode: selectAndCenter,
      copyState,
      onCopy: copyIri,
      onClose: () => setPanelOpen(false),
    }) : null
    const scrim = narrow && (details !== null || activePanel !== 'none') ? h('button', {
      key: 'scrim', type: 'button', className: 'dov-scrim',
      'aria-label': tr('viewer.closePanel', '关闭详情'),
      onClick: closeTopOverlay,
    }) : null
    const body = h('div', { key: 'body', className: 'dov-body' }, canvas, scrim, details, filterPanel, explorePanel)

    const liveRegion = h('div', {
      key: 'live',
      className: 'dov-sr-only',
      role: 'status',
      'aria-live': 'polite',
    }, tr('viewer.nodes', '节点') + ' ' + String(visibleNodeCount) + ' / ' + String(totalNodes) + '，' +
      tr('viewer.edges', '边') + ' ' + String(visibleEdgeCount) + ' / ' + String(totalEdges))

    return h('div', {
      className: 'dov-root' + (narrow ? ' dov-root--narrow' : ''),
      style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' },
    },
    h('style', { key: 'style' }, GRAPH_VIEW_CSS),
    toolbar,
    statusBanner,
    noticeBar,
    body,
    liveRegion)
  }

  return { OntologyGraphView }
}
