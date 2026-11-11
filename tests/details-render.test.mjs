/**
 * Rendered details-panel tests (5.2): a component-level check that relation
 * provenance shows readable statement ids, every accepted source and the graph
 * identity, using the dependency-free hook harness instead of a DOM renderer.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReactHarness, flattenReactTree } from './react-test-harness.mjs'
import { createGraphViewDetails } from '../src/graph-view-details.js'

const tr = (key, fallback) => (typeof fallback === 'string' ? fallback : key)

const graph = {
  nodes: [
    { id: 'urn:s', label: 'Subject', kind: 'individual' },
    { id: 'urn:o', label: 'Object', kind: 'individual' },
  ],
  edges: [{
    id: 'e1', source: 'urn:s', target: 'urn:o', p: 'urn:p', label: 'p', count: 2,
    sourceIds: ['src1'], statementIds: ['statement\u0000src1\u00002'],
    graphs: [{ kind: 'default', value: null, sourceIds: ['src1'] }],
  }],
  sources: [{ sourceId: 'src1', displayName: 'pizza.ttl' }],
}

const node = {
  id: 'urn:s', label: 'Subject', kind: 'individual', iri: 'urn:s',
  types: [], literals: [],
  provenance: { sourceIds: ['src1'], statementIds: ['statement\u0000src1\u00002'], roles: ['subject'] },
}

function renderDetails() {
  const harness = createReactHarness()
  const { DetailsPanel } = createGraphViewDetails(harness.React)
  const props = {
    tr, node, graph, sourceLabels: { src1: 'pizza.ttl' },
    onClose() {}, onCopy() {}, onSelectNode() {}, canSelectNode: () => true,
  }
  return { harness, DetailsPanel, props, render: () => harness.render(DetailsPanel, props) }
}

test('DetailsPanel renders relation provenance with readable statement ids and sources', () => {
  const view = renderDetails()
  let tree = view.render()
  const flat = flattenReactTree(tree)
  const relationToggle = flat.find((element) =>
    element.type === 'button' && typeof element.props['aria-label'] === 'string' &&
    element.props['aria-label'].startsWith('关系'))
  assert.ok(relationToggle, 'the incident relation exposes a provenance toggle')
  relationToggle.props.onClick()
  tree = view.render()
  const codeTexts = flattenReactTree(tree)
    .filter((element) => element.type === 'code')
    .map((element) => flattenReactTree(element).map((child) => child.children).flat().filter((value) => typeof value === 'string').join(''))
  const statementLine = codeTexts.find((text) => text.includes('statement'))
  assert.ok(statementLine, 'the expanded relation shows its statement ids')
  assert.equal(statementLine.includes('\u0000'), false, 'control separators never reach the DOM')
  assert.match(statementLine, /statement\s+·\s+src1\s+·\s+2/)
  const sourceLine = codeTexts.find((text) => text === 'src1')
  assert.ok(sourceLine, 'the accepted source id is listed')
})

test('DetailsPanel keeps the graph identity and null location text for a node', () => {
  const view = renderDetails()
  const tree = view.render()
  const texts = flattenReactTree(tree)
    .map((element) => (Array.isArray(element.children) ? element.children : [element.children]))
    .flat().filter((value) => typeof value === 'string').join(' ')
  assert.match(texts, /(图身份|Graph identity)/)
  assert.match(texts, /(语句位置未记录|Statement location is not recorded)/)
  assert.match(texts, /pizza\.ttl/)
})
