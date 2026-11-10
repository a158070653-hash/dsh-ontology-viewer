/**
 * Node details panel (right-hand panel on wide layouts, drawer on narrow ones)
 * plus the pure helpers that derive its grouped relation lists.
 *
 * Split out of graph-view.js. The bundle concatenates this module before
 * graph-view.js inside one closure (no imports); the pure helpers at the top
 * are imported by the Node tests, so nothing here may touch React or the DOM at
 * load time. The component is created by `createGraphViewDetails(React)`.
 *
 * Contract note: relations MUST come from the retained full model (L1), never
 * from the draw-budget-trimmed graph. A relation that is present in L1 but not
 * currently drawn is listed anyway and labelled as "not drawn".
 */

/** Reserved source-location field: always null in this change (no jump UI). */
export const DETAILS_SOURCE_ENABLED = false

/** Pick the next focus target for a modal Tab trap, wrapping at both ends. */
export function nextDrawerFocusTarget(focusables, activeElement, shiftKey) {
  const list = Array.isArray(focusables) ? focusables.filter(Boolean) : []
  if (list.length === 0) return null
  const index = list.indexOf(activeElement)
  if (index < 0) return shiftKey ? list[list.length - 1] : list[0]
  const delta = shiftKey ? -1 : 1
  return list[(index + delta + list.length) % list.length]
}
/** Default relations shown per predicate group before "show more". */
export const DETAILS_GROUP_LIMIT = 10
/** Section order in the details panel; empty sections keep their slot. */
export const DETAILS_SECTIONS = ['iri', 'types', 'literals', 'connections', 'structure', 'source']
/** rdf:type IRI, used to put the type group first (no graph-model import here). */
export const DETAILS_RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function detailsString(value) {
  return typeof value === 'string' ? value : ''
}

function detailsNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Local name of an IRI without importing graph-model (self-contained). */
function detailsLocalName(iri) {
  const value = detailsString(iri).trim()
  if (!value) return ''
  if (value.startsWith('_:')) return value.slice(2)
  const hash = value.lastIndexOf('#')
  const slash = value.lastIndexOf('/')
  const cut = hash > slash ? hash : slash
  if (cut >= 0) return value.slice(cut + 1)
  const colon = value.lastIndexOf(':')
  if (colon >= 0) return value.slice(colon + 1)
  return value
}

/** Deterministic group ordering: rdf:type first, then count desc, then IRI. */
function compareConnectionGroups(a, b) {
  const aType = a.predicate === DETAILS_RDF_TYPE ? 0 : 1
  const bType = b.predicate === DETAILS_RDF_TYPE ? 0 : 1
  if (aType !== bType) return aType - bType
  if (a.count !== b.count) return b.count - a.count
  return a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1 : 0
}

function normalizeConnectionItems(items) {
  const list = Array.isArray(items) ? items : []
  const seen = new Set()
  const result = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      label: typeof item.label === 'string' && item.label ? item.label : id,
      kind: typeof item.kind === 'string' && item.kind ? item.kind : 'individual',
    })
  }
  result.sort((a, b) => {
    if (a.label !== b.label) return a.label < b.label ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return result
}

function normalizeGroups(direction, rawGroups) {
  const list = Array.isArray(rawGroups) ? rawGroups : []
  const byPredicate = new Map()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const predicate = typeof raw.predicate === 'string' ? raw.predicate
      : typeof raw.p === 'string' ? raw.p : ''
    if (!predicate) continue
    let group = byPredicate.get(predicate)
    if (!group) {
      group = {
        direction,
        predicate,
        label: typeof raw.label === 'string' && raw.label ? raw.label : (detailsLocalName(predicate) || predicate),
        count: 0,
        items: [],
      }
      byPredicate.set(predicate, group)
    }
    group.count = Math.max(group.count, Math.floor(detailsNumber(raw.count, 0)))
    if (Array.isArray(raw.items)) group.items = group.items.concat(raw.items)
  }
  const groups = []
  for (const group of byPredicate.values()) {
    const items = normalizeConnectionItems(group.items)
    groups.push({
      direction: group.direction,
      predicate: group.predicate,
      label: group.label,
      count: Math.max(group.count, items.length),
      items,
    })
  }
  groups.sort(compareConnectionGroups)
  return groups
}

