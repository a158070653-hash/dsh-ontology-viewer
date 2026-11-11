/**
 * Workspace-level UI: view switcher, source panel, class tree, layered relation
 * view, provenance details and the export dialog.
 *
 * Kept as a separate module so the network view (`graph-view.js`) keeps its
 * established interaction contract. Every component is plain
 * React.createElement; colors come from host theme tokens with literal
 * fallbacks; all text goes through the plugin `tr()` dictionary.
 *
 * The tree and layered components never create RDF entities: they render the
 * projections produced by `ontology-views.js` (display references and SCC
 * groups) and report the selected *entity* id upward.
 */

/** Small pure helper: toggle one entity id in an expansion list. */
export function toggleExpandedList(expandedIds, entityId) {
  const list = Array.isArray(expandedIds) ? expandedIds : []
  if (typeof entityId !== 'string' || !entityId) return list
  if (list.indexOf(entityId) >= 0) return list.filter((id) => id !== entityId)
  return list.concat([entityId])
}

/** Map a source status to its localization key family. */
export function sourceStatusKey(status) {
  if (status === 'ready') return 'source.status.ready'
  if (status === 'partial') return 'source.status.partial'
  if (status === 'empty') return 'source.status.empty'
  if (status === 'rejected') return 'source.status.rejected'
  return 'source.status.error'
}

/**
 * Compute the next explicit workset when one source checkbox is toggled.
 *
 * An empty workset means "every source is selected" (no filter), so the first
 * deselect must materialize the other ids instead of keeping only the clicked
 * one. Returning an empty list restores the unfiltered state.
 */
export function nextWorksetSelection(allSourceIds, worksetIds, sourceId) {
  const all = Array.isArray(allSourceIds)
    ? allSourceIds.filter((id) => typeof id === 'string' && id)
    : []
  if (typeof sourceId !== 'string' || !sourceId || all.indexOf(sourceId) < 0) {
    return Array.isArray(worksetIds) ? worksetIds.slice() : []
  }
  const explicit = Array.isArray(worksetIds)
    ? worksetIds.filter((id) => typeof id === 'string' && all.indexOf(id) >= 0)
    : []
  const selected = explicit.length > 0 ? explicit : all.slice()
  const has = selected.indexOf(sourceId) >= 0
  const next = has ? selected.filter((id) => id !== sourceId) : selected.concat([sourceId])
  return next.length === all.length || next.length === 0 ? [] : next
}

/**
 * Resolve a class-tree search query against the whole hierarchy (not only the
 * expanded rows): the first match plus the ancestor path that reveals it.
 */
export function treeSearchPlan(hierarchy, query) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const empty = { query: '', count: 0, entityId: null, ancestors: [] }
  if (!text) return empty
  const entities = hierarchy && hierarchy.entities
  if (!entities || typeof entities.forEach !== 'function') return empty
  const ids = []
  entities.forEach((entity, id) => {
    const label = entity && typeof entity.label === 'string' && entity.label
      ? entity.label.toLowerCase()
      : String(id).toLowerCase()
    if (label.indexOf(text) >= 0 || String(id).toLowerCase().indexOf(text) >= 0) ids.push(id)
  })
  if (ids.length === 0) return { query: text, count: 0, entityId: null, ancestors: [] }
  ids.sort()
  const first = ids[0]
  const ancestors = []
  const seen = new Set([first])
  let cursor = first
  for (;;) {
    const entity = entities.get(cursor)
    if (!entity || !Array.isArray(entity.parents)) break
    const parent = entity.parents
      .map((relation) => relation && relation.parentId)
      .filter((id) => typeof id === 'string' && entities.has(id) && !seen.has(id))
      .sort()[0]
    if (!parent) break
    ancestors.unshift(parent)
    seen.add(parent)
    cursor = parent
  }
  return { query: text, count: ids.length, entityId: first, ancestors: ancestors }
}

/**
 * Keep search matches plus their ancestor rows so the tree shows context
 * instead of a flat list of detached hits.
 */
export function filterTreeRows(refs, hierarchy, plan) {
  const list = Array.isArray(refs) ? refs : []
  if (!plan || !plan.query) return list
  const entities = hierarchy && hierarchy.entities
  if (!entities || typeof entities.get !== 'function') return []
  const byRef = new Map()
  for (const ref of list) if (ref && typeof ref.refId === 'string') byRef.set(ref.refId, ref)
  const keep = new Set()
  for (const ref of list) {
    if (!ref || typeof ref.refId !== 'string') continue
    const entity = entities.get(ref.entityId)
    const label = entity && typeof entity.label === 'string' && entity.label
      ? entity.label.toLowerCase()
      : String(ref.entityId).toLowerCase()
    if (label.indexOf(plan.query) < 0 && String(ref.entityId).toLowerCase().indexOf(plan.query) < 0) continue
    keep.add(ref.refId)
    let parent = ref.parentRefId
    while (typeof parent === 'string' && byRef.has(parent) && !keep.has(parent)) {
      keep.add(parent)
      parent = byRef.get(parent).parentRefId
    }
  }
  return list.filter((ref) => ref && keep.has(ref.refId))
}

/**
 * Focus set for the layered view: the selected node (or expanded cycle group)
 * plus its direct neighbours and their edges. Null means "no focus", so the
 * whole diagram renders at full strength.
 */
export function layeredFocus(layout, selectedId) {
  if (!layout || typeof selectedId !== 'string' || !selectedId) return null
  const nodes = Array.isArray(layout.nodes) ? layout.nodes : []
  const edges = Array.isArray(layout.edges) ? layout.edges : []
  const seed = new Set()
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') continue
    const owner = node.kind === 'group' ? (node.groupId || node.id) : node.id
    if (owner === selectedId || node.id === selectedId) seed.add(node.id)
  }
  if (seed.size === 0) return null
  const focusedNodes = new Set(seed)
  const focusedEdges = new Set()
  for (const edge of edges) {
    if (!edge) continue
    if (seed.has(edge.source) || seed.has(edge.target)) {
      if (typeof edge.id === 'string') focusedEdges.add(edge.id)
      focusedNodes.add(edge.source)
      focusedNodes.add(edge.target)
    }
  }
  return { nodes: focusedNodes, edges: focusedEdges }
}

