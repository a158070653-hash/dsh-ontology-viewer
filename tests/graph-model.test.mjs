import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildGraph,
  layoutGraph,
  shortenIri,
  localName,
  matchNodes,
  subgraph,
  neighborhood,
  filterGraph,
  applyEdgeBudget,
  exploreNeighborhood,
  connectionGroups,
  createLayoutTask,
  budgetRecord,
} from '../src/graph-model.js'

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL = 'http://www.w3.org/2002/07/owl#'
const FOAF = 'http://xmlns.com/foaf/0.1/'
const EX = 'http://example.org/'

const T = {
  type: RDF + 'type',
  first: RDF + 'first',
  rest: RDF + 'rest',
  nil: RDF + 'nil',
  label: RDFS + 'label',
  comment: RDFS + 'comment',
  subClassOf: RDFS + 'subClassOf',
  seeAlso: RDFS + 'seeAlso',
  owlClass: OWL + 'Class',
  objectProperty: OWL + 'ObjectProperty',
  datatypeProperty: OWL + 'DatatypeProperty',
  alice: EX + 'alice',
  bob: EX + 'bob',
  carol: EX + 'carol',
  person: EX + 'Person',
  employee: EX + 'Employee',
  knows: EX + 'knows',
  name: EX + 'name',
  note: EX + 'note',
  bnode: '_:b0',
  list: EX + 'list',
  external: 'http://external.example/Thing',
}

/** Hand-written parsed object that exercises every classification branch. */
function parsedFixture() {
  return {
    format: 'turtle',
    prefixes: { ex: EX, owl: OWL, rdfs: RDFS },
    base: '',
    triples: [
      // classes
      { s: T.person, p: T.type, o: T.owlClass, oKind: 'iri' },
      { s: T.employee, p: T.type, o: T.owlClass, oKind: 'iri' },
      { s: T.employee, p: T.subClassOf, o: T.person, oKind: 'iri' },
      { s: T.person, p: T.label, o: 'Person', oKind: 'literal' },
      // properties
      { s: T.knows, p: T.type, o: T.objectProperty, oKind: 'iri' },
      { s: T.name, p: T.type, o: T.datatypeProperty, oKind: 'iri' },
      { s: T.knows, p: T.label, o: 'knows', oKind: 'literal' },
      // individuals
      { s: T.alice, p: T.type, o: T.person, oKind: 'iri' },
      { s: T.alice, p: T.name, o: 'Alice', oKind: 'literal', lang: 'en' },
      { s: T.alice, p: T.knows, o: T.bob, oKind: 'iri' },
      { s: T.alice, p: T.knows, o: T.bob, oKind: 'iri' }, // parallel edge
      { s: T.alice, p: T.knows, o: T.carol, oKind: 'iri' },
      { s: T.bob, p: T.type, o: T.person, oKind: 'iri' },
      { s: T.bob, p: T.name, o: 'Bob', oKind: 'literal' },
      { s: T.carol, p: T.type, o: T.person, oKind: 'iri' },
      // blank node
      { s: T.bnode, p: T.type, o: T.person, oKind: 'iri' },
      { s: T.bnode, p: T.label, o: 'Anon', oKind: 'literal' },
      { s: T.alice, p: T.seeAlso, o: T.bnode, oKind: 'blank' },
      // external leaf target
      { s: T.bob, p: T.knows, o: T.external, oKind: 'iri' },
      // list plumbing, must not become nodes or edges
      { s: T.list, p: T.first, o: T.alice, oKind: 'iri' },
      { s: T.list, p: T.rest, o: T.nil, oKind: 'iri' },
      // literal-only subject
      { s: T.note, p: T.comment, o: 'hello', oKind: 'literal' },
    ],
    stats: { tripleCount: 22 },
    warnings: [],
    errors: [],
  }
}

function nodeById(graph, id) {
  const node = graph.nodes.find((candidate) => candidate.id === id)
  assert.ok(node, `expected node ${id}`)
  return node
}

function edgeBetween(graph, source, target, predicate) {
  return graph.edges.find((edge) =>
    edge.source === source &&
    edge.target === target &&
    (predicate === undefined || edge.p === predicate))
}

test('buildGraph keeps literals off the node list', () => {
  const graph = buildGraph(parsedFixture())
  const ids = new Set(graph.nodes.map((node) => node.id))

  for (const literalValue of ['Alice', 'Bob', 'Person', 'Anon', 'hello']) {
    assert.equal(ids.has(literalValue), false, `literal ${literalValue} must not be a node`)
  }
  for (const id of graph.nodes.map((node) => node.id)) {
    assert.equal(/^https?:|^_:/u.test(id), true, `node id should be an IRI or blank node: ${id}`)
  }
  assert.equal(ids.has(T.list), false, 'list plumbing subjects are skipped')
  assert.equal(ids.has(T.nil), false, 'rdf:nil is not introduced by list plumbing')

  const alice = nodeById(graph, T.alice)
  assert.equal(alice.literals.length, 1)
  assert.equal(alice.literals[0].p, T.name)
  assert.equal(alice.literals[0].value, 'Alice')
  assert.equal(alice.literals[0].lang, 'en')
  assert.equal(alice.literals[0].pLabel, 'ex:name')
  // ex:name is not a well-known label predicate, so the local name is used.
  assert.equal(alice.label, 'alice')
  assert.equal(alice.local, 'alice')
})

test('buildGraph classifies classes, properties, individuals, blanks and externals', () => {
  const graph = buildGraph(parsedFixture())

  assert.equal(nodeById(graph, T.person).kind, 'class')
  assert.equal(nodeById(graph, T.employee).kind, 'class')
  assert.equal(nodeById(graph, T.owlClass).kind, 'class')
  assert.equal(nodeById(graph, T.knows).kind, 'property')
  assert.equal(nodeById(graph, T.name).kind, 'property')
  assert.equal(nodeById(graph, T.alice).kind, 'individual')
  assert.equal(nodeById(graph, T.carol).kind, 'individual')
  assert.equal(nodeById(graph, T.note).kind, 'individual')
  assert.equal(nodeById(graph, T.bnode).kind, 'blank')
  assert.equal(nodeById(graph, T.external).kind, 'external')

  const person = nodeById(graph, T.person)
  assert.deepEqual(person.types, [T.owlClass])
  assert.equal(person.local, 'Person')
  assert.equal(nodeById(graph, T.alice).types[0], T.person)
  assert.equal(nodeById(graph, T.bnode).label, 'Anon')
  assert.equal(nodeById(graph, T.note).label, 'note', 'rdfs:comment must not become the label')
})

test('buildGraph collapses parallel edges and classifies edge kinds', () => {
  const graph = buildGraph(parsedFixture())

  const parallel = edgeBetween(graph, T.alice, T.bob, T.knows)
  assert.ok(parallel)
  assert.equal(parallel.count, 2)
  assert.equal(parallel.kind, 'object')
  assert.equal(parallel.label, 'ex:knows')

  assert.equal(edgeBetween(graph, T.person, T.owlClass, T.type).kind, 'type')
  assert.equal(edgeBetween(graph, T.employee, T.person, T.subClassOf).kind, 'subclass')
  assert.equal(edgeBetween(graph, T.alice, T.bnode, T.seeAlso).kind, 'blank')

  const keys = graph.edges.map((edge) => edge.source + '|' + edge.p + '|' + edge.target)
  assert.equal(new Set(keys).size, keys.length, 'each (s,p,o) becomes exactly one edge')
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length)
})

