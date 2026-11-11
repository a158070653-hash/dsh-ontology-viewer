import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, filterBySources, filterGraph, exploreNeighborhood } from '../src/graph-model.js'
import {
  entityKeyForTerm,
  statementIdFor,
  graphIdentityFor,
  isInternalEntityKey,
  describeInternalEntityKey,
  blankEntityKey,
  relativeEntityKey,
} from '../src/ontology-identity.js'
import {
  createWorkspace,
  addSource,
  removeSource,
  replaceSource,
  workspaceAdmission,
  workspaceSummary,
  workspaceTotals,
  composeWorkspaceGraph,
  selectSourceIds,
  markSourceStale,
  WORKSPACE_LIMITS,
} from '../src/ontology-workspace.js'

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const EX = 'http://example.org/'

const IDENTITY = { entityKeyForTerm, statementIdFor, graphIdentityFor }

function makeWorkspace(limits) {
  return createWorkspace({ buildGraph, identity: IDENTITY, limits })
}

function parse(text, options) {
  return parseOntology(text, Object.assign({ format: 'turtle' }, options || {}))
}

function add(workspace, text, options) {
  const opts = options || {}
  const parsed = parse(text, {
    absolutePath: opts.absolutePath,
    navigationAddress: opts.navigationAddress,
    fileName: opts.displayName,
  })
  const result = addSource(workspace, {
    origin: opts.origin || 'host',
    displayName: opts.displayName || 'file.ttl',
    absolutePath: opts.absolutePath,
    navigationAddress: opts.navigationAddress,
    parsed: parsed,
    text: text,
    byteSize: opts.byteSize,
    allowEmpty: true,
  })
  return result
}

function graphFor(workspace, options) {
  const composed = composeWorkspaceGraph(workspace, options || {})
  assert.ok(composed.graph, 'graph must be composed: ' + JSON.stringify(composed.error || ''))
  return composed
}

/* ------------------------------------------------------------------ */
/* Identity                                                           */
/* ------------------------------------------------------------------ */

test('identity: blank nodes and unresolved IRIs are source scoped', () => {
  const a = blankEntityKey('src1', '_:b0')
  const b = blankEntityKey('src2', '_:b0')
  assert.notEqual(a, b)
  assert.equal(a, blankEntityKey('src1', '_:b0'))

  const relA = relativeEntityKey('src1', 'rel')
  const relB = relativeEntityKey('src2', 'rel')
  assert.notEqual(relA, relB)
  assert.ok(isInternalEntityKey(relA))

  // Absolute IRIs identify themselves, regardless of the source.
  assert.equal(entityKeyForTerm('http://e/a', 'src1'), 'http://e/a')
  assert.equal(entityKeyForTerm('http://e/a', 'src2'), 'http://e/a')

  // Unknown graphs are scoped to their source; default and IRI graphs are not.
  assert.notEqual(graphIdentityFor('src1', { kind: 'unknown' }), graphIdentityFor('src2', { kind: 'unknown' }))
  assert.equal(graphIdentityFor('src1', { kind: 'default' }), graphIdentityFor('src2', { kind: 'default' }))
  assert.equal(graphIdentityFor('src1', { kind: 'iri', value: 'http://e/g' }),
    graphIdentityFor('src2', { kind: 'iri', value: 'http://e/g' }))
  assert.notEqual(graphIdentityFor('src1', { kind: 'blank', value: '_:g' }),
    graphIdentityFor('src2', { kind: 'blank', value: '_:g' }))
})

test('identity: internal keys cannot be forged by RDF strings', () => {
  // A user IRI cannot contain U+0000, so internal keys stay in another domain.
  const forged = 'http://e/\u0000blank\u0000'
  assert.equal(isInternalEntityKey(forged), false)
  const keys = [
    blankEntityKey('src1', '_:b0'),
    relativeEntityKey('src1', 'rel'),
    statementIdFor('src1', 0),
  ]
  for (const key of keys) {
    assert.ok(isInternalEntityKey(key))
    assert.notEqual(key, forged)
  }

  // Length prefixes keep separators inside labels from shifting boundaries.
  assert.notDeepEqual(
    describeInternalEntityKey(blankEntityKey('a:b', '_:c')),
    describeInternalEntityKey(blankEntityKey('a', 'b: _:c')),
  )
  assert.deepEqual(describeInternalEntityKey(blankEntityKey('src1', '_:b0')), {
    kind: 'blank', parts: ['src1', '_:b0'],
  })
  assert.equal(describeInternalEntityKey('http://e/a'), null)
})