/** Toggle one Host file path in the workspace-file picker selection. */
export function togglePickerSelection(selected, path, checked) {
  const list = Array.isArray(selected) ? selected.filter((item) => typeof item === 'string') : []
  if (typeof path !== 'string' || !path) return list
  const has = list.indexOf(path) >= 0
  const want = checked !== undefined ? checked : !has
  if (want && !has) return list.concat([path])
  if (!want && has) return list.filter((item) => item !== path)
  return list
}

/**
 * Badge model for one source row: origin, status, format and the per-file
 * warning flags. Kept pure so the read/error/truncated/empty matrix is testable
 * without React.
 */
export function sourcePanelBadges(source) {
  const item = source && typeof source === 'object' ? source : {}
  const badges = []
  const browser = item.origin === 'browser'
  badges.push({
    key: 'origin',
    textKey: browser ? 'source.origin.browser' : 'source.origin.host',
    fallback: browser ? 'Local file' : 'DSH file',
    tone: null,
  })
  badges.push({
    key: 'status',
    textKey: sourceStatusKey(item.status),
    fallback: typeof item.status === 'string' ? item.status : 'error',
    tone: item.status === 'error' ? 'error' : item.status === 'partial' ? 'warning' : null,
  })
  if (item.format) badges.push({ key: 'format', text: String(item.format).toUpperCase(), tone: null })
  if (item.errorCount) {
    badges.push({ key: 'errors', textKey: 'workspace.sourceErrors', count: item.errorCount, tone: 'error' })
  }
  if (item.warningCount) {
    badges.push({ key: 'warnings', textKey: 'workspace.sourceWarnings', count: item.warningCount, tone: 'warning' })
  }
  if (item.truncated) {
    badges.push({ key: 'truncated', textKey: 'workspace.truncated', fallback: 'Truncated', tone: 'warning' })
  }
  if (item.stale) {
    badges.push({ key: 'stale', textKey: 'workspace.stale', fallback: 'Changed on disk', tone: 'warning' })
  }
  return badges
}

/**
 * True when a shared exploration root cannot scope the class tree because the
 * root is not a class (the tree explains this instead of silently ignoring it).
 */
export function exploreRootNotClass(graph, anchorId, exploring) {
  if (!exploring || typeof anchorId !== 'string' || !anchorId) return false
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : []
  const anchor = nodes.find((node) => node && node.id === anchorId)
  return Boolean(anchor && anchor.kind !== 'class')
}

/**
 * Readable label for a display node: tagged identities (NUL separators) must
 * never reach the DOM or an accessible name, and bare markers such as "group"
 * are dropped in favour of the meaningful last segment.
 */