test('buildGraph stats match the retained graph', () => {
  const graph = buildGraph(parsedFixture())
  const { stats } = graph

  assert.equal(stats.triples, 22)
  assert.equal(stats.nodes, graph.nodes.length)
  assert.equal(stats.edges, graph.edges.length)
  assert.equal(stats.nodes, 13)
  assert.equal(stats.edges, 13)
  assert.equal(stats.literals, 6)
  assert.equal(stats.classes, 5)
  assert.equal(stats.properties, 2)
  assert.equal(stats.individuals, 4)
  assert.equal(stats.blanks, 1)
  assert.equal(stats.droppedNodes, 0)
  assert.deepEqual(graph.warnings, [])

  const alice = nodeById(graph, T.alice)
  assert.equal(alice.outEdges, 4)
  assert.equal(alice.inEdges, 0)
  assert.equal(alice.degree, 4)
  assert.equal(nodeById(graph, T.bob).inEdges, 1)
})

test('maxNodes keeps the highest-degree nodes and reports the drop', () => {
  const triples = []
  const leafCount = 12
  for (let index = 0; index < leafCount; index += 1) {
    triples.push({
      s: EX + 'hub',
      p: EX + 'link',
      o: EX + 'leaf-' + String(index).padStart(2, '0'),
      oKind: 'iri',
    })
  }
  const graph = buildGraph({ triples }, { maxNodes: 5 })

  assert.equal(graph.nodes.length, 5)
  assert.equal(graph.stats.nodes, 5)
  assert.equal(graph.stats.droppedNodes, leafCount + 1 - 5)
  assert.equal(graph.edges.length, 4)
  assert.equal(graph.stats.edges, 4)
  assert.ok(nodeById(graph, EX + 'hub'), 'the hub is the highest-degree node')
  assert.equal(graph.warnings.length, 1)
  assert.match(graph.warnings[0], /dropped 8/u)

  // The four retained leaves are the lexicographically first ones, deterministically.
  const retainedLeaves = graph.nodes
    .filter((node) => node.id !== EX + 'hub')
    .map((node) => node.id)
  assert.deepEqual(retainedLeaves, [
    EX + 'leaf-00',
    EX + 'leaf-01',
    EX + 'leaf-02',
    EX + 'leaf-03',
  ])
})

test('buildGraph tolerates malformed input', () => {
  for (const input of [null, undefined, {}, { triples: 'nope' }, { triples: [null, 42, {}] }]) {
    const graph = buildGraph(input)
    assert.deepEqual(graph.nodes, [])
    assert.deepEqual(graph.edges, [])
    assert.equal(graph.stats.nodes, 0)
    assert.equal(graph.stats.edges, 0)
  }

  const graph = buildGraph({
    triples: [
      { p: T.type, o: T.person, oKind: 'iri' }, // no subject
      { s: T.alice, o: 'x', oKind: 'literal' }, // no predicate
      { s: T.alice, p: T.name, o: null, oKind: 'literal' }, // no object
    ],
  })
  assert.equal(graph.nodes.length, 0)
  assert.equal(graph.edges.length, 0)
})

function twoClustersGraph() {
  const nodes = []
  for (const id of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
    nodes.push({
      id: EX + id,
      label: id,
      iri: EX + id,
      local: id,
      kind: 'individual',
      types: [],
      degree: 1,
      literals: [],
      outEdges: 1,
      inEdges: 1,
    })
  }
  const edges = []
  const pairs = [['a1', 'a2'], ['a2', 'a3'], ['b1', 'b2'], ['b2', 'b3']]
  for (const [from, to] of pairs) {
    edges.push({
      id: 'e' + edges.length,
      source: EX + from,
      target: EX + to,
      p: EX + 'link',
      label: 'link',
      kind: 'object',
      count: 1,
    })
  }
  return {
    nodes,
    edges,
    stats: { triples: 4, nodes: 6, edges: 4, literals: 0, classes: 0, properties: 0, individuals: 6, blanks: 0, droppedNodes: 0 },
    warnings: [],
  }
}

test('layoutGraph is deterministic for a fixed seed', () => {
  const graph = buildGraph(parsedFixture())
  const options = { width: 800, height: 600, iterations: 120, seed: 7 }

  const first = layoutGraph(graph, options)
  const second = layoutGraph(graph, options)
  assert.deepEqual(first, second)
  assert.equal(first.length, graph.nodes.length)
  assert.deepEqual(first.map((point) => point.id), graph.nodes.map((node) => node.id))
})

test('layoutGraph reacts to a different seed', () => {
  const graph = buildGraph(parsedFixture())
  const base = { width: 800, height: 600, iterations: 120 }
  const first = layoutGraph(graph, { ...base, seed: 1 })
  const second = layoutGraph(graph, { ...base, seed: 99 })

  assert.notDeepEqual(
    first.map((point) => [point.x, point.y]),
    second.map((point) => [point.x, point.y]),
  )
})

test('layoutGraph keeps every point finite and inside the padded box', () => {
  const graph = buildGraph(parsedFixture())
  const options = { width: 800, height: 600, iterations: 160, seed: 3, padding: 24 }
  const points = layoutGraph(graph, options)

  for (const point of points) {
    assert.equal(Number.isFinite(point.x), true, `x is finite for ${point.id}`)
    assert.equal(Number.isFinite(point.y), true, `y is finite for ${point.id}`)
    assert.equal(Number.isFinite(point.vx), true)
    assert.equal(Number.isFinite(point.vy), true)
    assert.ok(point.x >= options.padding - 1e-6, `x below padding: ${point.x}`)
    assert.ok(point.x <= options.width - options.padding + 1e-6, `x above width: ${point.x}`)
    assert.ok(point.y >= options.padding - 1e-6, `y below padding: ${point.y}`)
    assert.ok(point.y <= options.height - options.padding + 1e-6, `y above height: ${point.y}`)
  }
})

test('layoutGraph handles empty, single-node and zero-edge graphs', () => {
  assert.deepEqual(layoutGraph(null), [])
  assert.deepEqual(layoutGraph({ nodes: [], edges: [] }), [])

  const single = layoutGraph({ nodes: [{ id: EX + 'only' }], edges: [] }, { width: 800, height: 600 })
  assert.deepEqual(single, [{ id: EX + 'only', x: 400, y: 300, vx: 0, vy: 0 }])

  const isolated = layoutGraph(
    { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [] },
    { width: 900, height: 600, seed: 5 },
  )
  assert.equal(isolated.length, 3)
  const distances = [
    Math.hypot(isolated[0].x - isolated[1].x, isolated[0].y - isolated[1].y),
    Math.hypot(isolated[1].x - isolated[2].x, isolated[1].y - isolated[2].y),
    Math.hypot(isolated[0].x - isolated[2].x, isolated[0].y - isolated[2].y),
  ]
  assert.ok(Math.min(...distances) > 10, 'isolated nodes must not collapse to one point')
})

