/**
 * Plugin entry: wires the parser + graph surface into two DSH extension points.
 *
 * 1. `ctx.documentPreviews` + the keyed slot `sidebar.right.tab.document`:
 *    DSH's own right-sidebar file preview. Any `.ttl/.owl/.rdf/.jsonld/.nt/...`
 *    file opened from the Files tab renders as a graph, with the host's plain
 *    text renderer still selectable in the preview's viewer dropdown.
 * 2. `ctx.betterSidebar` (optional, when dsh-better-sidebar is installed):
 *    a file viewer + file icon for the same extensions, so clicking one of
 *    those files in the better-sidebar file tree opens the graph tab.
 *
 * Both surfaces share `OntologyPanel`, which runs one background computation
 * job (parse -> model -> layout) and hands the result to the React view.
 */

/** Implementation id: the document-preview key and the tab dropdown label owner. */
const DOCUMENT_ID = 'dsh-ontology-viewer/graph'
/** better-sidebar viewer + file-icon ids (its own registry namespace). */
const VIEWER_ID = 'dsh-ontology-viewer'
const ICON_ID = 'dsh-ontology-viewer/icons'
/** Locale namespace shared by every string this plugin renders. */
const LOCALE_NS = 'dshOntology'

/** Extensions claimed on both surfaces (lowercase, no leading dot). */
const ONTOLOGY_EXTENSIONS = ['ttl', 'turtle', 'owl', 'rdf', 'rdfxml', 'jsonld', 'nt', 'n3', 'nq', 'trig']

/** Plugin parse ceiling. Above this the browser parse is refused with an explanation. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024
/** better-sidebar only hands over files below its own editable threshold. */
const SURFACE_SIDEBAR_BYTES = 5 * 1024 * 1024

/** Default budgets; the compute job may tighten them in degraded mode. */
const LIMITS = {
  maxTriples: 120000,
  maxNodes: 1500,
  maxEdges: 6000,
  maxLiteralsPerNode: 60,
  maxLiteralLength: 16384,
  maxDepth: 256,
}
const LAYOUT_ITERATIONS = 320

/** Built once per Client module load; the component identity must stay stable. */
const GRAPH_VIEW = createOntologyGraphView(React).OntologyGraphView