/**
 * Normalise connectionGroups() output (or the local fallback) into
 * `{out, in, summary}` with deterministic group and item ordering.
 */
export function normalizeConnectionGroups(groups, options) {
  const input = groups && typeof groups === 'object' ? groups : {}
  const out = normalizeGroups('out', input.out || input.outgoing)
  const incoming = normalizeGroups('in', input.in || input.incoming)
  const itemsOut = out.reduce((total, group) => total + group.items.length, 0)
  const itemsIn = incoming.reduce((total, group) => total + group.items.length, 0)
  const summary = input.summary && typeof input.summary === 'object'
    ? {
      outEdges: detailsNumber(input.summary.outEdges, itemsOut),
      inEdges: detailsNumber(input.summary.inEdges, itemsIn),
      degree: detailsNumber(input.summary.degree, itemsOut + itemsIn),
    }
    : { outEdges: itemsOut, inEdges: itemsIn, degree: itemsOut + itemsIn }
  const limit = detailsNumber(options && options.maxPerGroup, DETAILS_GROUP_LIMIT)
  return { out, in: incoming, summary, maxPerGroup: limit }
}

/**
 * Local, dependency-free connection grouping used when the model module does
 * not expose connectionGroups() yet. Reads the full graph only; never mutates.
 */
export function connectionGroupsFallback(graph, nodeId, options) {
  const input = graph && typeof graph === 'object' ? graph : {}
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  if (typeof nodeId !== 'string' || !nodeId) return normalizeConnectionGroups({ out: [], in: [] }, options)
  const byId = new Map()
  for (const node of nodes) {
    if (node && typeof node.id === 'string') byId.set(node.id, node)
  }
  if (!byId.has(nodeId)) return normalizeConnectionGroups({ out: [], in: [] }, options)
  const outMap = new Map()
  const inMap = new Map()
  const endpoint = (id) => {
    const node = byId.get(id)
    return {
      id,
      label: node && typeof node.label === 'string' && node.label ? node.label : (node && node.local) || id,
      kind: node && typeof node.kind === 'string' && node.kind ? node.kind : 'individual',
    }
  }
  const push = (map, predicate, item) => {
    let group = map.get(predicate)
    if (!group) {
      group = { predicate, label: detailsLocalName(predicate) || predicate, count: 0, items: [] }
      map.set(predicate, group)
    }
    group.count += 1
    if (!group.items.some((entry) => entry.id === item.id)) group.items.push(item)
  }
  for (const edge of edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue
    const predicate = typeof edge.p === 'string' && edge.p ? edge.p : ''
    if (!predicate) continue
    if (edge.source === nodeId) push(outMap, predicate, endpoint(edge.target))
    if (edge.target === nodeId) push(inMap, predicate, endpoint(edge.source))
  }
  const toArray = (map) => Array.from(map.values())
  return normalizeConnectionGroups({ out: toArray(outMap), in: toArray(inMap) }, options)
}

/** Section order with presence flags; empty sections keep their fixed slot. */
export function detailsSections(node, groups) {
  const target = node && typeof node === 'object' ? node : {}
  const types = Array.isArray(target.types) ? target.types : []
  const literals = Array.isArray(target.literals) ? target.literals : []
  const relationGroups = groups && typeof groups === 'object' ? groups : {}
  const out = Array.isArray(relationGroups.out) ? relationGroups.out : []
  const incoming = Array.isArray(relationGroups.in) ? relationGroups.in : []
  const present = {
    iri: typeof target.id === 'string' && target.id.length > 0,
    types: types.length > 0,
    literals: literals.length > 0,
    connections: out.length > 0 || incoming.length > 0,
    structure: typeof target.id === 'string' && target.id.length > 0,
    source: DETAILS_SOURCE_ENABLED && Boolean(target.source),
  }
  return DETAILS_SECTIONS.map((key) => ({ key, present: present[key] === true }))
}