test('layoutGraph separates disconnected components', () => {
  const graph = twoClustersGraph()
  const width = 800
  const points = layoutGraph(graph, { width, height: 600, iterations: 220, seed: 11 })
  const byId = new Map(points.map((point) => [point.id, point]))

  function centroid(ids) {
    const slice = ids.map((id) => byId.get(EX + id))
    return {
      x: slice.reduce((sum, point) => sum + point.x, 0) / slice.length,
      y: slice.reduce((sum, point) => sum + point.y, 0) / slice.length,
    }
  }

  const left = centroid(['a1', 'a2', 'a3'])
  const right = centroid(['b1', 'b2', 'b3'])
  const distance = Math.hypot(left.x - right.x, left.y - right.y)
  assert.ok(
    distance > width * 0.1,
    `cluster centroids collapsed: distance ${distance} of width ${width}`,
  )
})

test('layoutGraph does not mutate the input graph', () => {
  const graph = twoClustersGraph()
  const snapshot = JSON.stringify(graph)
  layoutGraph(graph, { width: 700, height: 500, iterations: 40, seed: 2 })
  assert.equal(JSON.stringify(graph), snapshot)
})

test('shortenIri uses the prefix map, then the local name, then the IRI', () => {
  const prefixes = { foaf: FOAF, ex: EX }
  assert.equal(shortenIri(FOAF + 'Person', prefixes), 'foaf:Person')
  assert.equal(shortenIri(EX + 'alice', prefixes), 'ex:alice')
  assert.equal(shortenIri(EX + 'alice', { foaf: FOAF }), 'alice')
  assert.equal(shortenIri(FOAF + 'Person', undefined), 'Person')
  assert.equal(shortenIri(FOAF + 'Person', {}), 'Person')
  assert.equal(shortenIri(EX, prefixes), EX, 'an IRI with no local part falls back to itself')
  assert.equal(shortenIri('urn:uuid:1234', {}), '1234')
  assert.equal(shortenIri('', prefixes), '')
  assert.equal(shortenIri(null, prefixes), '')

  // Longest namespace wins and the default prefix drops its colon.
  assert.equal(
    shortenIri('http://example.org/people/alice', {
      ex: 'http://example.org/',
      people: 'http://example.org/people/',
    }),
    'people:alice',
  )
  assert.equal(shortenIri(EX + 'alice', { '': EX }), 'alice')
})

test('localName handles hashes, slashes, URNs and blank nodes', () => {
  assert.equal(localName(EX + 'alice'), 'alice')
  assert.equal(localName(RDFS + 'label'), 'label')
  assert.equal(localName('_:b0'), 'b0')
  assert.equal(localName('urn:uuid:1234'), '1234')
  assert.equal(localName('mailto:alice@example.org'), 'alice@example.org')
  assert.equal(localName('plain'), 'plain')
  assert.equal(localName(''), '')
  assert.equal(localName(null), '')
  assert.equal(localName(42), '')
  assert.equal(localName(EX), '')
})

test('matchNodes is case-insensitive, ordered and limited', () => {
  const graph = buildGraph(parsedFixture())

  assert.deepEqual(matchNodes(graph, 'ali'), [T.alice])
  assert.deepEqual(matchNodes(graph, 'ALICE'), [T.alice])
  assert.deepEqual(matchNodes(graph, '   '), [])
  assert.deepEqual(matchNodes(graph, 'no-such-label'), [])
  assert.deepEqual(matchNodes(graph, 'http://example.org/carol'), [T.carol])

  const personMatches = matchNodes(graph, 'person')
  assert.ok(personMatches.includes(T.person))
  assert.equal(matchNodes(graph, 'person', 1).length, 1)

  // Exact label matches rank ahead of substring matches.
  const broad = matchNodes(graph, 'knows')
  assert.equal(broad[0], T.knows)
})

test('subgraph keeps only induced edges', () => {
  const graph = buildGraph(parsedFixture())
  const part = subgraph(graph, [T.alice, T.bob])

  assert.equal(part.nodes.length, 2)
  assert.deepEqual(part.nodes.map((node) => node.id).sort(), [T.alice, T.bob].sort())
  assert.equal(part.edges.length, 1)
  assert.equal(part.edges[0].source, T.alice)
  assert.equal(part.edges[0].target, T.bob)
  assert.equal(part.stats.nodes, 2)
  assert.equal(part.stats.edges, 1)
  assert.equal(part.stats.triples, 22)

  const empty = subgraph(graph, [])
  assert.equal(empty.nodes.length, 0)
  assert.equal(empty.edges.length, 0)

  const missing = subgraph(null, ['x'])
  assert.deepEqual(missing.nodes, [])
  assert.deepEqual(missing.edges, [])
})

test('neighborhood walks 1 and 2 hops and includes the start node', () => {
  const graph = buildGraph(parsedFixture())

  const oneHop = neighborhood(graph, T.alice, 1)
  assert.deepEqual(new Set(oneHop), new Set([T.alice, T.person, T.bob, T.carol, T.bnode]))
  assert.equal(oneHop[0], T.alice)
  assert.equal(new Set(oneHop).size, oneHop.length, 'no duplicate ids')

  const twoHops = neighborhood(graph, T.alice, 2)
  assert.ok(twoHops.length > oneHop.length)
  assert.ok(twoHops.includes(T.external), 'reaches the second hop through bob')
  assert.ok(twoHops.includes(T.employee), 'reaches the superclass through Person')
  assert.ok(twoHops.includes(T.owlClass), 'reaches the meta-class through Person')

  assert.deepEqual(neighborhood(graph, T.alice, 0), [T.alice])
  assert.deepEqual(neighborhood(graph, 'http://example.org/missing', 1), [])
  assert.deepEqual(neighborhood(null, T.alice, 1), [])
})

// ---------------------------------------------------------------------------
// Budget records, truncation metadata and source metadata
// ---------------------------------------------------------------------------

test('budgetRecord normalises total/kept/truncated/reason', () => {
  assert.deepEqual(budgetRecord(10, 7, 'max-nodes'), { total: 10, kept: 7, truncated: 3, reason: 'max-nodes' })
  assert.deepEqual(budgetRecord(4, 4, 'max-nodes'), { total: 4, kept: 4, truncated: 0, reason: null })
  assert.deepEqual(budgetRecord(0, 0, null), { total: 0, kept: 0, truncated: 0, reason: null })
  assert.deepEqual(budgetRecord(3, 5, 'x'), { total: 3, kept: 3, truncated: 0, reason: null })
})

test('buildGraph reports empty truncation records and reserved source fields when nothing drops', () => {
  const graph = buildGraph(parsedFixture())

  assert.deepEqual(graph.source, { address: '', displayName: '', format: 'turtle' })
  assert.deepEqual(graph.truncation.nodes, { total: 13, kept: 13, truncated: 0, reason: null })
  assert.deepEqual(
    {
      total: graph.truncation.literals.total,
      kept: graph.truncation.literals.kept,
      truncated: graph.truncation.literals.truncated,
      reason: graph.truncation.literals.reason,
    },
    { total: 6, kept: 6, truncated: 0, reason: null },
  )
  assert.equal(graph.truncation.literals.perNodeLimit, 60)
  assert.equal(graph.truncation.literals.truncatedNodes, 0)
  assert.equal(graph.truncation.literals.valueTruncated, 0)
  assert.deepEqual(graph.truncation.edges, {
    total: 13,
    kept: 13,
    truncated: 0,
    reason: null,
    droppedByNodeLimit: 0,
    droppedByBudget: 0,
  })
  assert.equal(graph.stats.droppedEdges, 0)
  assert.equal(graph.stats.droppedLiterals, 0)
  for (const node of graph.nodes) {
    assert.equal(node.literalsTruncated, 0, `literalsTruncated is 0 for ${node.id}`)
    assert.equal(node.source, null, `node.source is reserved and always null for ${node.id}`)
  }
  assert.deepEqual(graph.warnings, [])
})