const ZH = {
  // surfaces / titles
  'viewer.title': '本体图谱',
  'viewer.name': '本体图谱查看器',
  // loading + state screens owned by this file
  'state.loading': '正在读取文件…',
  'state.parsing': '正在解析 RDF…',
  'state.modeling': '正在构建图谱…',
  'state.layout': '正在计算布局…',
  'state.empty': '这个文件里没有可画成图谱的三元组。',
  'state.tooLarge': '文件过大，暂不解析（上限 {size}）。',
  'state.tooLargePreview': '文件过大，暂不解析（原生预览上限 12 MiB）。',
  'state.tooLargeSidebar': '文件超出 better-sidebar 的 5 MiB 读取上限，无法在此入口显示图谱。',
  'state.error': '解析失败',
  'state.degraded': '性能降级模式：后台计算不可用，已降低解析与显示上限。',
  // graph view chrome
  'viewer.untitled': '未命名',
  'viewer.truncated': '输入已截断',
  'viewer.nodes': '节点',
  'viewer.edges': '边',
  'viewer.triples': '三元组',
  'viewer.searchPlaceholder': '搜索标签或 IRI',
  'viewer.results': '{n} 个结果',
  'viewer.clearSearch': '清除搜索',
  'viewer.noResults': '没有匹配结果',
  'viewer.labels': '标签',
  'viewer.focus': '只看选中节点周围',
  'viewer.relayout': '重新布局',
  'viewer.zoomIn': '放大',
  'viewer.zoomOut': '缩小',
  'viewer.fit': '适配视图',
  'viewer.focusBadge': '仅显示选中节点周围（{n} 个节点）',
  'viewer.hint': '拖拽画布平移 · 滚轮缩放 · 点击节点查看详情',
  'viewer.emptyTitle': '暂无可视化节点',
  'viewer.emptyHint': '这个文件没有可绘制的 RDF 三元组。',
  'viewer.issues': '解析提示',
  'viewer.details': '详情',
  'viewer.closePanel': '关闭详情',
  'viewer.iri': 'IRI',
  'viewer.copy': '复制',
  'viewer.copied': '已复制',
  'viewer.copyFailed': '复制失败',
  'viewer.types': '类型',
  'viewer.noTypes': '没有 rdf:type 信息',
  'viewer.literals': '字面量属性',
  'viewer.noLiterals': '没有字面量属性',
  'viewer.structure': '连接',
  'viewer.outEdges': '出边',
  'viewer.inEdges': '入边',
  'viewer.degree': '度数',
  'viewer.kind.class': '类',
  'viewer.kind.property': '属性',
  'viewer.kind.individual': '个体',
  'viewer.kind.blank': '空白节点',
  'viewer.kind.external': '外部引用',
  // filters
  'viewer.filters': '过滤',
  'viewer.filterKinds': '节点类型',
  'viewer.filterPredicates': '关系类型',
  'viewer.filterDirection': '关系方向',
  'viewer.direction.both': '双向',
  'viewer.direction.out': '出边',
  'viewer.direction.in': '入边',
  'viewer.filterDirectionNoAnchor': '选择节点后才能过滤方向',
  'viewer.clearFilters': '清除过滤',
  'viewer.filteredEmpty': '当前过滤条件下没有可显示的节点。',
  'viewer.visible': '可见',
  'viewer.total': '总数',
  'viewer.hiddenSelection': '当前选择被过滤隐藏',
  'viewer.locateSelection': '定位选择',
  'viewer.showAll': '显示全部',
  // exploration
  'viewer.explore': '邻域探索',
  'viewer.exploreDepth': '跳数',
  'viewer.exploreStart': '展开邻域',
  'viewer.exploreStop': '回到完整视图',
  'viewer.exploreNeedsSelection': '请先选择一个节点',
  'viewer.exploreExpanded': '已展开 {shown} / {total}',
  'viewer.exploreMore': '继续展开',
  'viewer.exploreRootChanged': '探索根已切换为当前选择',
  'viewer.exploreTruncated': '邻域展开已达到预算上限',
  'viewer.hops': '{n} 跳',
  'viewer.close': '关闭',
  'viewer.computing': '正在计算布局…',
  'viewer.detailsConnections': '关系',
  'viewer.diagnosticsErrors': '错误',
  'viewer.diagnosticsWarnings': '警告',
  'viewer.drawnEdges': '已绘制 {drawn} / 共 {total} 条边',
  'viewer.exploreRoot': '探索根',
  'viewer.exploreSummary': '已展开 {nodes} 个节点 / {edges} 条边',
  'viewer.filterAnchorKept': '锚点节点始终保留',
  'viewer.filterDirectionInExplore': '探索模式按跳应用方向；过滤面板的方向用于 1 跳视图',
  'viewer.filterEdgeCount': '{n} 条边',
  'viewer.filterKindsHint': '未选择任何类型时显示全部',
  'viewer.filterNoPredicates': '没有可用的关系谓词',
  'viewer.filterPredicatesHint': '按关系类型过滤',
  'viewer.layoutErrorHint': '布局计算失败，可尝试重新布局',
  'viewer.layoutErrorTitle': '布局不可用',
  'viewer.literalValueTruncated': '值已截断',
  'viewer.maxHops': '最多 {n} 跳',
  'viewer.noDrawableHint': '这个文件没有可绘制的 RDF 三元组。',
  'viewer.noDrawableTitle': '暂无可视化节点',
  'viewer.noRelations': '没有关系',
  'viewer.noticeDismiss': '关闭提示',
  'viewer.sourceUnavailable': '无可用资源地址',
  'viewer.surfaceLimit': '此入口上限 {size}',
  'viewer.truncationReason': '原因：{reason}',
  // truncation / diagnostics
  'viewer.truncation': '显示裁剪',
  'viewer.truncationParse': '解析已截断：保留 {kept} / 上限 {limit} 条三元组',
  'viewer.truncationNodes': '图谱裁剪：保留 {kept} / 共 {total} 个节点',
  'viewer.truncationLiterals': '字面量裁剪：{n} 个节点超出每节点上限',
  'viewer.truncationEdges': '绘制裁剪：已绘制 {kept} / 共 {total} 条边',
  'viewer.truncationExplore': '邻域展开裁剪：已展开 {kept} / 共 {total}',
  'viewer.diagnostics': '诊断',
  'viewer.diagnosticsMore': '还有 {n} 条未显示',
  'viewer.degraded': '性能降级模式',
  'viewer.literalsTruncated': '已显示 {kept} / 共 {total}',
  'viewer.relationsHidden': '未在画布绘制',
  'viewer.showMore': '显示更多',
  'viewer.sourceReserved': '源文件定位（预留）',
  // kind group labels
  'viewer.group.type': '类型',
  'viewer.group.literals': '字面量',
  'viewer.group.out': '出边',
  'viewer.group.in': '入边',
  // diagnostics codes
  'diag.base-unavailable': '相对 IRI 缺少可用 Base',
  'diag.named-graph-ignored': '命名图被忽略',
  'diag.jsonld-remote-context-skipped': '远程 JSON-LD 上下文未加载',
  'diag.jsonld-node-reverse-ignored': '节点级 @reverse 未展开',
  'diag.jsonld-included-nest-ignored': '@included / @nest 未展开',
  'diag.jsonld-value-object-dropped': '值对象节点被忽略',
  'diag.jsonld-graph-sibling-ignored': '@graph 兄弟键被保留',
  'diag.jsonld-container-unsupported': '不支持的 @container',
  'diag.jsonld-reverse-term-forward': '反向属性按正向展开',
  'diag.rdfxml-reification-ignored': 'RDF/XML 具体化未实现',
  'diag.rdfxml-parsetype-unsupported': '不支持的 rdf:parseType',
  'diag.rdfxml-multiple-objects': '属性元素只取第一个对象',
  'diag.nesting-limit': '嵌套深度超过上限',
  'diag.literal-limit': '字面量超过长度上限',
  'diag.triple-limit': '三元组达到上限',
  'diag.diagnostics-truncated': '诊断条数超过上限',
}

