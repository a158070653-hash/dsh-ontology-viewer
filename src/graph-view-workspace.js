/**
 * Workspace surface: one controller for the primary file, additional files,
 * the three semantic views, provenance details and static export.
 *
 * It owns the workspace runner (`createOntologyRunner`) and keeps L0 in the
 * runner, the L1 graph in state, and per-view preferences here. Views never
 * re-parse: the tree and layered projections consume the same L1 graph, and a
 * source change only re-runs composition.
 *
 * Plain React.createElement; no imports (the Client build concatenates the
 * modules inside one closure).
 */

/** Monotonic revision used to reject stale export snapshots. */
let workspaceRevisionSequence = 0

/**
 * Translate a stored message descriptor at render time so a locale switch
 * re-renders existing status text instead of leaving the previous language.
 * `message` is `{ key, fallback?, values? }`; placeholders come from `values`.
 */
export function formatI18nMessage(translate, message) {
  if (!message || typeof message !== 'object' || typeof message.key !== 'string') return ''
  const fn = typeof translate === 'function' ? translate : null
  const text = fn ? fn(message.key, message.fallback || message.key) : (message.fallback || message.key)
  if (!message.values || typeof text !== 'string') return String(text)
  return text.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(message.values, name) ? String(message.values[name]) : match
  ))
}

/**
 * @param {any} React host React 18 module
 */