/* ------------------------------------------------------------------ */
/* Admission and budgets                                              */
/* ------------------------------------------------------------------ */

test('workspace: admission refuses more files than the limit', () => {
  let workspace = makeWorkspace({ maxFiles: 2 })
  for (let index = 0; index < 2; index++) {
    const added = add(workspace, '<http://e/s' + index + '> <http://e/p> <http://e/o> .')
    assert.equal(added.status, 'ready')
    workspace = added.workspace
  }
  const admission = workspaceAdmission(workspace, 10)
  assert.equal(admission.allowed, false)
  assert.equal(admission.reason, 'file-limit')
  const rejected = add(workspace, '<http://e/x> <http://e/p> <http://e/o> .')
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reason, 'file-limit')
  assert.equal(rejected.workspace, workspace)
})

test('workspace: byte and occurrence budgets are shared, not per file', () => {
  let workspace = makeWorkspace({ maxTotalSourceBytes: 40, maxOccurrences: 3 })
  const first = add(workspace, '<http://e/a> <http://e/p> <http://e/o> .', { byteSize: 20 })
  assert.equal(first.status, 'ready')
  workspace = first.workspace

  const second = add(workspace, '<http://e/b> <http://e/p> <http://e/o> .', { byteSize: 30 })
  assert.equal(second.status, 'rejected')
  assert.equal(second.reason, 'byte-budget')

  const admission = workspaceAdmission(workspace, 20)
  assert.equal(admission.allowed, true)
  assert.equal(admission.maxTriples, 2, 'remaining occurrence budget is passed to the parser')

  const totals = workspaceTotals(workspace)
  assert.equal(totals.files, 1)
  assert.equal(totals.bytes, 20)
  assert.equal(totals.occurrences, 1)
  assert.equal(totals.maxOccurrences, 3)
})

test('workspace: removing a source releases its budget', () => {
  let workspace = makeWorkspace({ maxTotalSourceBytes: 40 })
  const first = add(workspace, '<http://e/a> <http://e/p> <http://e/o> .', { byteSize: 40 })
  workspace = first.workspace
  assert.equal(workspaceAdmission(workspace, 1).allowed, false)
  const removed = removeSource(workspace, first.source.sourceId)
  assert.equal(removed.removed, true)
  workspace = removed.workspace
  assert.equal(workspaceAdmission(workspace, 40).allowed, true)
  assert.equal(workspaceTotals(workspace).files, 0)
})

/* ------------------------------------------------------------------ */
/* Adding, removing and reloading sources                             */
/* ------------------------------------------------------------------ */

test('workspace: shared entity keeps both sources; removing one keeps the other', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'shared> .', {
    absolutePath: 'D:/dir/one.ttl', displayName: 'one.ttl',
  })
  workspace = first.workspace
  const second = add(workspace, '<' + EX + 'b> <' + EX + 'p> <' + EX + 'shared> .', {
    absolutePath: 'D:/dir/two.ttl', displayName: 'two.ttl',
  })
  workspace = second.workspace
  assert.equal(workspace.sources.length, 2)

  const graph = graphFor(workspace).graph
  const shared = graph.nodes.find((node) => node.id === EX + 'shared')
  assert.ok(shared, 'shared IRI must be one node')
  assert.deepEqual(shared.provenance.sourceIds, [first.source.sourceId, second.source.sourceId])
  assert.equal(graph.edges.length, 2)

  const removed = removeSource(workspace, first.source.sourceId)
  workspace = removed.workspace
  const after = graphFor(workspace).graph
  const sharedAfter = after.nodes.find((node) => node.id === EX + 'shared')
  assert.deepEqual(sharedAfter.provenance.sourceIds, [second.source.sourceId])
  assert.equal(after.edges.length, 1)
  assert.equal(after.edges[0].sourceIds.length, 1)
})