const EN = {
  'viewer.title': 'Ontology graph',
  'viewer.name': 'Ontology Graph Viewer',
  'state.loading': 'Reading file…',
  'state.parsing': 'Parsing RDF…',
  'state.modeling': 'Building graph…',
  'state.layout': 'Computing layout…',
  'state.empty': 'This file has no triples to draw as a graph.',
  'state.tooLarge': 'File is too large to parse here (limit {size}).',
  'state.tooLargePreview': 'File is too large to parse here (preview limit 12 MiB).',
  'state.tooLargeSidebar': 'File exceeds the better-sidebar 5 MiB read limit; the graph cannot be shown here.',
  'state.error': 'Parse failed',
  'state.degraded': 'Degraded performance mode: background compute is unavailable, so parse and display limits were lowered.',
  'viewer.untitled': 'Untitled',
  'viewer.truncated': 'Input truncated',
  'viewer.nodes': 'nodes',
  'viewer.edges': 'edges',
  'viewer.triples': 'triples',
  'viewer.searchPlaceholder': 'Search label or IRI',
  'viewer.results': '{n} results',
  'viewer.clearSearch': 'Clear search',
  'viewer.noResults': 'No matching nodes',
  'viewer.labels': 'Labels',
  'viewer.focus': 'Selection only',
  'viewer.relayout': 'Re-layout',
  'viewer.zoomIn': 'Zoom in',
  'viewer.zoomOut': 'Zoom out',
  'viewer.fit': 'Fit view',
  'viewer.focusBadge': 'Showing only the selected node\u2019s neighbourhood ({n} nodes)',
  'viewer.hint': 'Drag the canvas to pan · scroll to zoom · click a node for details',
  'viewer.emptyTitle': 'Nothing to draw',
  'viewer.emptyHint': 'This file has no RDF triples that can be drawn as a graph.',
  'viewer.issues': 'Parse notes',
  'viewer.details': 'Details',
  'viewer.closePanel': 'Close details',
  'viewer.iri': 'IRI',
  'viewer.copy': 'Copy',
  'viewer.copied': 'Copied',
  'viewer.copyFailed': 'Copy failed',
  'viewer.types': 'Types',
  'viewer.noTypes': 'No rdf:type asserted',
  'viewer.literals': 'Literal properties',
  'viewer.noLiterals': 'No literal properties',
  'viewer.structure': 'Connections',
  'viewer.outEdges': 'outgoing',
  'viewer.inEdges': 'incoming',
  'viewer.degree': 'degree',
  'viewer.kind.class': 'Class',
  'viewer.kind.property': 'Property',
  'viewer.kind.individual': 'Individual',
  'viewer.kind.blank': 'Blank node',
  'viewer.kind.external': 'External',
  'viewer.filters': 'Filters',
  'viewer.filterKinds': 'Node types',
  'viewer.filterPredicates': 'Relations',
  'viewer.filterDirection': 'Direction',
  'viewer.direction.both': 'Both',
  'viewer.direction.out': 'Outgoing',
  'viewer.direction.in': 'Incoming',
  'viewer.filterDirectionNoAnchor': 'Select a node to filter by direction',
  'viewer.clearFilters': 'Clear filters',
  'viewer.filteredEmpty': 'No nodes are visible under the current filters.',
  'viewer.visible': 'visible',
  'viewer.total': 'total',
  'viewer.hiddenSelection': 'The current selection is hidden by filters',
  'viewer.locateSelection': 'Locate selection',
  'viewer.showAll': 'Show all',
  'viewer.explore': 'Neighbourhood',
  'viewer.exploreDepth': 'Hops',
  'viewer.exploreStart': 'Explore',
  'viewer.exploreStop': 'Back to full graph',
  'viewer.exploreNeedsSelection': 'Select a node first',
  'viewer.exploreExpanded': 'Expanded {shown} / {total}',
  'viewer.exploreMore': 'Expand more',
  'viewer.exploreRootChanged': 'Exploration root switched to the current selection',
  'viewer.exploreTruncated': 'Neighbourhood expansion reached its budget',
  'viewer.hops': '{n} hops',
  'viewer.close': 'Close',
  'viewer.computing': 'Computing layout…',
  'viewer.detailsConnections': 'Relations',
  'viewer.diagnosticsErrors': 'Errors',
  'viewer.diagnosticsWarnings': 'Warnings',
  'viewer.drawnEdges': '{drawn} / {total} edges drawn',
  'viewer.exploreRoot': 'Exploration root',
  'viewer.exploreSummary': 'Expanded {nodes} nodes / {edges} edges',
  'viewer.filterAnchorKept': 'The anchor node is always kept',
  'viewer.filterDirectionInExplore': 'Direction applies per hop while exploring; the filter direction applies to the 1-hop view',
  'viewer.filterEdgeCount': '{n} edges',
  'viewer.filterKindsHint': 'No type selected means all types',
  'viewer.filterNoPredicates': 'No relation predicates available',
  'viewer.filterPredicatesHint': 'Filter by relation type',
  'viewer.layoutErrorHint': 'Layout failed; try re-layout',
  'viewer.layoutErrorTitle': 'Layout unavailable',
  'viewer.literalValueTruncated': 'value truncated',
  'viewer.maxHops': 'up to {n} hops',
  'viewer.noDrawableHint': 'This file has no RDF triples that can be drawn as a graph.',
  'viewer.noDrawableTitle': 'Nothing to draw',
  'viewer.noRelations': 'No relations',
  'viewer.noticeDismiss': 'Dismiss notice',
  'viewer.sourceUnavailable': 'No usable resource address',
  'viewer.surfaceLimit': 'This entry allows {size}',
  'viewer.truncationReason': 'Reason: {reason}',
  'viewer.truncation': 'Display trimming',
  'viewer.truncationParse': 'Parse truncated: kept {kept} / limit {limit} triples',
  'viewer.truncationNodes': 'Graph trimmed: kept {kept} / {total} nodes',
  'viewer.truncationLiterals': 'Literals trimmed: {n} nodes exceed the per-node limit',
  'viewer.truncationEdges': 'Draw trimmed: {kept} / {total} edges drawn',
  'viewer.truncationExplore': 'Neighbourhood trimmed: expanded {kept} / {total}',
  'viewer.diagnostics': 'Diagnostics',
  'viewer.diagnosticsMore': '{n} more not shown',
  'viewer.degraded': 'Degraded performance mode',
  'viewer.literalsTruncated': 'Showing {kept} / {total}',
  'viewer.relationsHidden': 'not drawn',
  'viewer.showMore': 'Show more',
  'viewer.sourceReserved': 'Source location (reserved)',
  'viewer.group.type': 'Types',
  'viewer.group.literals': 'Literals',
  'viewer.group.out': 'Outgoing',
  'viewer.group.in': 'Incoming',
  'diag.base-unavailable': 'Relative IRI has no usable base',
  'diag.named-graph-ignored': 'Named graph ignored',
  'diag.jsonld-remote-context-skipped': 'Remote JSON-LD context skipped',
  'diag.jsonld-node-reverse-ignored': 'Node-level @reverse skipped',
  'diag.jsonld-included-nest-ignored': '@included / @nest skipped',
  'diag.jsonld-value-object-dropped': 'Value object node ignored',
  'diag.jsonld-graph-sibling-ignored': '@graph sibling keys preserved',
  'diag.jsonld-container-unsupported': 'Unsupported @container',
  'diag.jsonld-reverse-term-forward': 'Reverse term expanded forward',
  'diag.rdfxml-reification-ignored': 'RDF/XML reification not implemented',
  'diag.rdfxml-parsetype-unsupported': 'Unsupported rdf:parseType',
  'diag.rdfxml-multiple-objects': 'Only the first object of a property was used',
  'diag.nesting-limit': 'Nesting depth limit reached',
  'diag.literal-limit': 'Literal exceeds the length limit',
  'diag.triple-limit': 'Triple limit reached',
  'diag.diagnostics-truncated': 'Too many diagnostics',
}