test('buildGraph resolves source metadata from options or the parsed document', () => {
  const parsed = parsedFixture()

  assert.deepEqual(
    buildGraph(parsed, {
      source: { address: 'file:///tmp/demo.ttl', displayName: 'demo.ttl', format: 'turtle' },
    }).source,
    { address: 'file:///tmp/demo.ttl', displayName: 'demo.ttl', format: 'turtle' },
  )

  const fromResource = buildGraph({ ...parsed, resourceAddress: 'file:///data/demo.ttl' })
  assert.equal(fromResource.source.address, 'file:///data/demo.ttl')
  assert.equal(fromResource.source.displayName, '')
  assert.equal(fromResource.source.format, 'turtle')

  const resourceBase = buildGraph({ triples: [], base: 'http://example.org/demo', baseSource: 'resource' })
  assert.equal(resourceBase.source.address, 'http://example.org/demo')

  const documentBase = buildGraph({ triples: [], base: 'http://example.org/vocab#', baseSource: 'document' })
  assert.equal(documentBase.source.address, '', 'a document @base is not a resource address')
})

test('maxNodes reports structured truncation metadata and dropped edges', () => {
  const triples = []
  for (let index = 0; index < 12; index += 1) {
    triples.push({
      s: EX + 'hub',
      p: EX + 'link',
      o: EX + 'leaf-' + String(index).padStart(2, '0'),
      oKind: 'iri',
    })
  }
  const graph = buildGraph({ triples }, { maxNodes: 5 })

  assert.deepEqual(graph.truncation.nodes, { total: 13, kept: 5, truncated: 8, reason: 'max-nodes' })
  assert.equal(graph.stats.droppedNodes, 8)
  assert.deepEqual(graph.truncation.edges, {
    total: 12,
    kept: 4,
    truncated: 8,
    reason: 'node-limit',
    droppedByNodeLimit: 8,
    droppedByBudget: 0,
  })
  assert.equal(graph.stats.droppedEdges, 8)
})

test('per-node literal truncation reports literalsTruncated and graph-level totals', () => {
  const triples = []
  for (let index = 0; index < 5; index += 1) {
    triples.push({ s: EX + 'note', p: EX + 'tag', o: 'v' + index, oKind: 'literal' })
  }
  const graph = buildGraph({ triples }, { maxLiteralsPerNode: 2 })
  const note = nodeById(graph, EX + 'note')

  assert.equal(note.literals.length, 2)
  assert.equal(note.literalsTruncated, 3)
  assert.deepEqual(
    {
      total: graph.truncation.literals.total,
      kept: graph.truncation.literals.kept,
      truncated: graph.truncation.literals.truncated,
      reason: graph.truncation.literals.reason,
    },
    { total: 5, kept: 2, truncated: 3, reason: 'max-literals-per-node' },
  )
  assert.equal(graph.truncation.literals.perNodeLimit, 2)
  assert.equal(graph.truncation.literals.truncatedNodes, 1)
  assert.equal(graph.stats.droppedLiterals, 3)
  assert.equal(graph.stats.literals, 2)
  assert.ok(graph.warnings.some((warning) => /truncated to 2 per node/u.test(warning)))
})

test('maxLiteralLength truncates values, marks the literal and counts them', () => {
  const triples = [
    { s: EX + 'note', p: EX + 'tag', o: 'abcdefghij', oKind: 'literal' },
    { s: EX + 'note', p: EX + 'tag', o: 'short', oKind: 'literal' },
  ]
  const graph = buildGraph({ triples }, { maxLiteralLength: 4 })
  const note = nodeById(graph, EX + 'note')

  assert.deepEqual(note.literals.map((literal) => literal.value).sort(), ['abcd', 'shor'])
  assert.equal(note.literals.filter((literal) => literal.truncated === true).length, 2)
  assert.equal(graph.truncation.literals.valueTruncated, 2)
  assert.equal(graph.truncation.literals.truncated, 0)
  assert.equal(graph.stats.droppedLiterals, 0)
  assert.ok(graph.warnings.some((warning) => /4 characters/u.test(warning)))
})

test('buildGraph maxEdges keeps the highest-count edges deterministically', () => {
  const triples = [
    { s: EX + 'hub', p: EX + 'a', o: EX + 'x', oKind: 'iri' },
    { s: EX + 'hub', p: EX + 'a', o: EX + 'x', oKind: 'iri' }, // count 2
    { s: EX + 'hub', p: EX + 'b', o: EX + 'y', oKind: 'iri' },
    { s: EX + 'hub', p: EX + 'b', o: EX + 'y', oKind: 'iri' },
    { s: EX + 'hub', p: EX + 'b', o: EX + 'y', oKind: 'iri' }, // count 3
    { s: EX + 'hub', p: EX + 'c', o: EX + 'z', oKind: 'iri' }, // count 1
  ]
  const first = buildGraph({ triples }, { maxEdges: 2 })
  const second = buildGraph({ triples }, { maxEdges: 2 })

  assert.deepEqual(second, first)
  assert.equal(first.edges.length, 2)
  // Selection is by priority, emission keeps first-occurrence (stable id) order.
  assert.deepEqual(first.edges.map((edge) => [edge.p, edge.target]), [
    [EX + 'a', EX + 'x'],
    [EX + 'b', EX + 'y'],
  ])
  assert.equal(first.stats.droppedEdges, 1)
  assert.deepEqual(first.truncation.edges, {
    total: 3,
    kept: 2,
    truncated: 1,
    reason: 'max-edges',
    droppedByNodeLimit: 0,
    droppedByBudget: 1,
  })
  assert.ok(first.warnings.some((warning) => /edge limit/u.test(warning)))
})

// ---------------------------------------------------------------------------
// filterGraph (L2 projection)
// ---------------------------------------------------------------------------

function manualNode(id, kind, extra) {
  return Object.assign({
    id,
    label: localName(id),
    iri: id,
    local: localName(id),
    kind,
    types: [],
    degree: 0,
    literals: [],
    outEdges: 0,
    inEdges: 0,
    literalsTruncated: 0,
    source: null,
  }, extra)
}

function manualEdge(id, source, target, predicate, extra) {
  return Object.assign({
    id,
    source,
    target,
    p: predicate,
    label: localName(predicate),
    kind: 'object',
    count: 1,
  }, extra)
}

function manualGraph(nodes, edges) {
  return { nodes, edges, stats: { triples: edges.length }, warnings: [] }
}