test('workspace: same display name in different directories stays two sources', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<rel> <' + EX + 'p> <' + EX + 'o> .', {
    absolutePath: 'D:/one/same.ttl', displayName: 'same.ttl',
  })
  workspace = first.workspace
  const second = add(workspace, '<rel> <' + EX + 'p> <' + EX + 'o> .', {
    absolutePath: 'D:/two/same.ttl', displayName: 'same.ttl',
  })
  workspace = second.workspace
  assert.equal(workspace.sources.length, 2)
  const graph = graphFor(workspace).graph
  const subjects = graph.edges.map((edge) => edge.source).sort()
  assert.equal(subjects.length, 2)
  assert.notEqual(subjects[0], subjects[1], 'relative IRIs resolve against different directories')
  assert.ok(subjects.every((id) => id.startsWith('file:///')))
})

test('workspace: blank nodes from different files never merge', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '_:b0 <' + EX + 'p> <' + EX + 'o> .', { absolutePath: 'D:/a.ttl' })
  workspace = first.workspace
  const second = add(workspace, '_:b0 <' + EX + 'p> <' + EX + 'o> .', { absolutePath: 'D:/b.ttl' })
  workspace = second.workspace
  const graph = graphFor(workspace).graph
  const blanks = graph.nodes.filter((node) => node.kind === 'blank')
  assert.equal(blanks.length, 2)
  assert.notEqual(blanks[0].id, blanks[1].id)
  assert.ok(graph.edges.every((edge) => edge.count === 1))
})

test('workspace: duplicate statements merge but keep every source', () => {
  let workspace = makeWorkspace()
  const body = '<' + EX + 'a> <' + EX + 'p> <' + EX + 'b> .'
  const first = add(workspace, body, { absolutePath: 'D:/one.ttl', displayName: 'one.ttl' })
  workspace = first.workspace
  const second = add(workspace, body + '\n' + body, { absolutePath: 'D:/two.ttl', displayName: 'two.ttl' })
  workspace = second.workspace
  const graph = graphFor(workspace).graph
  assert.equal(graph.edges.length, 1)
  const edge = graph.edges[0]
  assert.equal(edge.count, 3, 'occurrence count, not source count')
  assert.deepEqual(edge.sourceIds, [first.source.sourceId, second.source.sourceId])
  assert.equal(edge.statementIds.length, 1, 'identical statements share one identity')
})

test('workspace: named graph identity keeps equal SPO distinct', () => {
  let workspace = makeWorkspace()
  const trig =
    '<' + EX + 'g1> { <' + EX + 'a> <' + EX + 'p> <' + EX + 'b> . }\n' +
    '<' + EX + 'g2> { <' + EX + 'a> <' + EX + 'p> <' + EX + 'b> . }'
  const first = add(workspace, trig, { absolutePath: 'D:/g.trig', displayName: 'g.trig' })
  workspace = first.workspace
  const graph = graphFor(workspace).graph
  assert.equal(graph.edges.length, 1, 'display edges aggregate by SPO')
  const edge = graph.edges[0]
  assert.equal(edge.statementIds.length, 2, 'different graphs are different statements')
  assert.deepEqual(edge.graphs.map((graph) => graph.value).sort(), [EX + 'g1', EX + 'g2'])
})

test('workspace: literals keep their own source provenance', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'label> "one" .', { absolutePath: 'D:/one.ttl' })
  workspace = first.workspace
  const second = add(workspace, '<' + EX + 'a> <' + EX + 'label> "two" .', { absolutePath: 'D:/two.ttl' })
  workspace = second.workspace
  const graph = graphFor(workspace).graph
  const node = graph.nodes.find((item) => item.id === EX + 'a')
  assert.equal(node.literals.length, 2)
  const byValue = new Map(node.literals.map((literal) => [literal.value, literal.sourceIds]))
  assert.deepEqual(byValue.get('one'), [first.source.sourceId])
  assert.deepEqual(byValue.get('two'), [second.source.sourceId])
})

test('workspace: replace is atomic and failed candidates keep the old source', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'b> .', { absolutePath: 'D:/one.ttl' })
  workspace = first.workspace
  const sourceId = first.source.sourceId

  const rejected = replaceSource(workspace, sourceId, {
    parsed: null,
    text: '',
    error: 'read failed',
  })
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.workspace, workspace, 'a rejected reload leaves the workspace untouched')
  assert.equal(rejected.workspace.sources[0].revision, 1)

  const replaced = replaceSource(workspace, sourceId, {
    parsed: parse('<' + EX + 'a> <' + EX + 'q> <' + EX + 'c> .'),
    text: 'subject changed',
    absolutePath: 'D:/one.ttl',
  })
  assert.equal(replaced.status, 'ready')
  workspace = replaced.workspace
  assert.equal(workspace.sources.length, 1)
  assert.equal(workspace.sources[0].sourceId, sourceId)
  assert.equal(workspace.sources[0].revision, 2)
  const graph = graphFor(workspace).graph
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].p, EX + 'q')
  assert.equal(graph.edges[0].count, 1)
})