/** Page one predicate group: default N items, "show more" reveals the rest. */
export function visibleGroupItems(group, expanded, limit) {
  const items = group && Array.isArray(group.items) ? group.items : []
  const capped = Math.max(0, Math.floor(detailsNumber(limit, DETAILS_GROUP_LIMIT)))
  const max = expanded === true ? items.length : Math.min(items.length, capped)
  return {
    items: items.slice(0, max),
    hiddenCount: Math.max(0, items.length - max),
    hasMore: items.length > max,
  }
}

/** Stable key of one drawn relation, matching graph edge identity (s,p,o). */
export function relationDrawnKey(direction, nodeId, predicate, endpointId) {
  const source = direction === 'in' ? endpointId : nodeId
  const target = direction === 'in' ? nodeId : endpointId
  return source + '\u0000' + predicate + '\u0000' + target
}

/** How many listed relations are missing from the currently drawn edge set. */
export function countHiddenRelations(groups, nodeId, drawnEdgeKeys) {
  if (!drawnEdgeKeys || typeof drawnEdgeKeys.has !== 'function') return 0
  const relationGroups = groups && typeof groups === 'object' ? groups : {}
  let hidden = 0
  for (const direction of ['out', 'in']) {
    const list = Array.isArray(relationGroups[direction]) ? relationGroups[direction] : []
    for (const group of list) {
      const items = Array.isArray(group.items) ? group.items : []
      for (const item of items) {
        if (!drawnEdgeKeys.has(relationDrawnKey(direction, nodeId, group.predicate, item.id))) hidden += 1
      }
    }
  }
  return hidden
}

/** Literal truncation record for one node ("shown X of Y" hint). */
export function literalTruncation(node) {
  const target = node && typeof node === 'object' ? node : {}
  const literals = Array.isArray(target.literals) ? target.literals : []
  const dropped = Math.max(0, Math.floor(detailsNumber(target.literalsTruncated, 0)))
  return { shown: literals.length, dropped, total: literals.length + dropped, truncated: dropped > 0 }
}

// ---------------------------------------------------------------------------
// React component (created once per Client module load)
// ---------------------------------------------------------------------------

/**
 * @param {any} React the host React module
 * @returns {{DetailsPanel: function}}
 */