function filterFixtureGraph() {
  return manualGraph(
    [
      manualNode(EX + 'A', 'individual'),
      manualNode(EX + 'B', 'individual'),
      manualNode(EX + 'C', 'class'),
      manualNode(EX + 'D', 'class'),
      manualNode(EX + 'E', 'external'),
    ],
    [
      manualEdge('e0', EX + 'A', EX + 'B', EX + 'knows'),
      manualEdge('e1', EX + 'B', EX + 'C', EX + 'knows'),
      manualEdge('e2', EX + 'A', EX + 'C', RDF + 'type', { kind: 'type' }),
      manualEdge('e3', EX + 'C', EX + 'D', RDFS + 'subClassOf', { kind: 'subclass' }),
      manualEdge('e4', EX + 'E', EX + 'A', EX + 'ref'),
    ],
  )
}

test('filterGraph without criteria is an identity projection that does not mutate the graph', () => {
  const graph = filterFixtureGraph()
  const snapshot = JSON.stringify(graph)
  const projection = filterGraph(graph, {})

  assert.deepEqual(projection.nodes.map((node) => node.id), graph.nodes.map((node) => node.id))
  assert.deepEqual(projection.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))
  assert.equal(projection.stats.nodes, 5)
  assert.equal(projection.stats.edges, 5)
  assert.equal(projection.stats.triples, 5)
  assert.equal(projection.stats.totalNodes, 5)
  assert.equal(projection.stats.totalEdges, 5)
  assert.deepEqual(projection.hidden, {
    nodes: 0,
    edges: 0,
    byKind: { nodes: 0 },
    byPredicate: { edges: 0 },
    byDirection: { edges: 0 },
  })
  assert.deepEqual(projection.graph.nodes, projection.nodes)
  assert.deepEqual(projection.graph.edges, projection.edges)
  assert.equal(JSON.stringify(graph), snapshot, 'the source graph must not be mutated')
})

test('filterGraph kind filter keeps selected kinds and internal edges only', () => {
  const graph = filterFixtureGraph()
  const projection = filterGraph(graph, { kinds: ['class'] })

  assert.deepEqual(projection.nodes.map((node) => node.id), [EX + 'C', EX + 'D'])
  assert.deepEqual(projection.edges.map((edge) => edge.id), ['e3'])
  assert.equal(projection.hidden.nodes, 3)
  assert.equal(projection.hidden.edges, 4)
  assert.equal(projection.hidden.byKind.nodes, 3)
})

test('filterGraph always keeps the anchor node even when it fails the kind filter', () => {
  const graph = filterFixtureGraph()
  const projection = filterGraph(graph, { kinds: ['class'], anchorId: EX + 'A' })

  assert.deepEqual(projection.nodes.map((node) => node.id), [EX + 'A', EX + 'C', EX + 'D'])
  assert.deepEqual(projection.edges.map((edge) => edge.id), ['e2', 'e3'])
  assert.equal(projection.hidden.nodes, 2)
  assert.equal(projection.hidden.byKind.nodes, 2)
})

test('filterGraph predicate filter drops now-isolated nodes except the anchor', () => {
  const graph = filterFixtureGraph()
  const projection = filterGraph(graph, { predicates: [EX + 'knows'] })

  assert.deepEqual(projection.nodes.map((node) => node.id), [EX + 'A', EX + 'B', EX + 'C'])
  assert.deepEqual(projection.edges.map((edge) => edge.id), ['e0', 'e1'])
  assert.equal(projection.hidden.edges, 3)
  assert.equal(projection.hidden.byPredicate.edges, 3)

  const anchored = filterGraph(graph, { predicates: [EX + 'knows'], anchorId: EX + 'E' })
  assert.ok(anchored.nodes.some((node) => node.id === EX + 'E'), 'an isolated anchor stays visible')
  assert.equal(anchored.stats.nodes, 4)
})

test('filterGraph direction filters direct incident edges and is inert without an anchor', () => {
  const graph = filterFixtureGraph()

  const withoutAnchor = filterGraph(graph, { direction: 'out' })
  assert.deepEqual(withoutAnchor.nodes.map((node) => node.id), graph.nodes.map((node) => node.id))
  assert.deepEqual(withoutAnchor.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))
  assert.equal(withoutAnchor.hidden.byDirection.edges, 0)

  // 'both' keeps the anchor's direct in+out relations only (no traversal).
  const both = filterGraph(graph, { direction: 'both', anchorId: EX + 'A' })
  assert.deepEqual(both.nodes.map((node) => node.id), [EX + 'A', EX + 'B', EX + 'C', EX + 'E'])
  assert.deepEqual(both.edges.map((edge) => edge.id), ['e0', 'e2', 'e4'])
  assert.equal(both.hidden.byDirection.edges, 2)
  assert.equal(both.hidden.nodes, 1)

  // 'out' keeps edges leaving the anchor: E -> A and the B/C edges are dropped.
  const outgoing = filterGraph(graph, { direction: 'out', anchorId: EX + 'A' })
  assert.deepEqual(outgoing.nodes.map((node) => node.id), [EX + 'A', EX + 'B', EX + 'C'])
  assert.deepEqual(outgoing.edges.map((edge) => edge.id), ['e0', 'e2'])
  assert.equal(outgoing.hidden.byDirection.edges, 3)
  assert.equal(outgoing.hidden.nodes, 2)

  const incoming = filterGraph(graph, { direction: 'in', anchorId: EX + 'A' })
  assert.deepEqual(incoming.nodes.map((node) => node.id), [EX + 'A', EX + 'E'])
  assert.deepEqual(incoming.edges.map((edge) => edge.id), ['e4'])
  assert.equal(incoming.hidden.byDirection.edges, 4)

  const missingAnchor = filterGraph(graph, { direction: 'out', anchorId: EX + 'missing' })
  assert.deepEqual(missingAnchor.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))

  // An anchor without an explicit direction leaves direction filtering inert.
  const anchoredOnly = filterGraph(graph, { anchorId: EX + 'A' })
  assert.deepEqual(anchoredOnly.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))
  assert.equal(anchoredOnly.hidden.byDirection.edges, 0)
})

test('filterGraph direction never expands past the anchor\'s direct neighbours', () => {
  const graph = chainGraph() // a -> b -> c -> d -> e -> f

  const outgoing = filterGraph(graph, { direction: 'out', anchorId: EX + 'b' })
  assert.deepEqual(outgoing.nodes.map((node) => node.id), [EX + 'b', EX + 'c'])
  assert.deepEqual(outgoing.edges.map((edge) => edge.id), ['e1'])
  assert.equal(outgoing.nodes.some((node) => node.id === EX + 'd'), false, 'no grandchildren')

  const incoming = filterGraph(graph, { direction: 'in', anchorId: EX + 'b' })
  assert.deepEqual(incoming.nodes.map((node) => node.id), [EX + 'a', EX + 'b'])
  assert.deepEqual(incoming.edges.map((edge) => edge.id), ['e0'])

  const both = filterGraph(graph, { direction: 'both', anchorId: EX + 'b' })
  assert.deepEqual(both.nodes.map((node) => node.id), [EX + 'a', EX + 'b', EX + 'c'])
  assert.deepEqual(both.edges.map((edge) => edge.id), ['e0', 'e1'])
})