test('workspace: reload does not accumulate old contributions', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'b> .', { absolutePath: 'D:/one.ttl' })
  workspace = first.workspace
  const reloaded = replaceSource(workspace, first.source.sourceId, {
    parsed: parse('<http://e/x> <http://e/p> <http://e/y> .'),
    text: 'changed',
    absolutePath: 'D:/one.ttl',
  })
  workspace = reloaded.workspace
  const graph = graphFor(workspace).graph
  assert.equal(graph.nodes.some((node) => node.id === EX + 'a'), false)
  assert.equal(graph.nodes.some((node) => node.id === 'http://e/x'), true)
})

test('workspace: source status distinguishes empty, partial and error', () => {
  let workspace = makeWorkspace()
  // Empty but valid document.
  const empty = add(workspace, '@prefix ex: <http://e/> .', { absolutePath: 'D:/empty.ttl' })
  assert.equal(empty.source.status, 'empty')
  workspace = empty.workspace

  // Truncated parse: partial, still admitted with its retained statements.
  const partialParsed = parse('<http://e/a> <http://e/p> <http://e/o> . <http://e/b> <http://e/p> <http://e/o> .', {
    maxTriples: 1,
  })
  const partial = addSource(workspace, {
    origin: 'host',
    displayName: 'partial.ttl',
    absolutePath: 'D:/partial.ttl',
    parsed: partialParsed,
    text: 'x',
  })
  assert.equal(partial.source.status, 'partial')
  workspace = partial.workspace

  // Unreadable file: admitted as a source with an error status and no data.
  const broken = addSource(workspace, {
    origin: 'host',
    displayName: 'broken.ttl',
    error: 'read failed',
    parsed: { triples: [], errors: ['read failed'], warnings: [], diagnostics: [], stats: { tripleCount: 0 } },
    text: '',
  })
  assert.equal(broken.source.status, 'error')
  assert.equal(broken.workspace.sources.length, 3)
  const summary = workspaceSummary(broken.workspace)
  assert.deepEqual(summary.map((item) => item.status), ['empty', 'partial', 'error'])
})

test('workspace: stale marking keeps last good data and only changes once per version', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'b> .', { absolutePath: 'D:/one.ttl' })
  workspace = first.workspace
  const marked = markSourceStale(workspace, first.source.sourceId, 'v2')
  assert.equal(marked.changed, true)
  assert.equal(marked.workspace.sources[0].stale, true)
  assert.equal(marked.workspace.sources[0].occurrenceCount, 1, 'data is kept while stale')
  const again = markSourceStale(marked.workspace, first.source.sourceId, 'v2')
  assert.equal(again.changed, false)
})

/* ------------------------------------------------------------------ */
/* Workset, source filter and exploration                             */
/* ------------------------------------------------------------------ */

test('workspace: selectSourceIds falls back to all sources', () => {
  let workspace = makeWorkspace()
  workspace = add(workspace, '<http://e/a> <http://e/p> <http://e/o> .').workspace
  workspace = add(workspace, '<http://e/b> <http://e/p> <http://e/o> .').workspace
  assert.equal(selectSourceIds(workspace, null).length, 2)
  assert.equal(selectSourceIds(workspace, []).length, 2)
  assert.deepEqual(selectSourceIds(workspace, ['missing']), [])
  assert.deepEqual(selectSourceIds(workspace, [workspace.sources[1].sourceId]),
    [workspace.sources[1].sourceId])
})

test('workspace: a single-file workset rebuilds L1 from that source only', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'shared> .', {
    absolutePath: 'D:/one.ttl',
  })
  workspace = first.workspace
  const second = add(workspace, '<' + EX + 'b> <' + EX + 'p> <' + EX + 'shared> .', {
    absolutePath: 'D:/two.ttl',
  })
  workspace = second.workspace
  const single = graphFor(workspace, { sourceIds: [second.source.sourceId] }).graph
  assert.equal(single.edges.length, 1)
  assert.equal(single.edges[0].source, EX + 'b')
  assert.equal(single.nodes.some((node) => node.id === EX + 'a'), false)
  assert.equal(single.sources.length, 1)
})