/**
 * Translate through the host locale registry, re-rendering on language change.
 * @param ctx - any context owning the `locale` service.
 * @returns a `(key, fallback?) => string` lookup; the view passes its own
 * Chinese fallback so an unregistered key still reads correctly.
 */
function useTranslation(ctx) {
  const [, setTick] = React.useReducer((value) => value + 1, 0)
  React.useEffect(() => {
    if (!ctx || !ctx.locale || typeof ctx.locale.subscribe !== 'function') return undefined
    const dispose = ctx.locale.subscribe(() => setTick())
    return typeof dispose === 'function' ? dispose : undefined
  }, [ctx])
  return function translate(key, fallback) {
    let localized
    if (ctx && ctx.locale && typeof ctx.locale.bind === 'function') {
      try {
        localized = ctx.locale.bind(LOCALE_NS)(key)
      } catch {
        // the locale service may still be loading; fall through to the dictionaries
      }
    }
    if (typeof localized === 'string' && localized.length > 0 && localized !== key) return localized
    if (typeof ZH[key] === 'string') return ZH[key]
    if (typeof EN[key] === 'string') return EN[key]
    return typeof fallback === 'string' && fallback.length > 0 ? fallback : key
  }
}

/** Locale of the current page, used to pick the dictionary before the service answers. */
function detectChinese(ctx) {
  try {
    const snapshot = ctx && ctx.locale ? ctx.locale.getLocale() : undefined
    const id = snapshot && typeof snapshot === 'object' ? String(snapshot.id ?? snapshot.locale ?? '') : String(snapshot ?? '')
    return id.toLowerCase().startsWith('zh')
  } catch {
    return true
  }
}