test('filterGraph direction composes with bounded multi-hop exploration', () => {
  const graph = chainGraph() // a -> b -> c -> d -> e -> f

  // The filter layer is the 1-hop direction view: anchor + direct neighbours.
  const oneHop = filterGraph(graph, { direction: 'out', anchorId: EX + 'a' })
  assert.deepEqual(oneHop.nodes.map((node) => node.id), [EX + 'a', EX + 'b'])
  assert.deepEqual(oneHop.edges.map((edge) => edge.id), ['e0'])

  // Multi-hop expansion is the explorer's job: filter with no anchor so the
  // direction stays inert, then apply direction/depth per hop.
  const projection = filterGraph(graph, {})
  const twoHops = exploreNeighborhood(projection, {
    startId: EX + 'a',
    depth: 2,
    direction: 'out',
    budget: { perHopNodes: 100, maxEdges: 100 },
  })
  assert.deepEqual(twoHops.nodeIds, [EX + 'a', EX + 'b', EX + 'c'])
})

// ---------------------------------------------------------------------------
// applyEdgeBudget (L4 draw projection)
// ---------------------------------------------------------------------------

function budgetFixtureGraph() {
  return manualGraph(
    [
      manualNode(EX + 'n1', 'individual'),
      manualNode(EX + 'n2', 'individual'),
      manualNode(EX + 'n3', 'individual'),
      manualNode(EX + 'n4', 'individual'),
    ],
    [
      manualEdge('e0', EX + 'n1', EX + 'n2', EX + 'link', { count: 1 }),
      manualEdge('e1', EX + 'n1', EX + 'n3', EX + 'link', { count: 3 }),
      manualEdge('e2', EX + 'n2', EX + 'n4', EX + 'link', { count: 2 }),
      manualEdge('e3', EX + 'n1', EX + 'n4', EX + 'link', { count: 1 }),
      manualEdge('e4', EX + 'n3', EX + 'n4', EX + 'link', { count: 5 }),
    ],
  )
}

test('applyEdgeBudget keeps every edge when the budget is not exceeded', () => {
  const graph = budgetFixtureGraph()
  const snapshot = JSON.stringify(graph)
  const result = applyEdgeBudget(graph, { maxEdges: 10 })

  assert.deepEqual(result.nodes, graph.nodes)
  assert.deepEqual(result.edges, graph.edges)
  assert.deepEqual(result.stats, { keptEdges: 5, hiddenEdges: 0, totalEdges: 5 })
  assert.deepEqual(result.truncation.edges, { total: 5, kept: 5, truncated: 0, reason: null })
  assert.equal(result.displayOnly, true)
  assert.equal(JSON.stringify(graph), snapshot)
})

test('applyEdgeBudget prioritises incident edges, then parallel count, deterministically', () => {
  const graph = budgetFixtureGraph()

  const byCount = applyEdgeBudget(graph, { maxEdges: 2 })
  assert.deepEqual(byCount.edges.map((edge) => edge.id), ['e1', 'e4'])
  assert.deepEqual(byCount.stats, { keptEdges: 2, hiddenEdges: 3, totalEdges: 5 })
  assert.deepEqual(byCount.truncation.edges, { total: 5, kept: 2, truncated: 3, reason: 'max-edges' })

  const byPriority = applyEdgeBudget(graph, { maxEdges: 2, priorityIds: [EX + 'n2'] })
  assert.deepEqual(byPriority.edges.map((edge) => edge.id), ['e0', 'e2'])

  const repeated = applyEdgeBudget(graph, { maxEdges: 2, priorityIds: [EX + 'n2'] })
  assert.deepEqual(repeated, byPriority)
})

test('applyEdgeBudget applies the element budget and breaks ties by edge id', () => {
  const graph = budgetFixtureGraph()
  const elements = applyEdgeBudget(graph, { maxElements: 6 })
  assert.deepEqual(elements.edges.map((edge) => edge.id), ['e1', 'e4'])
  assert.equal(elements.truncation.edges.reason, 'max-elements')

  const noRoom = applyEdgeBudget(graph, { maxElements: 4 })
  assert.deepEqual(noRoom.edges, [])
  assert.deepEqual(noRoom.truncation.edges, { total: 5, kept: 0, truncated: 5, reason: 'max-elements' })

  const tied = manualGraph(budgetFixtureGraph().nodes, [
    manualEdge('e9', EX + 'n1', EX + 'n2', EX + 'link'),
    manualEdge('e2', EX + 'n1', EX + 'n3', EX + 'link'),
    manualEdge('e5', EX + 'n2', EX + 'n4', EX + 'link'),
  ])
  assert.deepEqual(applyEdgeBudget(tied, { maxEdges: 2 }).edges.map((edge) => edge.id), ['e2', 'e5'])
})

// ---------------------------------------------------------------------------
// exploreNeighborhood (L3 multi-hop)
// ---------------------------------------------------------------------------

function chainGraph() {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const nodes = ids.map((id) => manualNode(EX + id, 'individual'))
  const edges = []
  for (let index = 0; index < ids.length - 1; index += 1) {
    edges.push(manualEdge('e' + index, EX + ids[index], EX + ids[index + 1], EX + 'next'))
  }
  return manualGraph(nodes, edges)
}

function hubGraph(leafCount) {
  const nodes = [manualNode(EX + 'hub', 'individual')]
  const edges = []
  for (let index = 0; index < leafCount; index += 1) {
    const id = EX + 'leaf-' + String(index).padStart(2, '0')
    nodes.push(manualNode(id, 'external'))
    edges.push(manualEdge('e' + index, EX + 'hub', id, EX + 'link'))
  }
  return manualGraph(nodes, edges)
}

test('exploreNeighborhood expands two hops in deterministic neighbour order', () => {
  const graph = chainGraph()
  const result = exploreNeighborhood(graph, { startId: EX + 'a', depth: 2, direction: 'both' })

  assert.deepEqual(result.nodeIds, [EX + 'a', EX + 'b', EX + 'c'])
  assert.deepEqual(result.nodes.map((node) => node.id), [EX + 'a', EX + 'b', EX + 'c'])
  assert.deepEqual(result.edges.map((edge) => edge.id), ['e0', 'e1'])
  assert.equal(result.stats.hops, 2)
  assert.equal(result.stats.totalNodes, 6)
  assert.equal(result.truncated, false)
  assert.equal(result.nextCursor, null)
  assert.deepEqual(result.truncation.nodes, { total: 3, kept: 3, truncated: 0, reason: null })
  assert.deepEqual(result.truncation.edges, { total: 2, kept: 2, truncated: 0, reason: null })
  // depth is clamped into 1..5
  assert.deepEqual(exploreNeighborhood(graph, { startId: EX + 'a', depth: 0 }).nodeIds, [EX + 'a', EX + 'b'])
})

test('exploreNeighborhood applies direction to every hop', () => {
  const graph = chainGraph()

  const incoming = exploreNeighborhood(graph, { startId: EX + 'f', depth: 2, direction: 'in' })
  assert.deepEqual(incoming.nodeIds, [EX + 'f', EX + 'e', EX + 'd'])

  const outgoing = exploreNeighborhood(graph, { startId: EX + 'a', depth: 3, direction: 'out' })
  assert.deepEqual(outgoing.nodeIds, [EX + 'a', EX + 'b', EX + 'c', EX + 'd'])

  const deadEnd = exploreNeighborhood(graph, { startId: EX + 'f', depth: 3, direction: 'out' })
  assert.deepEqual(deadEnd.nodeIds, [EX + 'f'])
  assert.equal(deadEnd.stats.hops, 0)
})