export function createGraphViewDetails(React) {
  const h = React.createElement

  /**
   * Details for the selected node. `narrow` renders it as a modal drawer with
   * a focus trap and focus restoration; wide layouts keep the side panel.
   * Relations always come from the retained full model (L1); the draw budget
   * only decides whether a listed relation is currently painted.
   */
  function DetailsPanel(props) {
    const tr = props.tr
    const node = props.node || null
    const narrow = props.narrow === true
    const open = props.open !== false
    const [collapsedGroups, setCollapsedGroups] = React.useState({})
    const [expandedGroups, setExpandedGroups] = React.useState({})
    const [maxPerGroup, setMaxPerGroup] = React.useState(DETAILS_GROUP_LIMIT)
    const panelRef = React.useRef(null)
    const previousFocusRef = React.useRef(null)

    const groups = React.useMemo(() => {
      if (!node) return null
      const limit = Math.max(DETAILS_GROUP_LIMIT, maxPerGroup)
      if (typeof connectionGroups === 'function') {
        try {
          return normalizeConnectionGroups(
            connectionGroups(props.graph, node.id, { maxPerGroup: limit }),
            { maxPerGroup: limit },
          )
        } catch (error) {
          return connectionGroupsFallback(props.graph, node.id, { maxPerGroup: limit })
        }
      }
      return connectionGroupsFallback(props.graph, node.id, { maxPerGroup: limit })
    }, [node, props.graph, maxPerGroup])

    // Modal drawer focus management: focus enters the panel, Tab cycles inside,
    // and closing restores focus to the element that opened it.
    React.useEffect(() => {
      if (!narrow || !open) return undefined
      if (typeof document !== 'undefined' && document.activeElement) previousFocusRef.current = document.activeElement
      const panel = panelRef.current
      if (panel && typeof panel.focus === 'function') {
        try {
          panel.focus({ preventScroll: true })
        } catch (error) {
          panel.focus()
        }
      }
      const onKeyDown = (event) => {
        if (!panel || event.key !== 'Tab') return
        const focusables = panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        const list = Array.from(focusables)
        // Install on window capture: DSH's global focus manager may listen on
        // document and otherwise move focus before the event reaches the panel.
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        const active = typeof document !== 'undefined' ? document.activeElement : null
        const next = nextDrawerFocusTarget(list, active, event.shiftKey)
        if (next && typeof next.focus === 'function') {
          try { next.focus({ preventScroll: true }) } catch (error) { next.focus() }
        } else if (typeof panel.focus === 'function') {
          try { panel.focus({ preventScroll: true }) } catch (error) { panel.focus() }
        }
      }
      if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown, true)
      return () => {
        if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown, true)
        const previous = previousFocusRef.current
        if (previous && typeof previous.focus === 'function' && typeof document !== 'undefined' &&
            document.contains(previous)) {
          try {
            previous.focus({ preventScroll: true })
          } catch (error) {
            previous.focus()
          }
        }
      }
    }, [narrow, open])

    if (!node) return null
    const sections = detailsSections(node, groups)
    const types = Array.isArray(node.types) ? node.types : []
    const literals = Array.isArray(node.literals) ? node.literals : []
    const iri = typeof node.iri === 'string' && node.iri ? node.iri : detailsString(node.id)
    const copyState = typeof props.copyState === 'string' ? props.copyState : 'idle'
    const copyLabel = copyState === 'copied'
      ? tr('viewer.copied', '已复制')
      : copyState === 'failed' ? tr('viewer.copyFailed', '复制失败') : tr('viewer.copy', '复制')
    const shortenIri = typeof props.shortenIri === 'function'
      ? props.shortenIri
      : (value) => detailsLocalName(value) || detailsString(value)
    const kindLabel = typeof props.kindLabel === 'function' ? props.kindLabel : (kind) => detailsString(kind)
    const canSelectNode = typeof props.canSelectNode === 'function' ? props.canSelectNode : () => false
    const onSelectNode = typeof props.onSelectNode === 'function' ? props.onSelectNode : () => {}
    const drawnEdgeKeys = props.drawnEdgeKeys
    const literalInfo = literalTruncation(node)

    const connectionList = (direction) => {
      const list = direction === 'out' ? groups.out : groups.in
      if (list.length === 0) {
        return h('div', { key: direction + '-empty', className: 'dov-rel-empty' },
          tr('viewer.noRelations', '没有关系'))
      }
      return list.map((group) => {
        const groupKey = direction + ':' + group.predicate
        const collapsed = collapsedGroups[groupKey] === true
        const expanded = expandedGroups[groupKey] === true
        const page = visibleGroupItems(group, expanded, DETAILS_GROUP_LIMIT)
        const hasMore = group.count > page.items.length
        const itemNodes = page.items.map((item) => {
          const drawn = !drawnEdgeKeys || (typeof drawnEdgeKeys.has === 'function' &&
            drawnEdgeKeys.has(relationDrawnKey(direction, node.id, group.predicate, item.id)))
          const content = [
            h('span', { key: 'endpoint', className: 'dov-rel-endpoint', title: item.id },
              item.label || detailsLocalName(item.id) || item.id),
            h('span', { key: 'chip', className: 'dov-chip' }, kindLabel(item.kind)),
            drawn ? null : h('span', { key: 'hidden', className: 'dov-rel-hidden' },
              tr('viewer.relationsHidden', '未在画布绘制')),
          ]
          if (canSelectNode(item.id)) {
            return h('li', { key: item.id },
              h('button', {
                type: 'button',
                className: 'dov-rel-item',
                onClick: () => onSelectNode(item.id),
              }, content))
          }
          return h('li', { key: item.id }, h('span', { className: 'dov-rel-item' }, content))
        })
        const tail = []
        if (hasMore) {
          tail.push(h('li', { key: 'more' },
            h('button', {
              type: 'button',
              className: 'dov-rel-more',
              onClick: () => {
                setExpandedGroups((previous) => ({ ...previous, [groupKey]: true }))
                if (group.items.length < group.count) {
                  setMaxPerGroup((previous) => Math.max(previous + DETAILS_GROUP_LIMIT, group.items.length + 1))
                }
              },
            }, tr('viewer.showMore', '显示更多'))))
        }
        return h('div', { key: groupKey, className: 'dov-group' },
          h('button', {
            type: 'button',
            className: 'dov-group-head',
            'aria-expanded': !collapsed,
            title: group.predicate,
            onClick: () => setCollapsedGroups((previous) => ({ ...previous, [groupKey]: !collapsed })),
          },
          h('span', { 'aria-hidden': 'true' }, collapsed ? '▸' : '▾'),
          h('span', { className: 'dov-group-pred' }, group.label),
          h('span', { className: 'dov-group-count' }, String(group.count))),
          collapsed ? null : h('ul', { className: 'dov-rel-list' }, itemNodes.concat(tail)))
      })
    }

    const sectionElements = []
    for (const section of sections) {
      if (section.key === 'iri') {
        sectionElements.push(h('section', { key: 'iri', className: 'dov-section' },
          h('div', { className: 'dov-section-title' }, tr('viewer.iri', 'IRI')),
          h('div', { className: 'dov-iri-row' },
            h('div', { className: 'dov-iri' }, iri),
            h('button', {
              type: 'button',
              className: 'dov-copy',
              title: tr('viewer.copy', '复制'),
              onClick: props.onCopy,
            }, copyLabel))))
      } else if (section.key === 'types') {
        sectionElements.push(h('section', { key: 'types', className: 'dov-section' },
          h('div', { className: 'dov-section-title' }, tr('viewer.types', '类型')),
          types.length === 0
            ? h('div', { className: 'dov-muted' }, tr('viewer.noTypes', '没有 rdf:type 信息'))
            : h('div', { className: 'dov-types' }, types.map((type) => {
              const short = shortenIri(type)
              if (canSelectNode(type)) {
                return h('button', {
                  key: type,
                  type: 'button',
                  className: 'dov-type',
                  title: type,
                  onClick: () => onSelectNode(type),
                }, short)
              }
              return h('span', { key: type, className: 'dov-type dov-type--plain', title: type }, short)
            }))))
      } else if (section.key === 'literals') {
        sectionElements.push(h('section', { key: 'literals', className: 'dov-section' },
          h('div', { className: 'dov-section-title dov-section-title--row' },
            h('span', null, tr('viewer.literals', '字面量属性')),
            literalInfo.truncated
              ? h('span', { className: 'dov-muted' },
                formatTemplate(tr('viewer.literalsTruncated', '已显示 {kept} / 共 {total}'),
                  { kept: literalInfo.shown, total: literalInfo.total }))
              : null),
          literals.length === 0
            ? h('div', { className: 'dov-muted' }, tr('viewer.noLiterals', '没有字面量属性'))
            : h('table', { className: 'dov-literals' },
              h('tbody', null, literals.map((literal, index) => h('tr', { key: 'lit-' + String(index) },
                h('td', { className: 'dov-lit-p', title: literal.p || '' },
                  literal.pLabel || shortenIri(literal.p || '')),
                h('td', { className: 'dov-lit-v' },
                  typeof literal.value === 'string' ? literal.value : String(literal.value),
                  literal.lang ? h('span', { className: 'dov-lit-meta', key: 'lang' }, ' @' + literal.lang) : null,
                  literal.dt ? h('span', { className: 'dov-lit-meta', key: 'dt' },
                    ' ^^' + (detailsLocalName(literal.dt) || literal.dt)) : null,
                  literal.truncated
                    ? h('span', { className: 'dov-lit-meta', key: 'trunc' },
                      ' ' + tr('viewer.literalValueTruncated', '值已截断'))
                    : null)))))))
      } else if (section.key === 'connections') {
        const empty = groups.out.length === 0 && groups.in.length === 0
        const connectionsBody = empty
          ? h('div', { key: 'empty', className: 'dov-muted' }, tr('viewer.noRelations', '没有关系'))
          : h('div', { key: 'groups' },
            h('div', { key: 'out-title', className: 'dov-section-title' },
              tr('viewer.outEdges', '出边') + ' (' + String(groups.summary.outEdges) + ')'),
            h('div', { key: 'out' }, connectionList('out')),
            h('div', { key: 'in-title', className: 'dov-section-title' },
              tr('viewer.inEdges', '入边') + ' (' + String(groups.summary.inEdges) + ')'),
            h('div', { key: 'in' }, connectionList('in')))
        sectionElements.push(h('section', { key: 'connections', className: 'dov-section' },
          h('div', { className: 'dov-section-title' }, tr('viewer.detailsConnections', '关系')),
          connectionsBody))
      } else if (section.key === 'structure') {
        const countCell = (field, fallback) => h('div', { key: field, className: 'dov-count' },
          h('b', null, String(detailsNumber(node[field], 0))),
          h('span', null, tr('viewer.' + field, fallback)))
        sectionElements.push(h('section', { key: 'structure', className: 'dov-section' },
          h('div', { className: 'dov-section-title' }, tr('viewer.structure', '连接')),
          h('div', { className: 'dov-counts' },
            countCell('outEdges', '出边'),
            countCell('inEdges', '入边'),
            countCell('degree', '度数'))))
      } else if (section.key === 'source') {
        const graphSource = props.graph && typeof props.graph.source === 'object' && props.graph.source
          ? props.graph.source
          : null
        const address = graphSource && typeof graphSource.address === 'string' ? graphSource.address : ''
        sectionElements.push(h('section', { key: 'source', className: 'dov-section' },
          h('div', { className: 'dov-section-title' }, tr('viewer.sourceReserved', '源文件定位（预留）')),
          h('div', { className: 'dov-muted' },
            address ? address : tr('viewer.sourceUnavailable', '源位置不可用'))))
      }
    }

    return h('aside', {
      key: 'panel',
      ref: panelRef,
      className: 'dov-panel',
      role: narrow ? 'dialog' : 'complementary',
      'aria-modal': narrow ? 'true' : undefined,
      'aria-label': tr('viewer.details', '详情'),
      tabIndex: -1,
    },
    h('div', { key: 'head', className: 'dov-panel-head' },
      h('span', {
        className: 'dov-panel-title',
        title: typeof node.label === 'string' ? node.label : '',
      }, node.label || node.local || node.id),
      h('span', { className: 'dov-chip dov-chip--' + (node.kind || 'individual') },
        kindLabel(node.kind)),
      h('button', {
        key: 'close',
        type: 'button',
        className: 'dov-btn dov-btn--icon',
        title: tr('viewer.closePanel', '关闭详情'),
        'aria-label': tr('viewer.closePanel', '关闭详情'),
        onClick: props.onClose,
      }, '×')),
    h('div', { key: 'body', className: 'dov-panel-body', onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onClose()
      }
    } }, sectionElements))
  }

  return { DetailsPanel }
}