/** A stable, human-readable file name for a resource address, when one can be derived. */
function fileNameOf(address) {
  if (typeof address !== 'string' || !address) return ''
  try {
    const cleaned = address.split(/[?#]/)[0]
    const tail = cleaned.replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
    return decodeURIComponent(tail)
  } catch {
    return String(address).replace(/\\/g, '/').split('/').pop() || ''
  }
}

/** UTF-8 byte length of a string; the host limit is a byte budget, not code units. */
function byteLengthOf(text) {
  if (typeof text !== 'string') return 0
  if (typeof TextEncoder === 'function') {
    try {
      return new TextEncoder().encode(text).length
    } catch {
      return text.length
    }
  }
  return text.length
}

/** Format a byte budget for user-facing copy. */
function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(0) + ' MiB'
  if (value >= 1024) return (value / 1024).toFixed(0) + ' KiB'
  return String(value) + ' B'
}

/** Translate a template with `{name}` placeholders. */
function fillTemplate(template, values) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ))
}

/**
 * Parse one source document and draw its graph.
 * A background compute job runs parse -> model -> layout; the panel only
 * renders job states and hands results to the view.
 * @param props - { text, source, sizeBytes, limitBytes, loading, skipReason, t }
 */
function OntologyPanel(props) {
  const t = props.t
  const text = typeof props.text === 'string' ? props.text : ''
  const source = props.source || { address: '', displayName: '', surface: 'preview' }
  const loading = !!props.loading
  const skipReason = props.skipReason
  const sizeBytes = Number(props.sizeBytes) || byteLengthOf(text)
  const limitBytes = Number(props.limitBytes) || MAX_SOURCE_BYTES
  const sourceName = source.displayName || ''
  const [status, setStatus] = React.useState('idle')
  const [errorMessage, setErrorMessage] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [degraded, setDegraded] = React.useState(false)
  const runnerRef = React.useRef(null)
  const containerRef = React.useRef(null)
  const sizeRef = React.useRef({ width: 900, height: 600 })
  const seedRef = React.useRef(1)
  const requestIdRef = React.useRef(0)

  // One runner per mounted panel; it owns the background worker and its lifecycle.
  React.useEffect(() => {
    const runner = createOntologyRunner({
      onEvent(event) {
        if (!event || typeof event !== 'object') return
        if (event.type === 'state') {
          if (event.degraded) setDegraded(true)
          setStatus(event.status || 'parsing')
          return
        }
        if (event.type === 'graph') {
          setResult({
            graph: event.graph || null,
            diagnostics: Array.isArray(event.diagnostics) ? event.diagnostics : [],
            parsedStats: event.parsedStats || event.stats || null,
            budgets: event.budgets || null,
            positions: null,
            degraded: !!event.degraded,
          })
          if (event.degraded) setDegraded(true)
          return
        }
        if (event.type === 'layout') {
          setResult((previous) => (previous ? { ...previous, positions: event.positions || null } : previous))
          return
        }
        if (event.type === 'error') {
          setStatus('error')
          setErrorMessage(String(event.message || 'unknown error'))
        }
      },
    })
    runnerRef.current = runner
    return () => {
      runner.dispose()
      runnerRef.current = null
    }
  }, [])

  // Measure the canvas hosting box once; layout is computed for a stable size.
  React.useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const read = () => {
      const width = Math.round(element.clientWidth || 0)
      const height = Math.round(element.clientHeight || 0)
      if (width > 0 && height > 0) {
        // Reserve an approximate toolbar band so the layout box resembles the
        // actual SVG canvas rather than the whole panel box.
        sizeRef.current = { width, height: Math.max(200, height - 44) }
      }
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Start a new computation whenever the input changes.
  React.useEffect(() => {
    const runner = runnerRef.current
    if (!runner) return undefined
    if (skipReason) {
      runner.cancel()
      setStatus(skipReason)
      setResult(null)
      return undefined
    }
    if (loading) {
      runner.cancel()
      setStatus('loading')
      setResult(null)
      return undefined
    }
    if (!text || text.trim() === '') {
      runner.cancel()
      setStatus('empty')
      setResult(null)
      return undefined
    }
    if (sizeBytes > limitBytes) {
      runner.cancel()
      setStatus('tooLarge')
      setResult(null)
      return undefined
    }
    requestIdRef.current += 1
    setErrorMessage('')
    setStatus('parsing')
    setResult(null)
    const size = sizeRef.current
    runner.submit({
      text,
      resourceAddress: source.address || '',
      displayName: sourceName,
      surface: source.surface || 'preview',
      limits: LIMITS,
      layout: { width: size.width, height: size.height, seed: seedRef.current, iterations: LAYOUT_ITERATIONS },
    })
    return undefined
  }, [text, source.address, source.surface, sourceName, loading, skipReason, sizeBytes, limitBytes])

  const handleRelayout = React.useCallback((nextSeed) => {
    const runner = runnerRef.current
    if (!runner) return
    seedRef.current = typeof nextSeed === 'number' && nextSeed > 0 ? nextSeed : seedRef.current + 1
    const size = sizeRef.current
    setStatus('layout')
    runner.relayout({
      width: size.width,
      height: size.height,
      seed: seedRef.current,
      iterations: LAYOUT_ITERATIONS,
    })
  }, [])

  const style = panelStyle()
  const surface = source.surface || 'preview'
  const surfaceLimit = surface === 'sidebar'
    ? { kind: 'surface', bytes: SURFACE_SIDEBAR_BYTES, surface: 'sidebar' }
    : { kind: 'plugin', bytes: MAX_SOURCE_BYTES, surface: 'preview' }

  if (status === 'idle' || status === 'loading') {
    return h('div', { ref: containerRef, style: style.center, 'data-ontology-state': 'loading' }, spinner(), h('div', { style: style.centerText }, t('state.loading')))
  }
  if (status === 'tooLarge') {
    const message = surface === 'sidebar' ? t('state.tooLargeSidebar') : fillTemplate(t('state.tooLargePreview'), { size: formatBytes(MAX_SOURCE_BYTES) })
    return h('div', { ref: containerRef, style: style.center, 'data-ontology-state': 'too-large' },
      h('div', { style: style.centerText }, message),
      h('div', { style: style.hint }, fillTemplate(t('state.tooLarge'), { size: formatBytes(limitBytes) })))
  }
  if (status === 'empty') {
    return h('div', { ref: containerRef, style: style.center, 'data-ontology-state': 'empty' }, h('div', { style: style.centerText }, t('state.empty')))
  }
  if (status === 'error') {
    return h('div', { ref: containerRef, style: style.center, 'data-ontology-state': 'error' },
      h('div', { style: style.centerText }, t('state.error')),
      h('pre', { style: style.errorDetail }, errorMessage))
  }

  if (!result || !result.graph) {
    const progressLabel = status === 'modeling' ? t('state.modeling')
      : status === 'layout' ? t('state.layout')
        : t('state.parsing')
    return h('div', { ref: containerRef, style: style.center, 'data-ontology-state': status },
      spinner(), h('div', { style: style.centerText }, progressLabel))
  }

  const graph = result.graph
  const budgets = {
    parse: result.parsedStats && result.parsedStats.truncation ? result.parsedStats.truncation : null,
    nodes: graph && graph.truncation ? graph.truncation.nodes : null,
    literals: graph && graph.truncation ? graph.truncation.literals : null,
    edges: graph && graph.truncation ? graph.truncation.edges : null,
  }
  const diagnostics = result.diagnostics || []
  const issues = diagnostics
    .filter((item) => item && typeof item.message === 'string')
    .map((item) => item.message)

  return h('div', {
    ref: containerRef,
    style: style.host,
    'data-ontology-source': sourceName,
    'data-ontology-state': 'ready',
  }, h(GRAPH_VIEW, {
    graph,
    t,
    sourceName,
    issues,
    diagnostics,
    budgets,
    positions: result.positions || null,
    layoutStatus: status === 'error' ? 'error' : (result.positions && status !== 'layout' ? 'ready' : 'layout'),
    degraded: degraded || !!result.degraded,
    surfaceLimit,
    onRelayout: handleRelayout,
  }))
}

/** Small inline spinner (CSS keyframes live in the graph view's own stylesheet). */
function spinner() {
  return h('div', {
    style: {
      width: 18,
      height: 18,
      borderRadius: '50%',
      border: '2px solid var(--dsw-alias-border-l2, #d8d8dd)',
      borderTopColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      marginBottom: 10,
    },
  })
}

/** Inline styles for the small state screens; the graph itself owns its stylesheet. */
function panelStyle() {
  return {
    host: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      minHeight: 0,
      height: '100%',
      overflow: 'hidden',
      background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    },
    center: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: '100%',
      minHeight: 160,
      padding: 24,
      color: 'var(--dsw-alias-label-secondary, #6b6b76)',
      fontSize: 13,
      fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)',
      textAlign: 'center',
      boxSizing: 'border-box',
    },
    centerText: {
      lineHeight: 1.6,
      maxWidth: 420,
    },
    hint: {
      fontSize: 12,
      color: 'var(--dsw-alias-label-tertiary, #8a8a94)',
      maxWidth: 420,
    },
    errorDetail: {
      maxWidth: '90%',
      maxHeight: 160,
      overflow: 'auto',
      margin: 0,
      padding: 8,
      borderRadius: 6,
      textAlign: 'left',
      fontSize: 12,
      background: 'var(--dsw-alias-bg-layer-2, #f4f4f6)',
      color: 'var(--dsw-alias-label-secondary, #6b6b76)',
      whiteSpace: 'pre-wrap',
    },
  }
}

