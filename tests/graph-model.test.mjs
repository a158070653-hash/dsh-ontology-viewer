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