test('exploreNeighborhood never passes through nodes absent from the graph', () => {
  const full = chainGraph()
  // Simulate an L2 filter that hid c: the node and its incident edges are gone.
  const filtered = manualGraph(
    full.nodes.filter((node) => node.id !== EX + 'c'),
    full.edges.filter((edge) => edge.source !== EX + 'c' && edge.target !== EX + 'c'),
  )

  const result = exploreNeighborhood(filtered, { startId: EX + 'a', depth: 5, direction: 'both' })
  assert.deepEqual(result.nodeIds, [EX + 'a', EX + 'b'])
  assert.equal(result.nodeIds.includes(EX + 'c'), false, 'a hidden node is not a stepping stone')
  assert.deepEqual(result.edges.map((edge) => edge.id), ['e0'])
})

test('exploreNeighborhood applies the predicate filter on every hop', () => {
  const graph = chainGraph()
  graph.edges.push(manualEdge('e9', EX + 'a', EX + 'c', EX + 'skip'))

  const nextOnly = exploreNeighborhood(graph, {
    startId: EX + 'a',
    depth: 2,
    direction: 'out',
    predicates: [EX + 'next'],
  })
  assert.deepEqual(nextOnly.nodeIds, [EX + 'a', EX + 'b', EX + 'c'])
  assert.deepEqual(nextOnly.edges.map((edge) => edge.id), ['e0', 'e1'])

  const skipOnly = exploreNeighborhood(graph, {
    startId: EX + 'a',
    depth: 1,
    direction: 'out',
    predicates: [EX + 'skip'],
  })
  assert.deepEqual(skipOnly.nodeIds, [EX + 'a', EX + 'c'])

  const snapshot = JSON.stringify(graph)
  exploreNeighborhood(graph, { startId: EX + 'a', depth: 2 })
  assert.equal(JSON.stringify(graph), snapshot, 'exploration must not mutate the graph')
})

test('exploreNeighborhood truncates by the per-hop budget and continues deterministically', () => {
  const graph = hubGraph(6)
  const options = { startId: EX + 'hub', depth: 1, direction: 'both', budget: { perHopNodes: 2, maxEdges: 100 } }

  const first = exploreNeighborhood(graph, options)
  assert.deepEqual(first.nodeIds, [EX + 'hub', EX + 'leaf-00', EX + 'leaf-01'])
  assert.equal(first.truncated, true)
  assert.deepEqual(first.nextCursor, { extension: 1 })
  assert.deepEqual(first.nextBudget, first.nextCursor)
  assert.deepEqual(first.truncation.nodes, { total: 7, kept: 3, truncated: 4, reason: 'per-hop-nodes' })
  assert.deepEqual(first.truncation.edges, { total: 6, kept: 2, truncated: 4, reason: 'per-hop-nodes' })

  const second = exploreNeighborhood(graph, { ...options, cursor: first.nextCursor })
  assert.deepEqual(second.nodeIds, [
    EX + 'hub',
    EX + 'leaf-00',
    EX + 'leaf-01',
    EX + 'leaf-02',
    EX + 'leaf-03',
  ])
  assert.equal(second.truncated, true)
  assert.deepEqual(second.nextCursor, { extension: 2 })
  assert.deepEqual(second.truncation.nodes, { total: 7, kept: 5, truncated: 2, reason: 'per-hop-nodes' })
  assert.deepEqual(second.truncation.edges, { total: 6, kept: 4, truncated: 2, reason: 'per-hop-nodes' })
  for (const id of first.nodeIds) assert.ok(second.nodeIds.includes(id), 'continued result is a superset')
  for (const edge of first.edges) assert.ok(second.edges.includes(edge), 'continued result keeps edges')

  const third = exploreNeighborhood(graph, { ...options, cursor: second.nextCursor })
  assert.equal(third.nodeIds.length, 7)
  assert.equal(third.truncated, false)
  assert.equal(third.nextCursor, null)
  assert.deepEqual(third.truncation.nodes, { total: 7, kept: 7, truncated: 0, reason: null })
  assert.deepEqual(third.truncation.edges, { total: 6, kept: 6, truncated: 0, reason: null })
  assert.equal(new Set(third.nodeIds).size, third.nodeIds.length, 'no duplicate nodes')
  assert.equal(new Set(third.edges.map((edge) => edge.id)).size, third.edges.length, 'no duplicate edges')

  const repeated = exploreNeighborhood(graph, { ...options, cursor: first.nextCursor })
  assert.deepEqual(repeated, second, 'same input and cursor give the same result')
})

test('exploreNeighborhood truncates by the global edge budget', () => {
  const graph = hubGraph(4)
  const options = { startId: EX + 'hub', depth: 1, direction: 'both', budget: { perHopNodes: 100, maxEdges: 1 } }

  const first = exploreNeighborhood(graph, options)
  assert.deepEqual(first.nodeIds, [EX + 'hub', EX + 'leaf-00'])
  assert.deepEqual(first.edges.map((edge) => edge.id), ['e0'])
  assert.equal(first.truncated, true)
  assert.deepEqual(first.truncation.nodes, { total: 5, kept: 2, truncated: 3, reason: 'max-edges' })
  assert.deepEqual(first.truncation.edges, { total: 4, kept: 1, truncated: 3, reason: 'max-edges' })

  const second = exploreNeighborhood(graph, { ...options, cursor: first.nextCursor })
  assert.deepEqual(second.nodeIds, [EX + 'hub', EX + 'leaf-00', EX + 'leaf-01'])
  assert.deepEqual(second.edges.map((edge) => edge.id), ['e0', 'e1'])
  assert.equal(second.truncated, true)
  assert.deepEqual(second.truncation.nodes, { total: 5, kept: 3, truncated: 2, reason: 'max-edges' })
})

test('exploreNeighborhood enforces the five-hop hard cap', () => {
  const graph = chainGraph()
  const result = exploreNeighborhood(graph, {
    startId: EX + 'a',
    depth: 10,
    direction: 'out',
    budget: { perHopNodes: 100, maxEdges: 100 },
  })

  assert.equal(result.depthCapped, true)
  assert.equal(result.stats.depth, 5)
  assert.equal(result.stats.depthLimit, 5)
  assert.equal(result.stats.hops, 5)
  assert.equal(result.reachedDepthLimit, true)
  assert.equal(result.nextCursor, null)
  assert.equal(result.truncated, true)
  assert.deepEqual(result.truncation.nodes, { total: 6, kept: 6, truncated: 0, reason: null })
  assert.deepEqual(result.truncation.edges, { total: 5, kept: 5, truncated: 0, reason: null })
  assert.deepEqual(result.nodeIds, [EX + 'a', EX + 'b', EX + 'c', EX + 'd', EX + 'e', EX + 'f'])
})

test('exploreNeighborhood handles a missing start and malformed input', () => {
  const graph = chainGraph()

  const missing = exploreNeighborhood(graph, { startId: EX + 'missing', depth: 2 })
  assert.deepEqual(missing.nodes, [])
  assert.deepEqual(missing.nodeIds, [])
  assert.deepEqual(missing.edges, [])
  assert.equal(missing.truncated, false)
  assert.equal(missing.nextCursor, null)

  const empty = exploreNeighborhood(null, { startId: EX + 'a', depth: 2 })
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.edges, [])
})

// ---------------------------------------------------------------------------
// connectionGroups (detail panel)
// ---------------------------------------------------------------------------

