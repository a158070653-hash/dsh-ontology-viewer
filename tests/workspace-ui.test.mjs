/**
 * Component-level tests for the workspace UI shell (6.2): toolbar, export menu
 * and workspace-file picker states. These use the dependency-free hook harness
 * (plain function components need no hooks), so they assert the rendered props
 * and accessible names rather than pixels.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReactHarness, flattenReactTree } from './react-test-harness.mjs'
import { createMultiview, readableNodeLabel } from '../src/graph-view-multiview.js'
import { formatI18nMessage } from '../src/graph-view-workspace.js'
import { layoutLayeredGraph } from '../src/ontology-views.js'

const tr = (key, fallback) => (typeof fallback === 'string' ? fallback : key)

function components() {
  const harness = createReactHarness()
  return createMultiview(harness.React)
}

const byLabel = (tree, label) => flattenReactTree(tree)
  .find((element) => element.props && element.props['aria-label'] === label)
const allByLabel = (tree, label) => flattenReactTree(tree)
  .filter((element) => element.props && element.props['aria-label'] === label)

test('WorkspaceToolbar exposes the three views as a tablist with one selected tab', () => {
  const { WorkspaceToolbar } = components()
  const switched = []
  const tree = WorkspaceToolbar({
    tr, viewType: 'tree', onViewType: (id) => switched.push(id),
    sourcesOpen: false, onToggleSources() {}, sourceCount: 2,
    exportOpen: false, onToggleExport() {},
  })
  const flat = flattenReactTree(tree)
  const tablists = flat.filter((element) => element.props && element.props.role === 'tablist')
  assert.equal(tablists.length, 1)
  const tabs = flat.filter((element) => element.props && element.props.role === 'tab')
  assert.deepEqual(tabs.map((tab) => tab.props['aria-label']), ['Network', 'Class tree', 'Layered'])
  assert.deepEqual(tabs.map((tab) => tab.props['aria-selected']), [false, true, false])
  tabs[0].props.onClick()
  assert.deepEqual(switched, ['network'])
  const sources = byLabel(tree, 'Sources (2)')
  assert.equal(sources.props['aria-expanded'], false)
  assert.equal(sources.children[0], 'Sources 2')
  const exportButton = byLabel(tree, 'Export')
  assert.equal(exportButton.props['aria-expanded'], false)
})

test('WorkspaceToolbar marks the open panels and the selected entity label', () => {
  const { WorkspaceToolbar } = components()
  const tree = WorkspaceToolbar({
    tr, viewType: 'network', onViewType() {},
    sourcesOpen: true, onToggleSources() {}, sourceCount: 0,
    exportOpen: true, onToggleExport() {}, selectedLabel: 'pizza:Topping',
  })
  assert.equal(byLabel(tree, 'Sources').props['aria-expanded'], true)
  assert.equal(byLabel(tree, 'Export').props['aria-expanded'], true)
  const texts = flattenReactTree(tree)
    .map((element) => element.children).flat().filter((value) => typeof value === 'string')
  assert.ok(texts.includes('pizza:Topping'))
})

test('ExportMenu exposes range, scale, SVG, PNG and the copy fallback', () => {
  const { ExportMenu } = components()
  const calls = []
  const tree = ExportMenu({
    tr, range: 'viewport', onRange: (value) => calls.push(['range', value]),
    scale: 2, onScale: (value) => calls.push(['scale', value]),
    onExport: (format) => calls.push(['export', format]),
    onCopySvg: () => calls.push(['copy']),
    busy: false, message: 'Download started.',
  })
  const selects = flattenReactTree(tree).filter((element) => element.type === 'select')
  assert.equal(selects.length, 2)
  assert.equal(selects[0].props['aria-label'], 'Range')
  assert.equal(selects[0].props.value, 'viewport')
  assert.equal(selects[1].props['aria-label'], 'Scale')
  assert.equal(selects[1].props.value, '2')
  eachButton(tree, 'SVG').props.onClick()
  eachButton(tree, 'PNG').props.onClick()
  eachButton(tree, 'Copy SVG').props.onClick()
  assert.deepEqual(calls, [['export', 'svg'], ['export', 'png'], ['copy']])
  const status = flattenReactTree(tree).find((element) => element.props && element.props.role === 'status')
  assert.equal(status.children[0], 'Download started.')
})

function eachButton(tree, label) {
  const button = byLabel(tree, label)
  assert.ok(button, 'missing button ' + label)
  return button
}

test('ExportMenu disables every export action while busy', () => {
  const { ExportMenu } = components()
  const tree = ExportMenu({
    tr, range: 'layout', onRange() {}, scale: 1, onScale() {},
    onExport() {}, onCopySvg() {}, busy: true,
  })
  for (const label of ['SVG', 'PNG', 'Copy SVG']) {
    assert.equal(eachButton(tree, label).props.disabled, true, label + ' must be disabled while busy')
  }
  assert.equal(flattenReactTree(tree).some((element) => element.props && element.props.role === 'status'), false)
})

test('WorkspaceFilePicker covers loading, error, empty and truncated states', () => {
  const { WorkspaceFilePicker } = components()
  const loading = WorkspaceFilePicker({ tr, state: { directory: 'docs', loading: true, entries: [] },
    busy: false, onClose() {}, onNavigate() {}, onToggle() {}, onUp() {}, onConfirm() {} })
  const loadingText = flattenReactTree(loading).map((element) => element.children)
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(loadingText, /Loading/)
  assert.equal(allByLabel(loading, 'Cancel').length, 1)
  assert.equal(byLabel(loading, 'Read selected files').props.disabled, true)

  const failed = WorkspaceFilePicker({ tr, state: { directory: 'docs', error: 'permission denied', entries: [] },
    busy: false, onClose() {}, onNavigate() {}, onToggle() {}, onUp() {}, onConfirm() {} })
  const status = flattenReactTree(failed).find((element) => element.props && element.props.role === 'status')
  assert.equal(status.children[0], 'permission denied')
  const emptyText = flattenReactTree(failed).map((element) => element.children)
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(emptyText, /No files in this directory/)

  const truncated = WorkspaceFilePicker({ tr, state: { directory: 'docs', truncated: true, entries: [] },
    busy: false, onClose() {}, onNavigate() {}, onToggle() {}, onUp() {}, onConfirm() {} })
  const truncatedText = flattenReactTree(truncated).map((element) => element.children)
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(truncatedText, /Directory listing truncated/)
})

test('WorkspaceFilePicker lists folders and selectable files with accessible names', () => {
  const { WorkspaceFilePicker } = components()
  const toggles = []
  const navigations = []
  const tree = WorkspaceFilePicker({
    tr,
    state: {
      directory: 'docs', entries: [
        { path: 'docs/sub', name: 'sub', isDirectory: true },
        { path: 'docs/a.ttl', name: 'a.ttl', size: 128 },
        { path: 'docs/b.nt', name: 'b.nt', size: 64 },
      ],
      selected: ['docs/b.nt'],
    },
    busy: false, onClose() {}, onNavigate: (path) => navigations.push(path),
    onToggle: (path, checked) => toggles.push([path, checked]), onUp() {}, onConfirm() {},
  })
  const folder = byLabel(tree, 'Open folder sub')
  folder.props.onClick()
  assert.deepEqual(navigations, ['docs/sub'])
  const checkboxes = flattenReactTree(tree).filter((element) => element.props && element.props.type === 'checkbox')
  assert.deepEqual(checkboxes.map((box) => box.props['aria-label']), ['Select file a.ttl', 'Select file b.nt'])
  assert.deepEqual(checkboxes.map((box) => box.props.checked), [false, true])
  checkboxes[0].props.onChange({ target: { checked: true } })
  assert.deepEqual(toggles, [['docs/a.ttl', true]])
  const confirm = byLabel(tree, 'Read selected files')
  assert.equal(confirm.props.disabled, false, 'a selection enables the confirm action')
  assert.equal(confirm.children[0], 'Read selected (1)')
})

test('readableNodeLabel strips tagged separators and shortens IRIs', () => {
  assert.equal(readableNodeLabel({ id: 'group\u0000http://example.org/cyc#A', kind: 'group' }), 'A')
  assert.equal(readableNodeLabel({ id: 'urn:Thing' }), 'urn:Thing')
  assert.equal(readableNodeLabel({ id: 'x', label: 'Plain label' }), 'Plain label')
  assert.equal(readableNodeLabel(null), '')
  assert.equal(/[\u0000-\u001f]/.test(readableNodeLabel({ id: 'a\u0000b' })), false)
})

test('LayeredView opens cycle member details and selects a member', () => {
  const graph = {
    nodes: [
      { id: 'urn:x', label: 'x', kind: 'class' },
      { id: 'urn:y', label: 'y', kind: 'class' },
      { id: 'urn:z', label: 'z', kind: 'class' },
    ],
    edges: [
      { id: 'c1', source: 'urn:x', target: 'urn:y', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', label: 'subClassOf', sourceIds: ['s1'] },
      { id: 'c2', source: 'urn:y', target: 'urn:z', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', label: 'subClassOf', sourceIds: ['s1'] },
      { id: 'c3', source: 'urn:z', target: 'urn:x', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', label: 'subClassOf', sourceIds: ['s1'] },
    ],
    warnings: [],
  }
  const selected = []
  const harness = createReactHarness()
  const view = createMultiview(harness.React, { layoutLayeredGraph })
  const props = {
    tr, graph, orientation: 'down', onOrientation() {}, predicates: [], predicateOptions: [],
    onPredicates() {}, selectedId: null, onSelect: (id) => selected.push(id),
    width: 600, height: 400, narrow: false,
  }
  let tree = harness.render(view.LayeredView, props)
  const groupNode = flattenReactTree(tree).find((element) =>
    element.props && element.props.role === 'button' &&
    String(element.props['aria-label'] || '').includes('group of'))
  assert.ok(groupNode, 'the cycle group node is rendered')
  assert.equal(/[\u0000-\u001f]/.test(groupNode.props['aria-label']), false, 'no tagged separators in the name')
  groupNode.props.onClick()
  assert.deepEqual(selected, ['urn:x'], 'clicking the group selects its anchor')
  tree = harness.render(view.LayeredView, props)
  const dialog = flattenReactTree(tree).find((element) =>
    element.props && element.props.role === 'dialog')
  assert.ok(dialog, 'a cycle member panel opens')
  assert.equal(dialog.props['aria-label'], 'Cycle group members')
  const memberButtons = flattenReactTree(dialog).filter((element) =>
    element.type === 'button' && element.props['aria-label'] && element.props['aria-label'] !== 'Close')
  assert.deepEqual(memberButtons.map((button) => button.props['aria-label']).sort(), ['urn:x', 'urn:y', 'urn:z'])
  memberButtons.find((button) => button.props['aria-label'] === 'urn:y').props.onClick()
  assert.deepEqual(selected, ['urn:x', 'urn:y'])
  tree = harness.render(view.LayeredView, props)
  assert.equal(flattenReactTree(tree).some((element) => element.props && element.props.role === 'dialog'), false,
    'choosing a member closes the panel')
})

test('ProvenancePanel shows sources, roles and pages long relation lists', () => {
  const { ProvenancePanel } = components()
  const edges = []
  for (let index = 0; index < 45; index++) {
    edges.push({
      id: 'e' + index, source: 'urn:root', target: 'urn:n' + index, p: 'urn:p', label: 'p',
      count: 1, sourceIds: ['src1'], statementIds: ['statement\u0000src1\u0000' + index],
      graphs: [{ kind: 'default', value: null, sourceIds: ['src1'] }],
    })
  }
  const graph = {
    nodes: [{ id: 'urn:root', label: 'Root', kind: 'individual' }]
      .concat(edges.map((edge, index) => ({ id: edge.target, label: 'n' + index, kind: 'individual' }))),
    edges,
    sources: [{ sourceId: 'src1', displayName: 'pizza.ttl' }],
  }
  const node = {
    id: 'urn:root', label: 'Root', kind: 'individual',
    provenance: { sourceIds: ['src1'], statementIds: ['statement\u0000src1\u00000'], roles: ['subject'],
      bySource: [{ sourceId: 'src1', roles: ['subject'], statementIds: ['statement\u0000src1\u00000'] }] },
  }
  const harness = createReactHarness()
  const view = createMultiview(harness.React)
  const props = { tr, node, graph, sourceLabels: { src1: 'pizza.ttl' }, onClose() {} }
  let tree = harness.render(view.ProvenancePanel, props)
  let flat = flattenReactTree(tree)
  const text = flat.map((element) => element.children).flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(text, /pizza\.ttl/)
  assert.match(text, /subject/)
  assert.ok(/[\u0000-\u001f]/.test(text) === false, 'control separators never appear')
  const relationItems = () => flat.filter((element) => element.type === 'li' && element.children &&
    element.children.some((child) => child && child.type === 'button'))
  assert.equal(relationItems().length, 40, 'the relation list is paged to 40 DOM rows')
  const more = flat.find((element) => element.type === 'button' &&
    String(element.children[0] || '').includes('Show more'))
  assert.ok(more, 'the show-more control is present')
  more.props.onClick()
  tree = harness.render(view.ProvenancePanel, props)
  flat = flattenReactTree(tree)
  assert.equal(relationItems().length, 45, 'all retained relations enter the DOM after showing more')
})

test('theme tokens used for error and warning states exist in the live Host contract', () => {
  const source = readFileSync(new URL('../src/graph-view-multiview.js', import.meta.url), 'utf8')
  // The live Client Theme contract exposes state-error-primary / state-warn-primary
  // (verified via cordis_inspect_query) but NOT label-error / label-warning.
  assert.equal(source.includes('--dsw-alias-label-error'), false)
  assert.equal(source.includes('--dsw-alias-label-warning'), false)
  assert.ok(source.includes('--dsw-alias-state-error-primary'))
  assert.ok(source.includes('--dsw-alias-state-warn-primary'))
})

test('SourcePanel hides the workspace-file picker when the Host capability is unavailable', () => {
  const { SourcePanel } = components()
  const props = {
    tr,
    sources: [{ sourceId: 'a', displayName: 'a.ttl', origin: 'host', status: 'ready', tripleCount: 1 }],
    totals: { files: 1, occurrences: 1 }, worksetIds: [], onSetWorkset() {}, onAddFiles() {},
    onRequestReload() {}, onRemove() {}, onClose() {}, workspaceFilesAvailable: false,
  }
  const tree = SourcePanel(props)
  assert.equal(byLabel(tree, 'Workspace files'), undefined, '方案 A 不可用时不得显示入口')
  const available = SourcePanel(Object.assign({}, props, { workspaceFilesAvailable: true, onPickWorkspaceFiles() {} }))
  assert.ok(byLabel(available, 'Workspace files'), 'capability present shows the picker entry')
})

test('SourcePanel disables sharing and explains why when session identity is unavailable', () => {
  const { SourcePanel } = components()
  const tree = SourcePanel({
    tr,
    sources: [{ sourceId: 'a', displayName: 'a.ttl', origin: 'host', status: 'ready', tripleCount: 1 }],
    totals: { files: 1, occurrences: 1 }, worksetIds: [], onSetWorkset() {}, onAddFiles() {},
    onRequestReload() {}, onRemove() {}, onClose() {},
    onToggleSharing() {}, sharingAvailable: false,
  })
  const share = byLabel(tree, 'Share')
  assert.ok(share, 'the share control still renders')
  assert.equal(share.props.disabled, true, 'sharing is disabled without a reliable Session')
  const text = flattenReactTree(tree).map((element) => element.children)
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(text, /Session identity unavailable/)
})

test('ExportMenu exposes a manual-copy textarea only when the clipboard failed', () => {
  const { ExportMenu } = components()
  const base = {
    tr, range: 'viewport', onRange() {}, scale: 1, onScale() {},
    onExport() {}, onCopySvg() {}, busy: false,
    message: 'Clipboard unavailable; export the SVG file instead.',
  }
  const noText = ExportMenu(base)
  assert.equal(flattenReactTree(noText).some((element) => element.type === 'textarea'), false)
  const withText = ExportMenu(Object.assign({}, base, { svgText: '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>' }))
  const textarea = flattenReactTree(withText).find((element) => element.type === 'textarea')
  assert.ok(textarea, 'a read-only textarea appears after a failed copy')
  assert.equal(textarea.props.readOnly, true)
  assert.equal(textarea.props['aria-label'], 'SVG text')
  assert.match(textarea.props.value, /^<svg /)
  const hint = flattenReactTree(withText).map((element) => element.children)
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(hint, /select and copy the SVG text below/)
})

test('LayeredView opens the cycle member panel from the keyboard too', () => {
  const graph = {
    nodes: [
      { id: 'urn:x', label: 'x', kind: 'class' },
      { id: 'urn:y', label: 'y', kind: 'class' },
    ],
    edges: [
      { id: 'k1', source: 'urn:x', target: 'urn:y', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', label: 'subClassOf', sourceIds: ['s1'] },
      { id: 'k2', source: 'urn:y', target: 'urn:x', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', label: 'subClassOf', sourceIds: ['s1'] },
    ],
    warnings: [],
  }
  const harness = createReactHarness()
  const view = createMultiview(harness.React, { layoutLayeredGraph })
  const props = {
    tr, graph, orientation: 'down', onOrientation() {}, predicates: [], predicateOptions: [],
    onPredicates() {}, selectedId: null, onSelect() {}, width: 600, height: 400, narrow: false,
  }
  let tree = harness.render(view.LayeredView, props)
  const group = flattenReactTree(tree).find((element) =>
    element.props && element.props.role === 'button' &&
    String(element.props['aria-label'] || '').includes('group of'))
  assert.ok(group)
  let prevented = 0
  group.props.onKeyDown({ key: 'Enter', preventDefault() { prevented += 1 } })
  assert.equal(prevented, 1)
  tree = harness.render(view.LayeredView, props)
  const dialog = flattenReactTree(tree).find((element) => element.props && element.props.role === 'dialog')
  assert.ok(dialog, 'Enter on a cycle group opens the member panel')
  const members = flattenReactTree(dialog).filter((element) =>
    element.type === 'button' && element.props['aria-label'] && element.props['aria-label'] !== 'Close')
  assert.deepEqual(members.map((button) => button.props['aria-label']).sort(), ['urn:x', 'urn:y'])
})

test('stored status messages are re-translated at render time', () => {
  const entries = {
    'export.failed': 'Download failed: {reason}',
    'export.blocked': 'Nothing to export yet.',
  }
  const translate = (key, fallback) => entries[key] || fallback || key
  assert.equal(formatI18nMessage(translate, {
    key: 'export.failed', fallback: 'Download failed: {reason}', values: { reason: 'network' },
  }), 'Download failed: network')
  assert.equal(formatI18nMessage(translate, { key: 'export.blocked', fallback: 'x' }), 'Nothing to export yet.')
  assert.equal(formatI18nMessage(translate, {
    key: 'export.failed', fallback: 'Download failed: {reason}', values: {},
  }), 'Download failed: {reason}', 'unknown placeholders stay literal')
  assert.equal(formatI18nMessage(translate, null), '')
  assert.equal(formatI18nMessage(translate, 'plain'), '')
  assert.equal(formatI18nMessage(null, { key: 'x', fallback: 'fallback {n}', values: { n: 2 } }), 'fallback 2')
})