export function createOntologyWorkspace(React) {
  const h = React.createElement
  const { useCallback, useEffect, useMemo, useRef, useState } = React
  const { OntologyGraphView } = createOntologyGraphView(React)
  const Multiview = createMultiview(React)

  const PANEL_LIMITS = {
    maxTriples: 120000,
    maxNodes: 1500,
    maxEdges: 6000,
    maxLiteralsPerNode: 60,
    maxLiteralLength: 16384,
  }
  const LAYOUT_ITERATIONS = 320

  /** Read one host theme token for the export theme. */
  function readThemeToken(name, fallback) {
    return readHostThemeToken(name, fallback)
  }

  const SESSION_REGISTRY = typeof createSessionRegistry === 'function' ? createSessionRegistry() : null
  function clearSharedWorkspaces() { if (SESSION_REGISTRY) registryClear(SESSION_REGISTRY) }

  function downloadBlob(blob, fileName) {
    try {
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return { ok: false, reason: 'unavailable' }
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.rel = 'noopener'
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => {
        try { URL.revokeObjectURL(url) } catch (error) { /* ignored */ }
      }, 4000)
      return { ok: true, reason: null }
    } catch (error) {
      return { ok: false, reason: error && error.message ? String(error.message) : 'download-failed' }
    }
  }

  function aggregateDiagnostics(sources) {
    const list = []
    for (const source of sources) {
      const diagnostics = source && Array.isArray(source.diagnostics) ? source.diagnostics : []
      for (const entry of diagnostics) {
        if (entry && typeof entry.code === 'string') list.push(entry)
      }
    }
    return list
  }

  function budgetsFrom(sources, graph) {
    let parse = null
    for (const source of sources) {
      if (source && source.truncation) parse = source.truncation
    }
    const truncation = graph && graph.truncation ? graph.truncation : {}
    return {
      parse: parse,
      nodes: truncation.nodes || null,
      literals: truncation.literals || null,
      edges: truncation.edges || null,
    }
  }

  function sourceLabelMap(sources) {
    const map = {}
    for (const source of sources) map[source.sourceId] = source.displayName || source.sourceId
    return map
  }

  /**
   * The workspace panel. Owner props mirror the previous single-file panel so
   * both host entries keep their existing state semantics.
   */
  function OntologyWorkspacePanel(props) {
    const t = props.t
    const messageText = useCallback((message) => formatI18nMessage(t, message), [t])
    const text = typeof props.text === 'string' ? props.text : ''
    const source = props.source || { address: '', displayName: '', surface: 'preview' }
    const absolutePath = typeof props.absolutePath === 'string' ? props.absolutePath : ''
    const loading = !!props.loading
    const skipReason = props.skipReason || null
    const sizeBytes = Number(props.sizeBytes) || 0
    const limitBytes = Number(props.limitBytes) || 12 * 1024 * 1024

    const [status, setStatus] = useState('idle')
    const [errorMessage, setErrorMessage] = useState('')
    const [graph, setGraph] = useState(null)
    const [positions, setPositions] = useState(null)
    const [sources, setSources] = useState([])
    const [totals, setTotals] = useState({ files: 0, bytes: 0, occurrences: 0 })
    const [workset, setWorkset] = useState([])
    const [degraded, setDegraded] = useState(false)
    const [viewType, setViewType] = useState('network')
    const [selectedId, setSelectedId] = useState(null)
    const [expandedIds, setExpandedIds] = useState([])
    const [treeMode, setTreeMode] = useState('class')
    const [treeQuery, setTreeQuery] = useState('')
    const [sharedFilter, setSharedFilter] = useState(() => emptyFilterState())
    const [sharedExplore, setSharedExplore] = useState(() => createExploreState())
    const [sharedAnchorId, setSharedAnchorId] = useState(null)
    const [orientation, setOrientation] = useState('down')
    const [predicates, setPredicates] = useState([])
    const [sourcesOpen, setSourcesOpen] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [exportRange, setExportRange] = useState('viewport')
    const [exportScale, setExportScale] = useState(1)
    const [exportMessage, setExportMessage] = useState('')
    const [manualSvg, setManualSvg] = useState('')
    const [exportBusy, setExportBusy] = useState(false)
    const [picker, setPicker] = useState(null)
    const pickerTokenRef = useRef(0)
    const viewStoreRef = useRef(createViewStateStore())
    const [sharing, setSharing] = useState(false)
    const shareHandleRef = useRef(null)
    const shareUnsubscribeRef = useRef(null)
    const importedSharedRef = useRef(new Map())
    const syncingSharedRef = useRef(false)

    const runnerRef = useRef(null)
    const cameraRef = useRef({ zoom: 1, panX: 0, panY: 0, width: 900, height: 600 })
    const displaySceneRef = useRef(null)
    const revisionRef = useRef(0)
    const sourcesRef = useRef([])
    const worksetRef = useRef([])
    const statusRef = useRef('idle')
    const pendingReloadRef = useRef(null)
    const addInputRef = useRef(null)
    const composeTimerRef = useRef(0)
    const fileQueueRef = useRef(null)
    const sourceAcceptedRef = useRef(null)

    const primaryName = source.displayName || t('viewer.untitled', 'Untitled')
    const sourceLabels = useMemo(() => sourceLabelMap(sources), [sources])
    const sessionId = useMemo(() => {
      const target = workspaceFilesTarget(source.address)
      return typeof props.sessionId === 'string' && props.sessionId
        ? props.sessionId : (target ? target.sessionId : null)
    }, [source.address, props.sessionId])
    const filesApi = useMemo(() => workspaceFilesApi(props.ctx), [props.ctx])
    const filesTarget = useMemo(() => workspaceFilesTarget(source.address), [source.address])

    const publishSharedSources = useCallback(() => {
      const handle = shareHandleRef.current
      const runner = runnerRef.current
      if (!handle || !runner || syncingSharedRef.current) return
      const importedIds = new Set(Array.from(importedSharedRef.current.values()).map((item) => item.localId))
      const result = handle.replaceSources(runner.sourceSnapshots().filter((item) => !importedIds.has(item.sourceId)))
      if (!result.ok) setErrorMessage({
        key: 'workspace.rejected', fallback: 'Source not added: {reason}',
        values: { reason: String(result.reason) },
      })
    }, [t])

    const toggleSharing = useCallback(() => {
      if (sharing) {
        if (shareUnsubscribeRef.current) {
          shareUnsubscribeRef.current()
          shareUnsubscribeRef.current = null
        }
        if (shareHandleRef.current) {
          shareHandleRef.current.release()
          shareHandleRef.current = null
        }
        setSharing(false)
        return
      }
      if (!SESSION_REGISTRY || !sessionId) return
      const handle = registryAcquire(SESSION_REGISTRY, sessionId)
      shareHandleRef.current = handle
      if (!handle) return
      shareUnsubscribeRef.current = handle.subscribe((records) => {
        const runner = runnerRef.current
        if (!runner) return
        syncingSharedRef.current = true
        try {
          const remote = records.filter((record) => record.ownerId !== handle.ownerId)
          const wanted = new Set(remote.map((record) => record.sharedId))
          for (const [key, previous] of importedSharedRef.current) {
            if (!wanted.has(key)) {
              runner.dropSource(previous.localId)
              importedSharedRef.current.delete(key)
            }
          }
          for (const record of remote) {
            const previous = importedSharedRef.current.get(record.sharedId)
            if (previous && previous.snapshot === record) continue
            const localId = '\u0000shared:' + record.sharedId
            importedSharedRef.current.set(record.sharedId, { localId: localId, snapshot: record })
            runner.importSource(Object.assign({}, record, {
              sourceId: localId, replace: Boolean(previous),
            }))
            if (!runner.workspaceInfo().sources.some(item => item.sourceId === localId)) {
              importedSharedRef.current.delete(record.sharedId)
            }
          }
        } finally { syncingSharedRef.current = false }
      })
      setSharing(true)
      publishSharedSources()
    }, [sharing, sessionId, publishSharedSources])

    const loadPickerDirectory = useCallback((directory) => {
      const api = filesApi
      const target = filesTarget
      if (!api || !target) return
      pickerTokenRef.current += 1
      const token = pickerTokenRef.current
      setPicker((previous) => Object.assign({}, previous || { selected: [], entries: [] }, {
        directory: directory, loading: true, error: '',
      }))
      listWorkspaceDirectory(api, target.sessionId, directory, undefined).then((result) => {
        if (token !== pickerTokenRef.current) return
        setPicker((previous) => Object.assign({}, previous || { selected: [] }, {
          directory: directory, loading: false,
          entries: result.ok ? result.entries : [],
          truncated: result.ok ? result.truncated : false,
          error: result.ok ? '' : t('workspace.dirError', 'Cannot read this folder: {reason}')
            .replace('{reason}', String(result.reason)),
        }))
      })
    }, [filesApi, filesTarget, t])

    const openWorkspacePicker = useCallback(() => {
      const target = filesTarget
      if (!target) return
      const parts = String(target.path).split('/').filter(Boolean)
      parts.pop()
      const directory = parts.length > 0 ? parts.join('/') : '.'
      setPicker({ directory: directory, entries: [], truncated: false, loading: true, error: '', selected: [] })
      loadPickerDirectory(directory)
    }, [filesTarget, loadPickerDirectory])

    const pickerNavigate = useCallback((directory) => { loadPickerDirectory(directory) }, [loadPickerDirectory])
    const pickerUp = useCallback(() => {
      const current = picker && picker.directory ? picker.directory : '.'
      const parts = current.split('/').filter(Boolean)
      parts.pop()
      loadPickerDirectory(parts.length > 0 ? parts.join('/') : '.')
    }, [picker, loadPickerDirectory])
    const pickerToggle = useCallback((path, checked) => {
      setPicker((previous) => Object.assign({}, previous || {}, {
        selected: togglePickerSelection(previous ? previous.selected : [], path, checked),
      }))
    }, [])

    const pickerConfirm = useCallback(() => {
      const api = filesApi
      const target = filesTarget
      const runner = runnerRef.current
      const selected = picker && Array.isArray(picker.selected) ? picker.selected.slice() : []
      if (!api || !target || !runner || selected.length === 0) return
      setPicker((previous) => Object.assign({}, previous || {}, { loading: true, error: '' }))
      let index = 0
      const next = () => {
        if (index >= selected.length) {
          setPicker(null)
          return
        }
        const path = selected[index]
        index += 1
        readWorkspaceSource(api, target.sessionId, path, undefined).then((result) => {
          if (!result.ok) {
            setPicker((previous) => Object.assign({}, previous || {}, {
              loading: false,
              error: t('workspace.readError', 'Cannot read {name}: {reason}')
                .replace('{name}', String(path.split('/').pop()))
                .replace('{reason}', String(result.reason)),
            }))
            return
          }
          const name = path.split('/').filter(Boolean).pop() || path
          runner.parseSource({
            origin: 'host',
            displayName: name,
            navigationAddress: 'dsh-resource://file/session/' + target.sessionId + '/' + path,
            absolutePath: result.absolutePath || undefined,
            text: result.text,
            byteSize: result.byteSize,
          })
          setPicker((previous) => Object.assign({}, previous || {}, { selected: [] }))
          next()
        })
      }
      next()
    }, [filesApi, filesTarget, picker, t])
    const selectedNode = useMemo(() => {
      if (!graph || !selectedId) return null
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
      return nodes.find((node) => node && node.id === selectedId) || null
    }, [graph, selectedId])
    const predicateOptions = useMemo(() => (graph ? collectPredicateOptions(graph) : []), [graph])
    useEffect(() => {
      if (!graph) return
      const reconciled = reconcileWorkspaceState({
        query: treeQuery, selectedId: selectedId, anchorId: sharedAnchorId,
        filter: sharedFilter, explore: sharedExplore,
      }, graph, sources.map(source => source.sourceId))
      if (reconciled.selectedId !== selectedId) setSelectedId(reconciled.selectedId)
      if (reconciled.anchorId !== sharedAnchorId) setSharedAnchorId(reconciled.anchorId)
      if (JSON.stringify(reconciled.explore) !== JSON.stringify(sharedExplore)) setSharedExplore(reconciled.explore)
      if (JSON.stringify(reconciled.filter) !== JSON.stringify(sharedFilter)) setSharedFilter(reconciled.filter)
    }, [graph])

    const projectedGraph = useMemo(() => {
      if (!graph) return graph
      const anchor = selectedId || sharedAnchorId
      const criteria = filterCriteria(sharedFilter, anchor)
      if (sharedExplore.on) delete criteria.direction
      let result = normalizeProjectionResult(filterGraph(graph, criteria), graph)
      if (sharedExplore.on && anchor) {
        result = normalizeExploreResult(exploreNeighborhood(result,
          exploreCriteria(sharedExplore, anchor, sharedFilter)), result).graph
      }
      return result
    }, [graph, sharedFilter, sharedExplore, selectedId, sharedAnchorId])

    const scheduleCompose = useCallback(() => {
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current)
      composeTimerRef.current = setTimeout(() => {
        composeTimerRef.current = 0
        const runner = runnerRef.current
        if (!runner || (fileQueueRef.current && fileQueueRef.current.pending > 0)) return
        runner.compose({
          sourceIds: worksetRef.current.length > 0 ? worksetRef.current : undefined,
          maxNodes: PANEL_LIMITS.maxNodes,
          maxEdges: PANEL_LIMITS.maxEdges,
          maxLiteralsPerNode: PANEL_LIMITS.maxLiteralsPerNode,
          maxLiteralLength: PANEL_LIMITS.maxLiteralLength,
          layout: {
            width: cameraRef.current.width,
            height: cameraRef.current.height,
            seed: 1,
            iterations: LAYOUT_ITERATIONS,
          },
        })
      }, 0)
    }, [])

    const handleEvent = useCallback((event) => {
      if (!event || typeof event !== 'object') return
      if (event.scope === 'workspace') {
        if (event.type === 'source' && sourceAcceptedRef.current) {
          const resolve = sourceAcceptedRef.current
          sourceAcceptedRef.current = null
          resolve(event)
        }
        if (event.type === 'state') {
          statusRef.current = event.status
          setStatus(event.status)
          if (event.degraded) setDegraded(true)
          return
        }
        if (event.type === 'source') {
          if (event.status === 'rejected') {
            setExportMessage('')
            setErrorMessage({
              key: 'workspace.rejected', fallback: 'Source not added: {reason}',
              values: { reason: String(event.reason || 'budget') },
            })
            return
          }
          const summary = event.summary
          if (summary) {
            sourcesRef.current = Array.isArray(event.sources) ? event.sources : sourcesRef.current
            setSources(sourcesRef.current)
            setTotals(event.totals || { files: 0, bytes: 0, occurrences: 0 })
            statusRef.current = 'modeling'
            setStatus('modeling')
            scheduleCompose()
            publishSharedSources()
          }
          return
        }
        if (event.type === 'sources') {
          sourcesRef.current = Array.isArray(event.sources) ? event.sources : []
          setSources(sourcesRef.current)
          setTotals(event.totals || { files: 0, bytes: 0, occurrences: 0 })
          scheduleCompose()
          publishSharedSources()
          return
        }
        if (event.type === 'graph') {
          revisionRef.current += 1
          markLayoutRevision(viewStoreRef.current, revisionRef.current)
          setGraph(event.graph || null)
          setErrorMessage('')
          if (event.graph && event.graph.stats && event.graph.stats.truncation) {
            // structured truncation is rendered through the view budgets
          }
          return
        }
        if (event.type === 'layout') {
          revisionRef.current += 1
          setPositions(Array.isArray(event.positions) ? event.positions : null)
          statusRef.current = 'ready'
          setStatus('ready')
          return
        }
        if (event.type === 'error') {
          if (sourceAcceptedRef.current) {
            const resolve = sourceAcceptedRef.current
            sourceAcceptedRef.current = null
            resolve(event)
          }
          setErrorMessage(typeof event.message === 'string' ? event.message : 'error')
          statusRef.current = 'error'
          setStatus('error')
          return
        }
        return
      }
      // Non-workspace events (relayout of the composed graph).
      if (event.type === 'state') {
        statusRef.current = event.status
        setStatus(event.status)
        return
      }
      if (event.type === 'layout') {
        revisionRef.current += 1
        setPositions(Array.isArray(event.positions) ? event.positions : null)
        statusRef.current = 'ready'
        setStatus('ready')
        return
      }
      if (event.type === 'error') {
        setErrorMessage(typeof event.message === 'string' ? event.message : 'error')
        statusRef.current = 'error'
        setStatus('error')
      }
    }, [scheduleCompose, t, publishSharedSources])

    const handlerRef = useRef(handleEvent)
    handlerRef.current = handleEvent

    // One runner per input document: changing the file starts a new workspace.
    // The owner translates re-render on language change and its identity is not
    // stable, so the effect must not depend on the callback identity.
    useEffect(() => {
      if (loading || skipReason) return undefined
      if (!text || text.trim() === '') {
        statusRef.current = 'empty'
        setStatus('empty')
        return undefined
      }
      let runner = null
      try {
        runner = createOntologyRunner({
          forceMainThread: false,
          onEvent: (event) => {
            if (handlerRef.current) handlerRef.current(event)
          },
        })
        runnerRef.current = runner
        sourcesRef.current = []
        setSources([])
        setGraph(null)
        setPositions(null)
        setSelectedId(null)
        setExpandedIds([])
        setWorkset([])
        worksetRef.current = []
        setTotals({ files: 0, bytes: 0, occurrences: 0 })
        statusRef.current = 'parsing'
        setStatus('parsing')
        setDegraded(false)
        setErrorMessage('')
        revisionRef.current = 0
        runner.parseSource({
          origin: 'host',
          displayName: primaryName,
          navigationAddress: source.address || '',
          absolutePath: absolutePath,
          text: text,
          byteSize: sizeBytes,
        })
      } catch (error) {
        // A synchronous failure must be visible instead of an endless spinner.
        statusRef.current = 'error'
        setStatus('error')
        setErrorMessage('workspace start failed: ' +
          (error && error.message ? String(error.message) : String(error)))
      }
      return () => {
        if (composeTimerRef.current) {
          clearTimeout(composeTimerRef.current)
          composeTimerRef.current = 0
        }
        if (fileQueueRef.current) fileQueueRef.current.invalidate()
        if (sourceAcceptedRef.current) { sourceAcceptedRef.current(); sourceAcceptedRef.current = null }
        if (runner) runner.dispose()
        runnerRef.current = null
      }
    }, [text, source.address, absolutePath, loading, skipReason, primaryName, sizeBytes])

    if (!fileQueueRef.current) {
      fileQueueRef.current = createFileReadQueue({
        maxBytes: 12 * 1024 * 1024,
        accept: ({ file, text: fileText, byteSize, replacementId }) => new Promise((resolve) => {
          const runner = runnerRef.current
          if (!runner) { resolve(); return }
          sourceAcceptedRef.current = resolve
          runner.parseSource({
            origin: 'browser', displayName: typeof file.name === 'string' ? file.name : 'file',
            sourceId: replacementId, replace: Boolean(replacementId),
            text: fileText, byteSize: byteSize,
          })
        }),
        onError: (file, reason) => {
          if (handlerRef.current) handlerRef.current({ scope: 'workspace', type: 'source', status: 'rejected',
            reason: String(file && file.name || 'file') + ': ' + reason })
        },
        onIdle: scheduleCompose,
      })
    }
    const addFiles = useCallback((files) => {
      if (runnerRef.current && fileQueueRef.current) fileQueueRef.current.enqueue(files)
    }, [])

    useEffect(() => () => {
      if (shareUnsubscribeRef.current) {
        shareUnsubscribeRef.current()
        shareUnsubscribeRef.current = null
      }
      if (shareHandleRef.current) {
        shareHandleRef.current.release()
        shareHandleRef.current = null
      }
      importedSharedRef.current.clear()
      setSharing(false)
    }, [sessionId])

    const handleAddInput = useCallback((event) => {
      const files = event.target.files ? Array.from(event.target.files) : []
      event.target.value = ''
      const pending = pendingReloadRef.current
      pendingReloadRef.current = null
      if (pending && files.length > 0) {
        if (fileQueueRef.current) fileQueueRef.current.enqueue([files[0]], pending)
        return
      }
      addFiles(files)
    }, [addFiles])

    const requestReload = useCallback((sourceId) => {
      pendingReloadRef.current = sourceId
      if (addInputRef.current) addInputRef.current.click()
    }, [])

    const removeSource = useCallback((sourceId) => {
      if (runnerRef.current) runnerRef.current.dropSource(sourceId)
      setSelectedId(null)
      setExpandedIds([])
    }, [])

    const setWorksetIds = useCallback((next) => {
      const list = Array.isArray(next) ? next : []
      worksetRef.current = list
      setWorkset(list)
      scheduleCompose()
    }, [scheduleCompose])

    const setWorkspaceSelection = useCallback((id) => {
      setSelectedId(id)
      setSharedAnchorId(id)
    }, [])

    const setWorkspaceFilter = useCallback((next) => {
      setSharedFilter(normalizeFilterState(next))
    }, [])

    const setWorkspaceExplore = useCallback((next) => {
      setSharedExplore(createExploreState(next))
    }, [])

    const switchView = useCallback((next) => {
      const store = viewStoreRef.current
      snapshotView(store, viewType, {
        expandedIds: expandedIds,
        orientation: orientation,
        predicates: predicates,
        camera: Object.assign({}, cameraRef.current),
      })
      setViewType(next)
      const saved = viewSnapshot(store, next)
      if (Array.isArray(saved.expandedIds)) setExpandedIds(saved.expandedIds)
      if (saved.orientation === 'down' || saved.orientation === 'right') setOrientation(saved.orientation)
      if (Array.isArray(saved.predicates)) setPredicates(saved.predicates)
      if (saved.camera && typeof saved.camera === 'object') {
        cameraRef.current = Object.assign({}, cameraRef.current, saved.camera)
      }
    }, [viewType, treeQuery, expandedIds, orientation, predicates])

    const onRelayout = useCallback((seed) => {
      const runner = runnerRef.current
      if (!runner) return
      runner.relayout({
        width: cameraRef.current.width,
        height: cameraRef.current.height,
        seed: typeof seed === 'number' && seed > 0 ? seed : revisionRef.current + 1,
        iterations: LAYOUT_ITERATIONS,
      })
    }, [])

    const themeForExport = useCallback(() => ({
      background: readThemeToken('--dsw-alias-bg-layer-1', '#ffffff'),
      node: readThemeToken('--dsw-alias-brand-primary', '#4f6bed'),
      nodeText: readThemeToken('--dsw-alias-label-primary', '#1f2430'),
      edge: readThemeToken('--dsw-alias-border-l1', '#9aa3b2'),
      edgeText: readThemeToken('--dsw-alias-label-secondary', '#6b6b76'),
      group: readThemeToken('--dsw-alias-brand-primary', '#7c5cd6'),
    }), [])

    const buildScene = useCallback((range) => {
      if (!graph || statusRef.current !== 'ready') return { ok: false, reason: 'no-graph' }
      if (viewType === 'tree') {
        const hierarchy = buildHierarchy(projectedGraph, { mode: treeMode })
        const expanded = expandHierarchy(hierarchy, {
          expandedIds: expandedIds,
          maxRefs: 1200,
          maxDepth: 12,
        })
        const rows = filterTreeRows(expanded.refs, hierarchy, treeSearchPlan(hierarchy, treeQuery))
        return { ok: true, scene: buildTreeScene(rows, {
          revision: revisionRef.current,
          theme: themeForExport(),
          meta: { sources: sourcesRef.current.length },
        }) }
      }
      if (viewType === 'layered') {
        const layout = layoutLayeredGraph(projectedGraph, {
          predicates: predicates.length > 0 ? predicates : undefined,
          orientation: orientation,
          width: cameraRef.current.width || 900,
          height: cameraRef.current.height || 560,
        })
        return { ok: true, scene: buildLayeredScene(layout, {
          revision: revisionRef.current,
          theme: themeForExport(),
          meta: { sources: sourcesRef.current.length },
        }) }
      }
      if (!Array.isArray(positions) || positions.length === 0) return { ok: false, reason: 'no-layout' }
      const camera = cameraRef.current
      const displayed = displaySceneRef.current
      if (!displayedSceneReady(displayed, graph)) return { ok: false, reason: 'stale-layout' }
      return {
        ok: true,
        scene: buildNetworkScene({
          nodes: displayed.nodes,
          edges: displayed.edges,
          positions: displayed.positions,
          labels: displayed.labels,
          camera: camera,
          viewport: { width: camera.width, height: camera.height },
          range: range,
          revision: revisionRef.current,
          theme: themeForExport(),
          meta: { sources: sourcesRef.current.length },
        }),
      }
    }, [graph, projectedGraph, positions, viewType, treeMode, treeQuery, expandedIds, predicates, orientation, themeForExport])

    const handleCopySvg = useCallback(() => {
      const built = buildScene(exportRange)
      if (!built.ok) {
        setExportMessage({ key: 'export.blocked', fallback: 'Nothing to export yet: wait for the layout to finish.' })
        return
      }
      const ready = exportSceneReady(built.scene, revisionRef.current)
      if (!ready.ok) {
        setExportMessage({ key: 'export.blocked', fallback: 'Nothing to export yet: wait for the layout to finish.' })
        return
      }
      const svg = renderSceneSvg(built.scene)
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          setManualSvg('')
          Promise.resolve(navigator.clipboard.writeText(svg)).then(() => {
            setExportMessage({ key: 'export.copied', fallback: 'SVG copied to the clipboard.' })
          }, () => {
            setExportMessage({ key: 'export.copyFailed', fallback: 'Clipboard unavailable; export the SVG file instead.' })
            setManualSvg(svg)
          })
          return
        }
      } catch (error) {
        // fall through to the failure message
      }
      setExportMessage({ key: 'export.copyFailed', fallback: 'Clipboard unavailable; export the SVG file instead.' })
      setManualSvg(svg)
    }, [buildScene, exportRange, t])

    const handleExport = useCallback((format) => {
      const built = buildScene(exportRange)
      if (!built.ok) {
        setExportMessage({ key: 'export.blocked', fallback: 'Nothing to export yet: wait for the layout to finish.' })
        return
      }
      const ready = exportSceneReady(built.scene, revisionRef.current)
      if (!ready.ok) {
        setExportMessage({ key: 'export.blocked', fallback: 'Nothing to export yet: wait for the layout to finish.' })
        return
      }
      const svg = renderSceneSvg(built.scene)
      const baseName = (primaryName || 'ontology').replace(/[^\w.-]+/g, '_')
      if (format === 'svg') {
        const result = downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), baseName + '.svg')
        setExportMessage(result.ok
          ? { key: 'export.started', fallback: 'Download started. Browsers do not report whether the file was saved.' }
          : { key: 'export.failed', fallback: 'Download failed: {reason}', values: { reason: String(result.reason) } })
        return
      }
      const plan = planPngExport(built.scene, { scale: exportScale })
      if (!plan.ok) {
        setExportMessage(plan.reason === 'max-side' || plan.reason === 'max-pixels'
          ? { key: 'export.tooLarge', fallback: 'This view is too large for PNG at that scale; lower the scale or export SVG.' }
          : { key: 'export.failed', fallback: 'Download failed: {reason}', values: { reason: String(plan.reason) } })
        return
      }
      setExportBusy(true)
      rasterizePng(svg, plan, null).then((result) => {
        setExportBusy(false)
        if (!result.ok) {
          setExportMessage({
            key: 'export.pngFallback', fallback: 'PNG failed ({reason}); exported SVG instead.',
            values: { reason: String(result.reason) },
          })
          const fallback = downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), baseName + '.svg')
          if (!fallback.ok) {
            setExportMessage({ key: 'export.failed', fallback: 'Download failed: {reason}', values: { reason: String(fallback.reason) } })
          }
          return
        }
        const download = downloadBlob(result.blob, baseName + '.png')
        setExportMessage(download.ok
          ? { key: 'export.started', fallback: 'Download started. Browsers do not report whether the file was saved.' }
          : { key: 'export.failed', fallback: 'Download failed: {reason}', values: { reason: String(download.reason) } })
      }).catch((error) => {
        setExportBusy(false)
        setExportMessage({
          key: 'export.failed', fallback: 'Download failed: {reason}',
          values: { reason: error && error.message ? String(error.message) : 'png' },
        })
      })
    }, [buildScene, exportRange, exportScale, primaryName, t])

    // --- status screens (kept identical to the single-file contract) --------
    const styleHost = {
      height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    }
    function centerScreen(state, message, hint) {
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, height: '100%', minHeight: 160, padding: 24,
          color: 'var(--dsw-alias-label-secondary, #6b6b76)', fontSize: 13,
          fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)', textAlign: 'center',
          boxSizing: 'border-box',
        },
        'data-ontology-state': state,
      },
      h('div', { style: { lineHeight: 1.6, maxWidth: 420 } }, message),
      hint ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8a8a94)', maxWidth: 420 } }, hint) : null)
    }

    if (skipReason === 'tooLarge') {
      const surface = source.surface || 'preview'
      return centerScreen('too-large',
        surface === 'sidebar'
          ? t('state.tooLargeSidebar', '')
          : t('state.tooLargePreview', ''),
        fillTemplate(t('state.tooLarge', ''), { size: limitBytes > 0 ? Math.round(limitBytes / (1024 * 1024)) + ' MiB' : '12 MiB' }))
    }
    if (loading || status === 'idle') {
      return centerScreen('loading', t('state.loading', 'Loading…'))
    }
    if (status === 'empty') {
      return centerScreen('empty', t('state.empty', 'No drawable triples.'))
    }
    if (status === 'error') {
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8, height: '100%', padding: 16,
          color: 'var(--dsw-alias-label-secondary, #6b6b76)', fontSize: 13,
          fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
          boxSizing: 'border-box',
        },
        'data-ontology-state': 'error',
      },
      h('div', { style: { lineHeight: 1.6 } }, t('state.error', 'Parse failed')),
      h('pre', {
        style: {
          maxWidth: '100%', maxHeight: 180, overflow: 'auto', margin: 0, padding: 8, borderRadius: 6,
          fontSize: 12, background: 'var(--dsw-alias-bg-layer-2, #f4f4f6)',
          color: 'var(--dsw-alias-label-secondary, #6b6b76)', whiteSpace: 'pre-wrap',
        },
      }, messageText(errorMessage)))
    }
    const busy = status === 'parsing' || status === 'modeling' || status === 'layout'
    if (busy && !graph) {
      const label = status === 'layout' ? t('state.layout', 'Computing layout…')
        : status === 'modeling' ? t('state.modeling', 'Building the graph…')
          : t('state.parsing', 'Parsing RDF…')
      return centerScreen(status, label)
    }
    if (!graph) return centerScreen('empty', t('state.empty', 'No drawable triples.'))

    const surfaceLimit = source.surface === 'sidebar'
      ? { kind: 'surface', bytes: limitBytes, surface: 'sidebar' }
      : { kind: 'plugin', bytes: limitBytes, surface: 'preview' }
    const issues = Array.isArray(graph.warnings) ? graph.warnings : []
    const diagnostics = aggregateDiagnostics(sources)
    const budgets = budgetsFrom(sources, graph)

    let content = null
    if (viewType === 'tree') {
      content = h(Multiview.ClassTreeView, {
        tr: t,
        graph: projectedGraph,
        mode: treeMode,
        onMode: setTreeMode,
        query: treeQuery,
        onQuery: setTreeQuery,
        selectedId: selectedId,
        onSelect: setWorkspaceSelection,
        expandedIds: expandedIds,
        onToggle: (entityId) => setExpandedIds((previous) => toggleExpandedList(previous, entityId)),
        exploreRootNotClass: exploreRootNotClass(graph, sharedAnchorId, sharedExplore.on),
        narrow: false,
      })
    } else if (viewType === 'layered') {
      content = h(Multiview.LayeredView, {
        tr: t,
        graph: projectedGraph,
        orientation: orientation,
        onOrientation: setOrientation,
        predicates: predicates,
        predicateOptions: predicateOptions,
        onPredicates: setPredicates,
        selectedId: selectedId,
        onSelect: setWorkspaceSelection,
        width: cameraRef.current.width,
        height: cameraRef.current.height,
        narrow: false,
      })
    } else {
      content = h(OntologyGraphView, {
        graph: graph,
        t: t,
        sourceName: sources.length > 1
          ? t('workspace.unionName', '{n} sources').replace('{n}', String(sources.length))
          : primaryName,
        issues: issues,
        diagnostics: diagnostics,
        budgets: budgets,
        positions: positions,
        layoutStatus: status,
        degraded: degraded,
        surfaceLimit: surfaceLimit,
        onRelayout: onRelayout,
        cameraRef: cameraRef,
        displaySceneRef: displaySceneRef,
        selectedId: selectedId,
        onSelectNode: setWorkspaceSelection,
        sourceLabels: sourceLabels,
        searchQuery: treeQuery,
        onSearchQuery: setTreeQuery,
        filterState: sharedFilter,
        onFilterState: setWorkspaceFilter,
        exploreState: sharedExplore,
        onExploreState: setWorkspaceExplore,
        workspaceManaged: true,
      })
    }

    return h('div', Object.assign({}, props.hostProps || {}, {
      style: styleHost,
      'data-ontology-state': 'ready',
      'data-ontology-view': viewType,
      onDragOver: (event) => {
        if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault()
      },
      onDrop: (event) => {
        const files = event.dataTransfer && event.dataTransfer.files
        if (!files || files.length === 0) return
        event.preventDefault()
        addFiles(Array.from(files))
      },
    }),
    h('input', {
      ref: addInputRef,
      type: 'file',
      multiple: false,
      style: { display: 'none' },
      onChange: handleAddInput,
    }),
    h(Multiview.WorkspaceToolbar, {
      tr: t,
      viewType: viewType,
      onViewType: switchView,
      selectedLabel: selectedNode ? (selectedNode.label || selectedNode.local || selectedNode.id) : '',
      sourceCount: sources.length,
      sourcesOpen: sourcesOpen,
      onToggleSources: () => setSourcesOpen((previous) => !previous),
      exportOpen: exportOpen,
      onToggleExport: () => setExportOpen((previous) => !previous),
    }),
    sourcesOpen ? h(Multiview.SourcePanel, {
      tr: t,
      sources: sources,
      totals: totals,
      worksetIds: workset,
      onSetWorkset: setWorksetIds,
      onAddFiles: addFiles,
      onRequestReload: requestReload,
      onRemove: removeSource,
      onClose: () => setSourcesOpen(false),
      workspaceFilesAvailable: Boolean(filesApi && filesTarget),
      onPickWorkspaceFiles: openWorkspacePicker,
      sharing: sharing,
      sharingAvailable: Boolean(sessionId),
      onToggleSharing: toggleSharing,
    }) : null,
    exportOpen ? h(Multiview.ExportMenu, {
      tr: t,
      range: exportRange,
      onRange: setExportRange,
      scale: exportScale,
      onScale: setExportScale,
      onExport: handleExport,
      onCopySvg: handleCopySvg,
      message: exportMessage ? messageText(exportMessage) : '',
      svgText: manualSvg,
      busy: exportBusy,
    }) : null,
    h('div', {
      style: { position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex' },
    },
    content,
    (viewType !== 'network' && selectedNode) ? h(Multiview.ProvenancePanel, {
      tr: t,
      node: selectedNode,
      graph: graph,
      sourceLabels: sourceLabels,
      onSelect: setSelectedId,
      onClose: () => setSelectedId(null),
    }) : null,
    picker ? h(Multiview.WorkspaceFilePicker, {
      tr: t,
      state: picker,
      busy: Boolean(picker.loading),
      onNavigate: pickerNavigate,
      onUp: pickerUp,
      onToggle: pickerToggle,
      onConfirm: pickerConfirm,
      onClose: () => setPicker(null),
    }) : null),
    busy ? h('div', {
      role: 'status',
      'aria-live': 'polite',
      style: {
        position: 'absolute', right: 10, bottom: 8, fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, #6b6b76)',
      },
    }, t('state.layout', 'Computing layout…')) : null)
  }

  return { OntologyWorkspacePanel: OntologyWorkspacePanel, clearSharedWorkspaces: clearSharedWorkspaces }
}