/**
 * DSH right-sidebar document body for ontology files.
 * The host hands this implementation the complete bytes of the file
 * (`loading: 'bytes-complete'`), because a graph needs the whole document
 * rather than the text preview's lazily paged lines.
 * @param props - DocumentBody owner props.
 */
function OntologyDocumentBody(props) {
  const t = useTranslation(pluginContext)
  const content = props && props.content
  const rawBytes = content && content.kind === 'bytes' && content.data && typeof content.data.byteLength === 'number'
    ? content.data.byteLength
    : null
  const overLimit = rawBytes !== null && rawBytes > MAX_SOURCE_BYTES
  const text = overLimit ? '' : documentText(content)
  const ready = text !== null
  const address = props && typeof props.resourceAddress === 'string' ? props.resourceAddress : ''
  const fileName = fileNameOf(address)
  return h('div', {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
      background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    },
    'data-ontology-source': fileName,
  }, h(OntologyPanel, {
    text: ready ? text : '',
    source: { address, displayName: fileName, surface: 'preview' },
    sizeBytes: rawBytes !== null ? rawBytes : byteLengthOf(text || ''),
    limitBytes: MAX_SOURCE_BYTES,
    loading: !ready && !overLimit,
    skipReason: overLimit ? 'tooLarge' : undefined,
    t,
  }))
}