test('source filter never brings back another source edge', () => {
  let workspace = makeWorkspace()
  const first = add(workspace, '<' + EX + 'a> <' + EX + 'p> <' + EX + 'shared> .', {
    absolutePath: 'D:/one.ttl',
  })
  workspace = first.workspace
  const second = add(workspace, '<' + EX + 'b> <' + EX + 'q> <' + EX + 'shared> .', {
    absolutePath: 'D:/two.ttl',
  })
  workspace = second.workspace
  const full = graphFor(workspace).graph

  const filtered = filterBySources(full, [first.source.sourceId])
  assert.equal(filtered.edges.length, 1)
  assert.equal(filtered.edges[0].source, EX + 'a')
  assert.equal(filtered.nodes.some((node) => node.id === EX + 'b'), false)
  assert.ok(filtered.hidden.edges >= 1)

  // The source projection feeds the existing type/predicate/direction filter.
  const typed = filterGraph(filtered, { kinds: ['individual'] })
  assert.ok(typed.nodes.length >= 1)

  // Exploration runs on the projected model and cannot cross into source B.
  const explored = exploreNeighborhood(filtered, {
    startId: EX + 'shared', depth: 2, direction: 'both',
  })
  assert.ok(explored.nodes.length >= 1)
  assert.equal(explored.nodes.some((node) => node.id === EX + 'b'), false)
  assert.ok(explored.edges.every((edge) => edge.sourceIds.indexOf(second.source.sourceId) < 0))
})

test('workspace: composing twice without changes is deterministic', () => {
  let workspace = makeWorkspace()
  workspace = add(workspace, readFileSync(new URL('../examples/pizza.ttl', import.meta.url), 'utf8'), {
    absolutePath: 'D:/examples/pizza.ttl',
  }).workspace
  workspace = add(workspace, readFileSync(new URL('../examples/people.nt', import.meta.url), 'utf8'), {
    absolutePath: 'D:/examples/people.nt',
  }).workspace
  const first = JSON.stringify(graphFor(workspace).graph)
  const second = JSON.stringify(graphFor(workspace).graph)
  assert.equal(first, second)
  assert.ok(first.includes('sourceIds'))
})

test('workspace limits expose their defaults for the UI', () => {
  const workspace = makeWorkspace()
  assert.equal(workspace.limits.maxFiles, WORKSPACE_LIMITS.maxFiles)
  assert.equal(workspace.limits.maxOccurrences, WORKSPACE_LIMITS.maxOccurrences)
})

test('workspace: replace counts the staged source, not both versions', () => {
  let workspace = makeWorkspace({ maxOccurrences: 4 })
  const first = add(workspace, '<' + EX + 'a1> <' + EX + 'p> <' + EX + 'o> . <' + EX + 'a2> <' + EX + 'p> <' + EX + 'o> .',
    { absolutePath: 'D:/a.ttl' })
  workspace = first.workspace
  const second = add(workspace, '<' + EX + 'b1> <' + EX + 'p> <' + EX + 'o> . <' + EX + 'b2> <' + EX + 'p> <' + EX + 'o> .',
    { absolutePath: 'D:/b.ttl' })
  workspace = second.workspace
  assert.equal(workspaceTotals(workspace).occurrences, 4)
  // The old and new versions of the replaced source must not be counted at
  // the same time, or an equal-size reload could never fit.
  const replaced = replaceSource(workspace, first.source.sourceId, {
    parsed: parse('<' + EX + 'a1> <' + EX + 'q> <' + EX + 'o> . <' + EX + 'a2> <' + EX + 'q> <' + EX + 'o> .'),
    text: 'reloaded',
    absolutePath: 'D:/a.ttl',
  })
  assert.equal(replaced.status, 'ready')
  assert.equal(workspaceTotals(replaced.workspace).occurrences, 4)
  const graph = graphFor(replaced.workspace).graph
  const reloadedEdges = graph.edges.filter((edge) => edge.p === EX + 'q')
  assert.equal(reloadedEdges.length, 2)
  assert.equal(reloadedEdges.reduce((total, edge) => total + edge.count, 0), 2)
  assert.equal(graph.edges.some((edge) => edge.p === EX + 'p' &&
    (edge.source === EX + 'a1' || edge.source === EX + 'a2')), false)
})
