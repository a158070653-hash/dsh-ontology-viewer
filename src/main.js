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
 * Both surfaces share `OntologyPanel`, which parses the document text once and
 * hands the resulting graph to the React view.
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

/** Above this size the browser parse is refused with an explanation instead of hanging. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024
/** Parser triple ceiling and graph node ceiling keep the first paint responsive. */
const MAX_TRIPLES = 120000
const MAX_NODES = 1500

/** Built once per Client module load; the component identity must stay stable. */
const GRAPH_VIEW = createOntologyGraphView(React).OntologyGraphView

const ZH = {
  // surfaces / titles
  'viewer.title': '本体图谱',
  'viewer.name': '本体图谱查看器',
  // loading + state screens owned by this file
  'state.loading': '正在读取文件…',
  'state.parsing': '正在解析 RDF…',
  'state.empty': '这个文件里没有可画成图谱的三元组。',
  'state.tooLarge': '文件过大，暂不解析（上限 12 MB）。',
  'state.error': '解析失败',
  'state.truncated': '内容过大，已截断显示。',
  // graph view chrome
  'viewer.untitled': '未命名',
  'viewer.truncated': '输入已截断',
  'viewer.nodes': '节点',
  'viewer.edges': '边',
  'viewer.triples': '三元组',
  'viewer.searchPlaceholder': '搜索标签或 IRI',
  'viewer.results': '{n} 个结果',
  'viewer.clearSearch': '清除搜索',
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
}

const EN = {
  'viewer.title': 'Ontology graph',
  'viewer.name': 'Ontology Graph Viewer',
  'state.loading': 'Reading file…',
  'state.parsing': 'Parsing RDF…',
  'state.empty': 'This file has no triples to draw as a graph.',
  'state.tooLarge': 'File is too large to parse here (12 MB limit).',
  'state.error': 'Parse failed',
  'state.truncated': 'Content was truncated for display.',
  'viewer.untitled': 'Untitled',
  'viewer.truncated': 'Input truncated',
  'viewer.nodes': 'nodes',
  'viewer.edges': 'edges',
  'viewer.triples': 'triples',
  'viewer.searchPlaceholder': 'Search label or IRI',
  'viewer.results': '{n} results',
  'viewer.clearSearch': 'Clear search',
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

/**
 * Parse one source document and draw its graph.
 * Parsing runs in a timeout so the first paint (loading state) is not blocked.
 * @param props - { text, fileName, loading, t }
 */
function OntologyPanel(props) {
  const t = props.t
  const text = typeof props.text === 'string' ? props.text : ''
  const loading = !!props.loading
  const skipReason = props.skipReason
  const fileName = props.fileName || ''
  const [state, setState] = React.useState({ status: 'idle' })

  React.useEffect(() => {
    if (skipReason) {
      setState({ status: skipReason })
      return undefined
    }
    if (loading) {
      setState({ status: 'loading' })
      return undefined
    }
    if (!text) {
      setState({ status: 'empty' })
      return undefined
    }
    if (text.length > MAX_SOURCE_BYTES) {
      setState({ status: 'tooLarge' })
      return undefined
    }
    setState({ status: 'parsing' })
    let cancelled = false
    const timer = setTimeout(() => {
      try {
        const parsed = parseOntology(text, { fileName, maxTriples: MAX_TRIPLES })
        const graph = buildGraph(parsed, { maxNodes: MAX_NODES })
        if (cancelled) return
        const issues = []
        if (parsed.errors && parsed.errors.length) issues.push(...parsed.errors)
        if (parsed.warnings && parsed.warnings.length) issues.push(...parsed.warnings)
        if (parsed.stats && parsed.stats.truncated) issues.push(t('state.truncated'))
        setState({ status: 'ready', parsed, graph, issues })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: String((error && error.message) || error) })
      }
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, fileName, loading, skipReason])

  const style = panelStyle()

  if (state.status === 'loading' || state.status === 'parsing' || state.status === 'idle') {
    return h('div', { style: style.center, 'data-ontology-state': state.status }, spinner(), h('div', { style: style.centerText }, state.status === 'parsing' ? t('state.parsing') : t('state.loading')))
  }
  if (state.status === 'tooLarge') {
    return h('div', { style: style.center, 'data-ontology-state': 'too-large' }, h('div', { style: style.centerText }, t('state.tooLarge')))
  }
  if (state.status === 'empty') {
    return h('div', { style: style.center, 'data-ontology-state': 'empty' }, h('div', { style: style.centerText }, t('state.empty')))
  }
  if (state.status === 'error') {
    return h('div', { style: style.center, 'data-ontology-state': 'error' },
      h('div', { style: style.centerText }, t('state.error')),
      h('pre', { style: style.errorDetail }, state.message))
  }

  const truncated = !!(state.parsed && state.parsed.stats && state.parsed.stats.truncated)
  return h(GRAPH_VIEW, {
    graph: state.graph,
    t,
    sourceName: fileName,
    issues: state.issues || [],
    truncated,
  })
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
  const text = documentText(content)
  const ready = text !== null
  const fileName = fileNameOf(props && props.resourceAddress)
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
    fileName,
    loading: !ready,
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
      return new TextDecoder('utf-8').decode(data)
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
  const content = props && typeof props.content === 'string' ? props.content : ''
  const largeFile = !!(props && props.largeFile)
  const loading = !props || (!content && !largeFile)
  const fileName = props && props.path ? fileNameOf(props.path) : ''
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
    fileName,
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