/**
 * Decode a `DocumentContent` into source text, or null while it is incomplete.
 * @param content - hosted document content ({kind:'bytes'} or {kind:'text', eof}).
 * @returns the file's text once complete.
 */
function documentText(content) {
  if (!content || typeof content !== 'object') return null
  if (content.kind === 'bytes') {
    const data = content.data
    if (!data) return null
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(data)
    } catch {
      return null
    }
  }
  if (content.kind === 'text' && content.eof === true) {
    return typeof content.text === 'string' ? content.text : ''
  }
  return null
}

/**
 * dsh-better-sidebar file viewer for ontology files.
 * `content` is the text the plugin's own host route read for the file.
 * @param props - FileViewerProps.
 */
function OntologySidebarViewer(props) {
  const owner = props && props.ctx && props.ctx.locale ? props.ctx : pluginContext
  const t = useTranslation(owner)
  const hasContent = !!(props && typeof props.content === 'string')
  const content = hasContent ? props.content : ''
  const largeFile = !!(props && props.largeFile)
  const loading = !props || (!hasContent && !largeFile)
  const path = props && typeof props.path === 'string' ? props.path : ''
  const fileName = fileNameOf(path)
  const sizeBytes = hasContent ? byteLengthOf(content) : (largeFile && typeof props.largeFile.size === 'number' ? props.largeFile.size : 0)
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    },
    'data-ontology-source': fileName,
  }, h(OntologyPanel, {
    text: content,
    source: { address: path, displayName: fileName, surface: 'sidebar' },
    sizeBytes,
    limitBytes: SURFACE_SIDEBAR_BYTES,
    loading,
    skipReason: largeFile ? 'tooLarge' : undefined,
    t,
  }))
}