test('connectionGroups groups outgoing edges by predicate in deterministic order', () => {
  const graph = buildGraph(parsedFixture())
  const groups = connectionGroups(graph, T.alice)

  assert.deepEqual(groups.out.map((group) => group.predicate), [T.type, T.knows, T.seeAlso])
  assert.deepEqual(groups.out.map((group) => group.label), ['type', 'ex:knows', 'rdfs:seeAlso'])
  assert.equal(groups.out[1].count, 2)
  assert.deepEqual(groups.out[1].items.map((item) => item.id), [T.bob, T.carol])
  assert.deepEqual(groups.in, [])
  assert.deepEqual(groups.summary, { outEdges: 4, inEdges: 0, degree: 4 })

  const bob = connectionGroups(graph, T.bob)
  assert.deepEqual(bob.out.map((group) => group.predicate), [T.type, T.knows])
  assert.deepEqual(bob.in.map((group) => group.predicate), [T.knows])
  assert.deepEqual(bob.summary, { outEdges: 2, inEdges: 1, degree: 3 })
})

test('connectionGroups caps items per group and reports the hidden count', () => {
  const graph = hubGraph(3)
  const capped = connectionGroups(graph, EX + 'hub', { maxPerGroup: 2 })

  assert.equal(capped.out.length, 1)
  assert.equal(capped.out[0].count, 3)
  assert.equal(capped.out[0].items.length, 2)
  assert.equal(capped.out[0].hidden, 1)
  assert.deepEqual(capped.out[0].items.map((item) => item.id), [EX + 'leaf-00', EX + 'leaf-01'])
  assert.deepEqual(capped.in, [])

  const full = connectionGroups(graph, EX + 'hub', { maxPerGroup: 10 })
  assert.equal(full.out[0].items.length, 3)
  assert.equal(full.out[0].hidden, 0)
})

test('connectionGroups handles self-loops, unknown nodes and never mutates', () => {
  const graph = manualGraph(
    [manualNode(EX + 'loop', 'individual')],
    [manualEdge('e0', EX + 'loop', EX + 'loop', EX + 'self')],
  )
  const snapshot = JSON.stringify(graph)
  const groups = connectionGroups(graph, EX + 'loop')

  assert.deepEqual(groups.out.map((group) => group.predicate), [EX + 'self'])
  assert.deepEqual(groups.in.map((group) => group.predicate), [EX + 'self'])
  assert.deepEqual(groups.summary, { outEdges: 1, inEdges: 1, degree: 2 })
  assert.deepEqual(groups.out[0].items, [{ id: EX + 'loop', label: 'loop', kind: 'individual' }])
  assert.deepEqual(connectionGroups(graph, EX + 'missing'), {
    out: [],
    in: [],
    summary: { outEdges: 0, inEdges: 0, degree: 0 },
  })
  assert.equal(JSON.stringify(graph), snapshot)

  const fixture = buildGraph(parsedFixture())
  const fixtureSnapshot = JSON.stringify(fixture)
  assert.deepEqual(connectionGroups(fixture, T.alice), connectionGroups(fixture, T.alice))
  assert.equal(JSON.stringify(fixture), fixtureSnapshot)
})

// ---------------------------------------------------------------------------
// createLayoutTask (chunked layout)
// ---------------------------------------------------------------------------

function runLayoutTaskToCompletion(task) {
  let guard = 0
  let lastProgress = -1
  let lastStep = null
  while (guard < 5000) {
    const step = task.step(0)
    assert.equal(step.progress >= lastProgress, true, 'progress never decreases')
    assert.equal(step.progress >= 0 && step.progress <= 1, true, 'progress stays in 0..1')
    lastProgress = step.progress
    lastStep = step
    if (step.done) break
    guard += 1
  }
  assert.ok(lastStep && lastStep.done, 'the task reached completion')
  return task.result()
}

test('createLayoutTask is mathematically identical to layoutGraph run to completion', () => {
  const graphs = [
    { graph: buildGraph(parsedFixture()), options: { width: 800, height: 600, iterations: 120, seed: 7 } },
    { graph: twoClustersGraph(), options: { width: 700, height: 500, iterations: 40, seed: 2 } },
    { graph: buildGraph(parsedFixture()), options: { width: 900, height: 600, iterations: 32, seed: 1 } },
  ]

  for (const { graph, options } of graphs) {
    const expected = layoutGraph(graph, options)
    const task = createLayoutTask(graph, options)
    assert.equal(task.result(), null, 'result is null before completion')
    const actual = runLayoutTaskToCompletion(task)
    assert.deepEqual(actual, expected, 'chunked layout matches the one-shot layout exactly')
  }
})

test('createLayoutTask also matches layoutGraph with the default time slice', () => {
  const graph = buildGraph(parsedFixture())
  const options = { width: 800, height: 600, iterations: 60, seed: 5 }
  const expected = layoutGraph(graph, options)
  const task = createLayoutTask(graph, options)

  let guard = 0
  let step = task.step()
  while (!step.done && guard < 500) {
    step = task.step()
    guard += 1
  }
  assert.equal(step.done, true)
  assert.deepEqual(task.result(), expected)
})

test('createLayoutTask matches layoutGraph on the sampled-repulsion and edge-stride paths', () => {
  const nodes = []
  const edges = []
  for (let index = 0; index < 450; index += 1) {
    nodes.push({ id: EX + 'n' + index })
  }
  let edgeCount = 0
  for (let index = 0; index < 450; index += 1) {
    for (let offset = 1; offset <= 70; offset += 1) {
      edges.push(manualEdge('e' + edgeCount, EX + 'n' + index, EX + 'n' + ((index + offset) % 450), EX + 'link'))
      edgeCount += 1
    }
  }
  assert.ok(edges.length > 30000, 'exercises the deterministic edge stride')
  const graph = manualGraph(nodes, edges)
  const options = { width: 900, height: 600, iterations: 6, seed: 4 }
  const expected = layoutGraph(graph, options)
  const task = createLayoutTask(graph, options)
  assert.deepEqual(runLayoutTaskToCompletion(task), expected)
})

test('createLayoutTask handles empty and single-node graphs and cancellation', () => {
  const emptyTask = createLayoutTask({ nodes: [], edges: [] }, {})
  assert.deepEqual(emptyTask.result(), [])
  assert.deepEqual(emptyTask.step(0), { done: true, progress: 1 })

  const singleGraph = { nodes: [{ id: EX + 'only' }], edges: [] }
  const singleTask = createLayoutTask(singleGraph, { width: 800, height: 600 })
  assert.deepEqual(singleTask.result(), layoutGraph(singleGraph, { width: 800, height: 600 }))

  const graph = buildGraph(parsedFixture())
  const snapshot = JSON.stringify(graph)
  const task = createLayoutTask(graph, { width: 800, height: 600, iterations: 500, seed: 3 })
  const firstStep = task.step(0)
  assert.equal(firstStep.done, false)
  assert.ok(firstStep.progress > 0 && firstStep.progress < 1)
  task.cancel()
  assert.equal(task.result(), null)
  const afterCancel = task.step(0)
  assert.equal(afterCancel.done, true)
  assert.equal(afterCancel.canceled, true)
  assert.equal(task.result(), null)
  assert.equal(JSON.stringify(graph), snapshot, 'layout must not mutate the graph')
})