export function readableNodeLabel(node) {
  const source = node && typeof node === 'object'
    ? (typeof node.label === 'string' && node.label ? node.label
      : (typeof node.id === 'string' ? node.id : ''))
    : ''
  const parts = String(source).split(/[\u0000-\u001f\u007f]+/).filter(Boolean)
  const meaningful = parts.filter((part) => part !== 'group' && part !== 'statement' && part !== 'entity')
  const chosen = meaningful.length > 0 ? meaningful[meaningful.length - 1] : (parts[0] || '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(chosen)) {
    const tail = chosen.replace(/[#/]+$/, '').split(/[#/]/).pop()
    return tail || chosen
  }
  return chosen
}

/**
 * Roving-focus step for the class tree. Rows are the visible (filtered and
 * expanded) list, so arrow keys move through what the user actually sees.
 */
export function nextTreeFocusIndex(rows, currentId, key) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return -1
  const current = list.findIndex((row) => row && row.entityId === currentId)
  if (key === 'Home') return 0
  if (key === 'End') return list.length - 1
  const step = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
  if (step === 0) return current < 0 ? 0 : current
  if (current < 0) return 0
  const next = current + step
  if (next < 0) return 0
  if (next >= list.length) return list.length - 1
  return next
}

/** Predicate options for the layered view, taken from the current graph. */
export function collectPredicateOptions(graph) {
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : []
  const byIri = new Map()
  for (const edge of edges) {
    if (!edge || typeof edge.p !== 'string') continue
    if (!byIri.has(edge.p)) {
      byIri.set(edge.p, typeof edge.label === 'string' && edge.label ? edge.label : edge.p)
    }
  }
  const options = []
  for (const [iri, label] of byIri) options.push({ iri: iri, label: label })
  options.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return options
}

/** The default layered predicates: the class hierarchy. */
export const RDFS_SUBCLASSOF_IRI = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'

/**
 * @param {any} React host React 18 module
 */
export function createMultiview(React, deps) {
  const h = React.createElement
  const { useMemo, useState, useEffect, useRef } = React
  // The bundle defines layoutLayeredGraph globally; tests inject it explicitly.
  const layoutLayeredGraphFn = deps && typeof deps.layoutLayeredGraph === 'function'
    ? deps.layoutLayeredGraph
    : (typeof layoutLayeredGraph === 'function' ? layoutLayeredGraph : null)

  const THEME = {
    panel: 'var(--dsw-alias-bg-layer-1, #ffffff)',
    panelAlt: 'var(--dsw-alias-bg-layer-2, #f4f4f6)',
    border: 'var(--dsw-alias-border-l1, #e3e3e8)',
    text: 'var(--dsw-alias-label-primary, #1f2430)',
    textSecondary: 'var(--dsw-alias-label-secondary, #6b6b76)',
    brand: 'var(--dsw-alias-brand-primary, #4f6bed)',
    danger: 'var(--dsw-alias-state-error-primary, #c0392b)',
    warning: 'var(--dsw-alias-state-warn-primary, #b7791f)',
    hover: 'var(--dsw-alias-interactive-bg-hover, #eceefd)',
  }

  const BUTTON = {
    border: '1px solid ' + THEME.border,
    background: 'transparent',
    color: THEME.text,
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  function iconButton(style, props, children) {
    return h('button', Object.assign({
      type: 'button',
      style: Object.assign({}, BUTTON, style),
    }, props || {}), children)
  }

  function badge(text, tone) {
    return h('span', {
      key: 'badge-' + text,
      style: {
        display: 'inline-block',
        padding: '0 5px',
        borderRadius: 4,
        fontSize: 10,
        lineHeight: '16px',
        color: tone === 'error' ? THEME.danger : tone === 'warning' ? THEME.warning : THEME.textSecondary,
        background: THEME.panelAlt,
        border: '1px solid ' + THEME.border,
      },
    }, text)
  }

  /* ------------------------------ toolbar ------------------------------ */

  /**
   * Compact main row: view switch, source toggle, export toggle, status text.
   */
  function WorkspaceToolbar(props) {
    const tr = props.tr
    const views = [
      { id: 'network', label: tr('view.network', 'Network') },
      { id: 'tree', label: tr('view.tree', 'Class tree') },
      { id: 'layered', label: tr('view.layered', 'Layered') },
    ]
    return h('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderBottom: '1px solid ' + THEME.border,
        background: THEME.panel,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        flex: 'none',
      },
      role: 'toolbar',
      'aria-label': tr('workspace.toolbar', 'Workspace toolbar'),
    },
    h('div', {
      role: 'tablist',
      'aria-label': tr('view.switch', 'View'),
      style: { display: 'flex', gap: 2, flex: 'none' },
    }, views.map((view) => iconButton({
      padding: '3px 9px',
      fontWeight: props.viewType === view.id ? 600 : 400,
      background: props.viewType === view.id ? THEME.hover : 'transparent',
      borderColor: props.viewType === view.id ? THEME.brand : THEME.border,
    }, {
      key: view.id,
      role: 'tab',
      'aria-selected': props.viewType === view.id,
      'aria-label': view.label,
      onClick: () => props.onViewType(view.id),
    }, view.label))),
    h('span', { style: { flex: '1 1 auto' } }),
    props.selectedLabel ? h('span', {
      style: {
        color: THEME.textSecondary, fontSize: 11, maxWidth: 140,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none',
      },
      title: props.selectedLabel,
    }, props.selectedLabel) : null,
    iconButton({}, {
      key: 'sources',
      'aria-expanded': !!props.sourcesOpen,
      'aria-label': tr('workspace.sources', 'Sources') + (props.sourceCount ? ' (' + props.sourceCount + ')' : ''),
      onClick: props.onToggleSources,
    }, tr('workspace.sources', 'Sources') + (props.sourceCount ? ' ' + props.sourceCount : '')),
    iconButton({}, {
      key: 'export',
      'aria-expanded': !!props.exportOpen,
      'aria-label': tr('export.title', 'Export'),
      onClick: props.onToggleExport,
    }, tr('export.title', 'Export')))
  }

  /* ---------------------------- source panel --------------------------- */

  function SourcePanel(props) {
    const tr = props.tr
    const sources = Array.isArray(props.sources) ? props.sources.filter(item => item && typeof item === 'object') : []
    const workset = Array.isArray(props.worksetIds) ? props.worksetIds : []
    const fileInput = React.useRef(null)
    const allSelected = workset.length === 0
    return h('div', {
      style: {
        borderBottom: '1px solid ' + THEME.border,
        background: THEME.panel,
        padding: '8px 10px',
        maxHeight: '42%',
        overflow: 'auto',
        flex: 'none',
      },
      role: 'region',
      'aria-label': tr('workspace.sources', 'Sources'),
    },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
      h('strong', { style: { fontSize: 12, color: THEME.text } }, tr('workspace.sources', 'Sources')),
      h('span', {
        style: { fontSize: 11, color: THEME.textSecondary },
      }, tr('workspace.totals', '{files} files · {triples} triples')
        .replace('{files}', String(props.totals ? props.totals.files : sources.length))
        .replace('{triples}', String(props.totals ? props.totals.occurrences : 0))),
      h('span', { style: { flex: '1 1 auto' } }),
      props.workspaceFilesAvailable ? iconButton({ padding: '2px 7px' }, {
        'aria-label': tr('workspace.pickWorkspaceFiles', 'Workspace files'),
        onClick: props.onPickWorkspaceFiles,
      }, tr('workspace.pickWorkspaceFiles', 'Workspace files')) : null,
      typeof props.onToggleSharing === 'function' ? iconButton({
        padding: '2px 7px',
        borderColor: props.sharing ? THEME.brand : THEME.border,
      }, {
        'aria-pressed': !!props.sharing,
        'aria-label': tr(props.sharing ? 'workspace.sharing' : 'workspace.share', props.sharing ? 'Sharing' : 'Share'),
        title: tr('workspace.shareHint', 'Sharing stays in this page.'),
        onClick: props.onToggleSharing,
        disabled: props.sharingAvailable === false,
      }, tr(props.sharing ? 'workspace.sharing' : 'workspace.share', props.sharing ? 'Sharing' : 'Share')) : null,
      h('input', {
        ref: fileInput,
        type: 'file',
        multiple: true,
        accept: '.ttl,.turtle,.owl,.rdf,.rdfxml,.jsonld,.nt,.n3,.nq,.trig,.xml',
        style: { display: 'none' },
        onChange: (event) => {
          const files = event.target.files ? Array.from(event.target.files) : []
          event.target.value = ''
          if (files.length > 0) props.onAddFiles(files)
        },
      }),
      iconButton({}, {
        'aria-label': tr('workspace.addFiles', 'Add files'),
        onClick: () => { if (fileInput.current) fileInput.current.click() },
      }, tr('workspace.addFiles', 'Add files')),
      iconButton({}, {
        'aria-pressed': allSelected,
        'aria-label': tr('workspace.allSources', 'All sources'),
        onClick: () => props.onSetWorkset([]),
      }, tr('workspace.union', 'Union')),
      iconButton({}, {
        'aria-label': tr('workspace.close', 'Close'),
        onClick: props.onClose,
      }, '\u00d7')),
    h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
      sources.length === 0
        ? h('li', { style: { fontSize: 12, color: THEME.textSecondary } }, tr('workspace.empty', 'No sources loaded.'))
        : sources.map((source) => {
          const checked = allSelected || workset.indexOf(source.sourceId) >= 0
          return h('li', {
            key: source.sourceId,
            style: {
              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
              borderBottom: '1px solid ' + THEME.border, flexWrap: 'wrap',
            },
          },
          h('input', {
            type: 'checkbox',
            checked: checked,
            'aria-label': tr('workspace.includeSource', 'Include source') + ' ' + source.displayName,
            onChange: () => {
              props.onSetWorkset(nextWorksetSelection(
                sources.map((item) => item.sourceId),
                workset,
                source.sourceId,
              ))
            },
          }),
          h('span', {
            style: {
              fontSize: 12, color: THEME.text, flex: '1 1 140px', minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
            title: source.absolutePath || source.displayName,
          }, source.displayName || source.sourceId),
          sourcePanelBadges(source).map((entry) => {
            if (entry.text !== undefined) return badge(entry.text, entry.tone)
            let text = tr(entry.textKey, entry.fallback)
            if (typeof text !== 'string') text = entry.fallback || (entry.key === 'errors' ? 'Errors' : entry.key === 'warnings' ? 'Warnings' : entry.key)
            if (entry.count !== undefined) text = text.replace('{n}', String(entry.count))
            return badge(text, entry.tone)
          }),
          h('span', { style: { fontSize: 10, color: THEME.textSecondary } },
            tr('workspace.sourceTriples', '{n} triples').replace('{n}', String(source.tripleCount || 0))),
          source.origin === 'browser' ? iconButton({ padding: '1px 6px', fontSize: 11 }, {
            'aria-label': tr('workspace.reload', 'Reload') + ' ' + source.displayName,
            onClick: () => props.onRequestReload(source.sourceId),
          }, tr('workspace.reload', 'Reload')) : null,
          iconButton({ padding: '1px 6px', fontSize: 11 }, {
            'aria-label': tr('workspace.remove', 'Remove') + ' ' + source.displayName,
            onClick: () => props.onRemove(source.sourceId),
          }, tr('workspace.remove', 'Remove')))
        })),
    h('div', { style: { fontSize: 10, color: THEME.textSecondary, marginTop: 6 } },
      tr('workspace.addHint', 'Files stay in this page only; reloading a local file asks you to pick it again.')),
    props.sharing ? h('div', { style: { fontSize: 10, color: THEME.textSecondary, marginTop: 4 }, role: 'status' },
      tr('workspace.shareHint', 'Sharing stays in this page and clears when the last panel closes.')) : null,
    props.sharingAvailable === false ? h('div', { role: 'status', style: { fontSize: 10, color: THEME.textSecondary } },
      tr('workspace.shareUnavailable', 'Session identity unavailable; this workspace stays panel-local.')) : null)
  }

  /* --------------------- workspace file picker (A) --------------------- */

  function WorkspaceFilePicker(props) {
    const tr = props.tr
    const state = props.state || {}
    const entries = Array.isArray(state.entries) ? state.entries : []
    const selected = Array.isArray(state.selected) ? state.selected : []
    const busy = props.busy === true
    return h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': tr('workspace.pickWorkspaceFiles', 'Workspace files'),
      style: {
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 8,
      },
    },
    h('div', {
      style: {
        background: THEME.panel, border: '1px solid ' + THEME.border, borderRadius: 8,
        padding: 10, width: '100%', maxWidth: 520, maxHeight: '100%', display: 'flex',
        flexDirection: 'column', gap: 6, color: THEME.text,
      },
    },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('strong', { style: { fontSize: 12 } }, tr('workspace.pickWorkspaceFiles', 'Workspace files')),
      h('span', { style: { flex: '1 1 auto' } }),
      iconButton({ padding: '1px 7px' }, {
        'aria-label': tr('workspace.cancel', 'Cancel'),
        onClick: props.onClose,
      }, '×')),
    h('div', { style: { fontSize: 10, color: THEME.textSecondary, wordBreak: 'break-all' } },
      state.directory || '.',
      state.loading ? ' · ' + tr('workspace.loadingDir', 'Loading…') : ''),
    state.error ? h('div', { role: 'status', style: { fontSize: 11, color: THEME.danger } }, state.error) : null,
    h('div', {
      style: { overflow: 'auto', flex: '1 1 auto', borderTop: '1px solid ' + THEME.border, borderBottom: '1px solid ' + THEME.border },
      role: 'listbox',
      'aria-label': tr('workspace.pickWorkspaceFiles', 'Workspace files'),
    },
    entries.length === 0
      ? h('div', { style: { fontSize: 11, color: THEME.textSecondary, padding: 10 } },
        state.loading ? tr('workspace.loadingDir', 'Loading…') : tr('workspace.noFiles', 'No files in this directory.'))
      : entries.map((entry) => h('div', {
        key: 'wf-' + entry.path,
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderBottom: '1px solid ' + THEME.border },
      },
      entry.isDirectory
        ? iconButton({ padding: '1px 7px', fontSize: 11 }, {
          'aria-label': tr('workspace.openDir', 'Open folder') + ' ' + entry.name,
          onClick: () => props.onNavigate(entry.path),
        }, tr('workspace.openDir', 'Open'))
        : h('input', {
          type: 'checkbox',
          checked: selected.indexOf(entry.path) >= 0,
          'aria-label': tr('workspace.selectFile', 'Select file') + ' ' + entry.name,
          onChange: (event) => props.onToggle(entry.path, event.target.checked),
        }),
      h('span', { style: { fontSize: 11, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        entry.isDirectory ? entry.name + '/' : entry.name),
      h('span', { style: { fontSize: 10, color: THEME.textSecondary } },
        entry.isDirectory ? '' : String(entry.size || 0)))),
    state.truncated ? h('div', { style: { fontSize: 10, color: THEME.warning } },
      tr('workspace.dirTruncated', 'Directory listing truncated.')) : null,
    h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
      h('button', {
        type: 'button',
        style: Object.assign({}, BUTTON, { fontSize: 11 }),
        onClick: props.onUp,
      }, tr('workspace.parentDir', 'Up')),
      h('button', {
        type: 'button',
        style: Object.assign({}, BUTTON, { fontSize: 11, background: THEME.brand, color: THEME.text }),
        disabled: busy || selected.length === 0,
        'aria-label': tr('workspace.readSelected', 'Read selected files'),
        onClick: props.onConfirm,
      }, tr('workspace.readSelected', 'Read selected') + ' (' + String(selected.length) + ')')))))
  }

  /* ----------------------------- export menu --------------------------- */

  function ExportMenu(props) {
    const tr = props.tr
    return h('div', {
      style: {
        borderBottom: '1px solid ' + THEME.border,
        background: THEME.panelAlt,
        padding: '8px 10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        flex: 'none',
      },
      role: 'region',
      'aria-label': tr('export.title', 'Export'),
    },
    h('strong', { style: { fontSize: 12, color: THEME.text } }, tr('export.title', 'Export')),
    h('label', { style: { fontSize: 11, color: THEME.textSecondary } },
      tr('export.range', 'Range'),
      h('select', {
        value: props.range,
        'aria-label': tr('export.range', 'Range'),
        onChange: (event) => props.onRange(event.target.value),
        style: { marginLeft: 4, fontSize: 11 },
      },
      h('option', { value: 'viewport' }, tr('export.range.viewport', 'Current viewport')),
      h('option', { value: 'layout' }, tr('export.range.layout', 'Whole displayed layout')))),
    h('label', { style: { fontSize: 11, color: THEME.textSecondary } },
      tr('export.scale', 'Scale'),
      h('select', {
        value: String(props.scale),
        'aria-label': tr('export.scale', 'Scale'),
        onChange: (event) => props.onScale(Number(event.target.value)),
        style: { marginLeft: 4, fontSize: 11 },
      },
      h('option', { value: '1' }, '1x'),
      h('option', { value: '2' }, '2x'))),
    iconButton({}, {
      'aria-label': tr('export.svg', 'SVG'),
      onClick: () => props.onExport('svg'),
      disabled: !!props.busy,
    }, tr('export.svg', 'SVG')),
    iconButton({}, {
      'aria-label': tr('export.png', 'PNG'),
      onClick: () => props.onExport('png'),
      disabled: !!props.busy,
    }, tr('export.png', 'PNG')),
    iconButton({}, {
      'aria-label': tr('export.copySvg', 'Copy SVG'),
      title: tr('export.copySvgHint', 'Use this when the browser blocks the download.'),
      onClick: props.onCopySvg,
      disabled: !!props.busy,
    }, tr('export.copySvg', 'Copy SVG')),
    props.message ? h('span', {
      role: 'status',
      style: { fontSize: 11, color: THEME.textSecondary, flex: '1 1 100%' },
    }, props.message) : null,
    (typeof props.svgText === 'string' && props.svgText !== '')
      ? h('div', { style: { flex: '1 1 100%', display: 'flex', flexDirection: 'column', gap: 4 } },
        h('span', { style: { fontSize: 10, color: THEME.textSecondary } },
          tr('export.manualHint', 'Clipboard unavailable; select and copy the SVG text below.')),
        h('textarea', {
          readOnly: true,
          value: props.svgText,
          'aria-label': tr('export.svgText', 'SVG text'),
          rows: 4,
          onFocus: (event) => { if (event.target.select) event.target.select() },
          style: {
            width: '100%', fontSize: 10, fontFamily: 'monospace',
            border: '1px solid ' + THEME.border, borderRadius: 4, background: THEME.panel,
            color: THEME.text, resize: 'vertical',
          },
        })) : null)
  }

  /* ---------------------------- class tree ----------------------------- */

  function ClassTreeView(props) {
    const tr = props.tr
    const graph = props.graph
    const mode = props.mode === 'property' ? 'property' : 'class'
    const hierarchy = useMemo(() => buildHierarchy(graph, { mode: mode }), [graph, mode])
    const expandedIds = Array.isArray(props.expandedIds) ? props.expandedIds : []
    const expanded = useMemo(() => expandHierarchy(hierarchy, {
      expandedIds: expandedIds,
      maxRefs: 1200,
      maxDepth: 12,
    }), [hierarchy, expandedIds])
    const plan = useMemo(() => treeSearchPlan(hierarchy, props.query), [hierarchy, props.query])
    const rows = useMemo(() => filterTreeRows(expanded.refs, hierarchy, plan), [expanded.refs, hierarchy, plan])
    const revealedRef = useRef('')
    useEffect(() => {
      if (!plan.entityId) {
        revealedRef.current = ''
        return
      }
      if (revealedRef.current === plan.entityId) return
      revealedRef.current = plan.entityId
      for (const id of plan.ancestors) {
        if (expandedIds.indexOf(id) < 0) props.onToggle(id)
      }
      props.onSelect(plan.entityId)
    }, [plan, expandedIds, props])
    const entityCount = hierarchy.stats.entities
    const noHierarchy = entityCount === 0
    return h('div', {
      style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', background: THEME.panel },
    },
    h('div', {
      style: { display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', flexWrap: 'wrap', flex: 'none' },
    },
    h('label', { style: { fontSize: 11, color: THEME.textSecondary } },
      tr('view.mode', 'Mode'),
      h('select', {
        value: mode,
        'aria-label': tr('view.mode', 'Mode'),
        onChange: (event) => props.onMode(event.target.value),
        style: { marginLeft: 4, fontSize: 11 },
      },
      h('option', { value: 'class' }, tr('view.mode.class', 'Classes')),
      h('option', { value: 'property' }, tr('view.mode.property', 'Properties')))),
    h('input', {
      type: 'search',
      value: props.query || '',
      placeholder: tr('view.search', 'Search'),
      'aria-label': tr('view.search', 'Search'),
      onChange: (event) => props.onQuery(event.target.value),
      style: {
        flex: '1 1 120px', minWidth: 80, fontSize: 11, padding: '2px 6px',
        border: '1px solid ' + THEME.border, borderRadius: 5, background: THEME.panel, color: THEME.text,
      },
    }),
    h('span', { style: { fontSize: 10, color: THEME.textSecondary } },
      tr('view.entityCount', '{n} entities').replace('{n}', String(entityCount))),
    (hierarchy.stats.truncated > 0 || expanded.stats.truncated > 0)
      ? badge(tr('view.treeBudget', 'Tree budget reached: {n}').replace('{n}',
        String(hierarchy.stats.truncated + expanded.stats.truncated)), 'warning')
      : null,
    hierarchy.cycles.length > 0
      ? badge(tr('view.cycleCount', '{n} cycles').replace('{n}', String(hierarchy.cycles.length)), 'warning')
      : null,
    props.exploreRootNotClass ? badge(tr('view.exploreRootNotClass',
      'The exploration root is not a class, so the tree does not show exploration scope.'), 'warning') : null),
    h('div', {
      style: { overflow: 'auto', flex: '1 1 auto', padding: '2px 8px 12px 8px' },
      role: 'tree',
      'aria-label': tr('view.tree', 'Class tree'),
    },
    noHierarchy
      ? h('div', { style: { fontSize: 12, color: THEME.textSecondary, padding: 12 } },
        tr('view.noHierarchy', 'This document has no explicit class hierarchy.'))
      : (plan.query && rows.length === 0) ? h('div', {
        style: { fontSize: 12, color: THEME.textSecondary, padding: 12 },
        role: 'status',
      }, tr('view.noMatches', 'No entity matches "{query}".').replace('{query}', plan.query))
      : rows.map((ref) => {
        const entity = hierarchy.entities.get(ref.entityId)
        const label = ref.label || (entity && entity.label) || ref.entityId
        const hasChildren = ref.childCount > 0 && !ref.cycle
        const isExpanded = ref.expanded
        return h('div', {
          key: ref.refId,
          role: 'treeitem',
          tabIndex: props.selectedId === ref.entityId || (props.selectedId === null && ref === rows[0]) ? 0 : -1,
          'aria-level': ref.depth + 1,
          'aria-expanded': hasChildren ? isExpanded : undefined,
          'aria-selected': props.selectedId === ref.entityId,
          'aria-label': label + (ref.cycle ? ' (' + tr('view.cycle', 'cycle') + ')' : ''),
          onKeyDown: (event) => {
            if (!event || typeof event.key !== 'string') return
            const target = nextTreeFocusIndex(rows, ref.entityId, event.key)
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.onSelect(ref.entityId)
              return
            }
            if (target < 0) return
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              const nextRef = rows[target]
              if (!nextRef) return
              props.onSelect(nextRef.entityId)
              setTimeout(() => {
                const items = document.querySelectorAll('[role=treeitem]')
                for (const node of items) {
                  if (node.getAttribute('aria-selected') === 'true') {
                    node.focus()
                    break
                  }
                }
              }, 0)
            }
          },
          style: {
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: 2 + ref.depth * 14,
            minHeight: 22, cursor: 'pointer', borderRadius: 4,
            background: props.selectedId === ref.entityId ? THEME.hover : 'transparent',
          },
          onClick: () => props.onSelect(ref.entityId),
        },
        h('button', {
          type: 'button',
          style: {
            width: 16, height: 16, padding: 0, border: 'none', background: 'transparent',
            color: THEME.textSecondary, cursor: hasChildren ? 'pointer' : 'default', fontSize: 10,
          },
          'aria-label': tr(isExpanded ? 'view.collapse' : 'view.expand', isExpanded ? 'Collapse' : 'Expand') +
            ' ' + label,
          onClick: (event) => {
            event.stopPropagation()
            if (hasChildren) props.onToggle(ref.entityId)
          },
          tabIndex: -1,
        }, hasChildren ? (isExpanded ? '\u25be' : '\u25b8') : ''),
        h('span', {
          style: {
            fontSize: 12, color: THEME.text, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
          title: ref.entityId,
        }, label),
        ref.cycle ? badge(tr('view.cycle', 'cycle'), 'warning') : null,
        ref.orphan ? badge(tr('view.orphan', 'orphan')) : null,
        ref.inCycle && !ref.cycle ? badge(tr('view.inCycle', 'in cycle'), 'warning') : null,
        ref.cycleGroup ? badge(tr('view.groupOf', 'group of {n}').replace('{n}', String(ref.cycleGroup.length)), 'warning') : null)
      })))
  }

  /* --------------------------- layered view ---------------------------- */

  function LayeredView(props) {
    const tr = props.tr
    const orientation = props.orientation === 'right' ? 'right' : 'down'
    const predicates = Array.isArray(props.predicates) && props.predicates.length > 0
      ? props.predicates
      : [RDFS_SUBCLASSOF_IRI]
    const options = useMemo(() => collectPredicateOptions(props.graph), [props.graph])
    const layout = useMemo(() => (layoutLayeredGraphFn ? layoutLayeredGraphFn(props.graph, {
      predicates: predicates,
      orientation: orientation,
      width: props.width || 900,
      height: props.height || 560,
    }) : {
      nodes: [], edges: [], internalEdges: [], groups: [],
      stats: { nodes: 0, layers: 0, groups: 0 },
      bounds: { minX: 0, minY: 0, width: 1, height: 1 },
    }), [props.graph, predicates.join('\u0001'), orientation, props.width, props.height])
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [openGroupId, setOpenGroupId] = useState(null)
    const dragRef = React.useRef(null)
    const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout])
    const focus = useMemo(() => layeredFocus(layout, props.selectedId), [layout, props.selectedId])
    const empty = layout.nodes.length === 0
    const bounds = layout.bounds
    return h('div', {
      style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto', background: THEME.panel },
    },
    h('div', {
      style: { display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', flexWrap: 'wrap', flex: 'none' },
    },
    h('label', { style: { fontSize: 11, color: THEME.textSecondary } },
      tr('view.orientation', 'Direction'),
      h('select', {
        value: orientation,
        'aria-label': tr('view.orientation', 'Direction'),
        onChange: (event) => props.onOrientation(event.target.value),
        style: { marginLeft: 4, fontSize: 11 },
      },
      h('option', { value: 'down' }, tr('view.orientation.down', 'Top to bottom')),
      h('option', { value: 'right' }, tr('view.orientation.right', 'Left to right')))),
    h('span', { style: { fontSize: 11, color: THEME.textSecondary } }, tr('view.predicates', 'Relations')),
    h('span', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: '100%' } },
      (options.length > 0 ? options : [{ iri: RDFS_SUBCLASSOF_IRI, label: 'rdfs:subClassOf' }]).map((option) => {
        const checked = predicates.indexOf(option.iri) >= 0
        return h('label', {
          key: option.iri,
          style: { fontSize: 10, color: THEME.textSecondary, display: 'inline-flex', gap: 2, alignItems: 'center' },
          title: option.iri,
        },
        h('input', {
          type: 'checkbox',
          checked: checked,
          'aria-label': option.label,
          onChange: () => {
            const next = checked
              ? predicates.filter((iri) => iri !== option.iri)
              : predicates.concat([option.iri])
            props.onPredicates(next)
          },
        }), option.label)
      })),
    h('span', { style: { flex: '1 1 auto' } }),
    (props.selectedId && !layeredFocus(layout, props.selectedId))
      ? h('span', { role: 'status', style: { fontSize: 10, color: THEME.textSecondary } },
        tr('view.selectionHidden', 'Selected entity is not shown with these relation types.'))
      : null,
    h('span', { style: { fontSize: 10, color: THEME.textSecondary } },
      tr('view.layerStats', '{nodes} nodes · {layers} layers · {groups} cycles')
        .replace('{nodes}', String(layout.stats.nodes))
        .replace('{layers}', String(layout.stats.layers))
        .replace('{groups}', String(layout.stats.groups))),
    iconButton({ padding: '2px 7px' }, {
      'aria-label': tr('view.fit', 'Fit'),
      onClick: () => { setZoom(1); setPan({ x: 0, y: 0 }) },
    }, tr('view.fit', 'Fit'))),
    h('div', {
      style: { position: 'relative', flex: '1 1 auto', minHeight: 120, overflow: 'hidden' },
      onWheel: (event) => {
        event.preventDefault()
        const factor = Math.exp(-event.deltaY * 0.0015)
        setZoom((previous) => Math.min(4, Math.max(0.15, previous * factor)))
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return
        dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
        if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove: (event) => {
        const drag = dragRef.current
        if (!drag) return
        setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) })
      },
      onPointerUp: () => { dragRef.current = null },
      onPointerCancel: () => { dragRef.current = null },
    },
    empty
      ? h('div', {
        style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: THEME.textSecondary, textAlign: 'center', padding: 16 },
      }, tr('view.noRelations', 'No relations match the selected relation types.'))
      : h('svg', {
        width: '100%',
        height: '100%',
        viewBox: bounds.minX + ' ' + bounds.minY + ' ' + Math.max(1, bounds.width + 48) + ' ' + Math.max(1, bounds.height + 48),
        role: 'img',
        'aria-label': tr('view.layered', 'Layered relation view'),
        style: { display: 'block', touchAction: 'none' },
      }, h('g', { transform: 'translate(' + (pan.x / zoom) + ' ' + (pan.y / zoom) + ') scale(' + (1 / zoom) + ')' },
      layout.edges.map((edge) => {
        const from = byId.get(edge.source)
        const to = byId.get(edge.target)
        if (!from || !to) return null
        return h('line', {
          key: 'pe-' + edge.id,
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
          stroke: THEME.border, strokeWidth: 1.2,
          strokeOpacity: focus ? (focus.edges.has(edge.id) ? 0.95 : 0.12) : 0.9,
        })
      }),
      layout.internalEdges.map((edge) => {
        const node = byId.get(edge.source)
        if (!node) return null
        return h('circle', {
          key: 'ie-' + edge.id + '-' + edge.target,
          cx: node.x, cy: node.y, r: 13,
          fill: 'none', stroke: THEME.warning, strokeWidth: 1.5, strokeDasharray: '3 2',
        })
      }),
      layout.nodes.map((node) => {
        const radius = node.kind === 'group' ? 9 + Math.min(5, node.memberCount) : 6
        const selected = props.selectedId === (node.kind === 'group' ? node.groupId : node.id)
        const dimmed = focus ? !focus.nodes.has(node.id) : false
        return h('g', {
          key: 'pn-' + node.id,
          opacity: dimmed ? 0.3 : 1,
          tabIndex: 0,
          role: 'button',
          'aria-label': readableNodeLabel(node) + (node.kind === 'group'
            ? ' (' + tr('view.groupOf', 'group of {n}').replace('{n}', String(node.memberCount)) + ')'
            : ''),
          style: { cursor: 'pointer' },
          onClick: () => {
            const group = layout.groups.find((item) => item.id === node.id)
            if (group) setOpenGroupId(group.id)
            props.onSelect(group ? group.anchor : node.id)
          },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            const group = layout.groups.find((item) => item.id === node.id)
            if (group) setOpenGroupId(group.id)
            props.onSelect(group ? group.anchor : node.id)
          },
        },
        h('circle', {
          cx: node.x, cy: node.y, r: radius,
          fill: node.kind === 'group' ? THEME.warning : THEME.brand,
          stroke: selected ? THEME.text : THEME.panel,
          strokeWidth: selected ? 2 : 1,
        }),
        h('text', {
          x: node.x,
          y: node.y + (node.kind === 'group' ? 3 : 3),
          textAnchor: 'middle',
          fontSize: 9,
          fill: THEME.panel,
        }, node.kind === 'group' ? String(node.memberCount) : ''),
        h('text', {
          x: node.x + radius + 3,
          y: node.y + 3,
          fontSize: 9,
          fill: THEME.text,
        }, readableNodeLabel(node).slice(0, 40)))
      }))),
    (function () {
      const group = openGroupId
        ? layout.groups.find((item) => item.id === openGroupId) : null
      if (!group) return null
      return h('div', {
        role: 'dialog',
        'aria-modal': false,
        'aria-label': tr('view.cycleMembers', 'Cycle group members'),
        style: {
          position: 'absolute', right: 8, bottom: 26, width: 240, maxHeight: '55%',
          overflow: 'auto', background: THEME.panel, border: '1px solid ' + THEME.border,
          borderRadius: 8, padding: 8, boxShadow: '0 4px 18px rgba(0,0,0,0.18)', zIndex: 4,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
        h('strong', { style: { fontSize: 11, color: THEME.text, flex: '1 1 auto' } },
          tr('view.cycleMembers', 'Cycle group members') + ' (' + String(group.members.length) + ')'),
        iconButton({ padding: '1px 6px', fontSize: 11 }, {
          'aria-label': tr('workspace.close', 'Close'),
          onClick: () => setOpenGroupId(null),
        }, '\u00d7')),
      h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
        group.members.map((memberId) => h('li', { key: memberId, style: { padding: '2px 0' } },
          h('button', {
            type: 'button',
            style: {
              border: 'none', background: 'transparent', color: THEME.text, cursor: 'pointer',
              fontSize: 11, padding: 0, textAlign: 'left', width: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
            title: memberId,
            'aria-label': readableNodeLabel({ id: memberId }),
            onClick: () => {
              props.onSelect(memberId)
              setOpenGroupId(null)
            },
          }, readableNodeLabel({ id: memberId })))))
      )
    })(),
    h('div', {
      style: { position: 'absolute', right: 8, bottom: 6, fontSize: 10, color: THEME.textSecondary },
    }, Math.round(zoom * 100) + '%')))
  }

  /* --------------------------- provenance ------------------------------ */

  function ProvenancePanel(props) {
    const tr = props.tr
    const node = props.node
    const graph = props.graph
    if (!node) return null
    const sourceLabels = props.sourceLabels || {}
    const labelOf = (id) => sourceLabels[id] || id
    const edges = graph && Array.isArray(graph.edges) ? graph.edges : []
    const incident = edges.filter((edge) => edge.source === node.id || edge.target === node.id)
    const provenance = node.provenance && typeof node.provenance === 'object' ? node.provenance : null
    const [openEdge, setOpenEdge] = useState(null)
    const [relationLimit, setRelationLimit] = useState(40)
    return h('div', {
      role: 'dialog',
      'aria-modal': false,
      'aria-label': tr('provenance.title', 'Sources'),
      style: {
        position: 'absolute', right: 8, bottom: 8, width: 300, maxHeight: '60%',
        overflow: 'auto', background: THEME.panel,
        border: '1px solid ' + THEME.border, borderRadius: 8, padding: 10,
        boxShadow: '0 4px 18px rgba(0,0,0,0.18)', zIndex: 4,
      },
    },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
      h('strong', { style: { fontSize: 12, color: THEME.text, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        node.label || node.local || node.id),
      iconButton({ padding: '1px 6px', fontSize: 11 }, {
        'aria-label': tr('workspace.close', 'Close'),
        onClick: props.onClose,
      }, '\u00d7')),
    h('div', { style: { fontSize: 10, color: THEME.textSecondary, wordBreak: 'break-all', marginBottom: 6 } }, node.iri || node.id),
    provenance
      ? h('div', { style: { marginBottom: 6 } },
        h('div', { style: { fontSize: 11, fontWeight: 600, color: THEME.text, marginBottom: 3 } },
          tr('provenance.sources', 'Sources ({n})').replace('{n}', String(provenance.sourceIds.length))),
        provenance.sourceIds.length === 0
          ? h('div', { style: { fontSize: 11, color: THEME.textSecondary } }, tr('provenance.none', 'No retained source'))
          : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
            provenance.sourceIds.map((sourceId) => h('li', {
              key: sourceId,
              style: { fontSize: 11, color: THEME.text, padding: '2px 0' },
            },
            labelOf(sourceId),
            h('span', { style: { color: THEME.textSecondary } },
              ' · ' + tr('provenance.roles', 'roles') + ': ' +
              ((provenance.bySource || []).find(item => item.sourceId === sourceId)?.roles || []).join(', '))))),
        h('div', { style: { fontSize: 10, color: THEME.textSecondary, marginTop: 3 } },
          tr('provenance.statements', '{n} statements').replace('{n}', String((provenance.statementIds || []).length))))
      : null,
    h('div', { style: { fontSize: 11, fontWeight: 600, color: THEME.text, marginBottom: 3 } },
      tr('provenance.relations', 'Relations ({n})').replace('{n}', String(incident.length))),
    h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
      incident.slice(0, relationLimit).map((edge) => {
        const open = openEdge === edge.id
        const outgoing = edge.source === node.id
        const other = outgoing ? edge.target : edge.source
        return h('li', { key: edge.id, style: { borderTop: '1px solid ' + THEME.border, padding: '3px 0' } },
          h('button', {
            type: 'button',
            'aria-expanded': open,
            style: {
              border: 'none', background: 'transparent', color: THEME.text, cursor: 'pointer',
              fontSize: 11, textAlign: 'left', padding: 0, width: '100%',
            },
            onClick: () => setOpenEdge(open ? null : edge.id),
          },
          (outgoing ? '\u2192 ' : '\u2190 ') + edge.label + ' · ' + labelOf(edge.sourceIds && edge.sourceIds[0] ? edge.sourceIds[0] : '') +
            (edge.count > 1 ? ' ×' + edge.count : '')),
          open
            ? h('div', { style: { fontSize: 10, color: THEME.textSecondary, paddingLeft: 10, marginTop: 2 } },
              h('div', null, tr('provenance.subject', 'Subject') + ': ' + edge.source),
              h('div', null, tr('provenance.predicate', 'Predicate') + ': ' + edge.p),
              h('div', null, tr('provenance.object', 'Object') + ': ' + edge.target),
              h('div', null, tr('provenance.sources', 'Sources ({n})').replace('{n}', String((edge.sourceIds || []).length)) +
                ': ' + (edge.sourceIds || []).map(labelOf).join(', ')),
              h('div', null, tr('provenance.graphs', 'Graphs') + ': ' +
                (edge.graphs || []).map((graphItem) => graphItem.kind === 'iri'
                  ? graphItem.value
                  : tr('provenance.graph.' + graphItem.kind, graphItem.kind)).join(', ')),
              h('div', null, tr('provenance.otherEnd', 'Other end') + ': ' + other))
            : null)
      })),
    relationLimit < incident.length ? iconButton({}, {
      onClick: () => setRelationLimit(previous => previous + 40),
    }, tr('viewer.showMore', 'Show more')) : null)
  }

  return {
    WorkspaceToolbar: WorkspaceToolbar,
    SourcePanel: SourcePanel,
    WorkspaceFilePicker: WorkspaceFilePicker,
    ExportMenu: ExportMenu,
    ClassTreeView: ClassTreeView,
    LayeredView: LayeredView,
    ProvenancePanel: ProvenancePanel,
  }
}