/** Monochrome file-tree icon for ontology extensions (better-sidebar fileIcon contract). */
function ontologyFileIcon(size) {
  const s = typeof size === 'number' && size > 0 ? size : 14
  return h('svg', {
    width: s,
    height: s,
    viewBox: '0 0 16 16',
    'aria-hidden': true,
    style: { display: 'block', flex: 'none' },
  },
  h('circle', { cx: 4.5, cy: 4.5, r: 2.1, fill: 'currentColor' }),
  h('circle', { cx: 11.5, cy: 5.2, r: 2.1, fill: 'currentColor' }),
  h('circle', { cx: 7.6, cy: 11.8, r: 2.1, fill: 'currentColor' }),
  h('path', {
    d: 'M4.5 4.5 L11.5 5.2 M4.5 4.5 L7.6 11.8 M11.5 5.2 L7.6 11.8',
    stroke: 'currentColor',
    strokeWidth: 1.1,
    fill: 'none',
    'stroke-linecap': 'round',
  }))
}

/** The plugin context captured by `apply`, used by components rendered later. */
let pluginContext = null

/**
 * Register both surfaces.
 * @param ctx - the Client plugin context.
 */
export function apply(ctx) {
  pluginContext = ctx

  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN }), 'dsh-ontology: dictionaries')

  // 1. DSH's own document preview (required: the plugin exists for this surface).
  ctx.inject(['documentPreviews'], (inner) => {
    inner.effect(() => inner.documentPreviews.register({
      id: DOCUMENT_ID,
      extensions: ONTOLOGY_EXTENSIONS,
      priority: 'extension',
      title: () => documentPreviewTitle(inner),
      loading: 'bytes-complete',
      wrap: false,
    }), 'dsh-ontology: document metadata')

    inner.effect(() => inner.slots.inject('sidebar.right.tab.document', () => inner.slots.register({
      name: 'sidebar.right.tab.document',
      key: DOCUMENT_ID,
    }, OntologyDocumentBody)), 'dsh-ontology: document body')
  })

  // 2. dsh-better-sidebar, when installed: file viewer + tree icon.
  ctx.inject(['betterSidebar'], (inner) => {
    inner.effect(() => inner.betterSidebar.registerFileViewer({
      id: VIEWER_ID,
      title: () => viewerTitle(inner),
      icon: (size) => ontologyFileIcon(size),
      exts: ONTOLOGY_EXTENSIONS,
      priority: 30,
      fetchStrategy: 'fsRead',
      component: (props) => h(OntologySidebarViewer, props),
    }), 'dsh-ontology: sidebar viewer')

    inner.effect(() => inner.betterSidebar.registerFileIcon({
      id: ICON_ID,
      exts: ONTOLOGY_EXTENSIONS,
      icon: (path, size) => ontologyFileIcon(size),
    }), 'dsh-ontology: file icon')
  })
}

/** Viewer-dropdown label; resolved per call so a language switch is reflected. */
function documentPreviewTitle(ctx) {
  const chinese = detectChinese(ctx)
  return chinese ? ZH['viewer.title'] : EN['viewer.title']
}

/** better-sidebar inventory label. */
function viewerTitle(ctx) {
  const chinese = detectChinese(ctx)
  return chinese ? ZH['viewer.name'] : EN['viewer.name']
}
