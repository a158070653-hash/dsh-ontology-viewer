/**
 * End-to-end data test over the bundled examples: parse the real files a user
 * would click, then build the graph the plugin would draw.
 *
 * Run: node --test tests/fixtures.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, layoutGraph } from '../src/graph-model.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '..', 'examples')

const FILES = ['pizza.ttl', 'people.nt', 'library.rdf', 'courses.jsonld', 'zoo.owl']

function load(name) {
  return readFileSync(path.join(fixtures, name), 'utf8')
}

for (const file of FILES) {
  test(`fixture ${file} parses into a drawable graph`, () => {
    const text = load(file)
    const parsed = parseOntology(text, { fileName: file })
    assert.ok(parsed.triples.length >= 8, `${file}: expected at least 8 triples, got ${parsed.triples.length}`)
    assert.equal(parsed.errors.length, 0, `${file}: ${parsed.errors.join('; ')}`)
    for (const triple of parsed.triples) {
      if (triple.oKind === 'literal') continue
      assert.match(triple.o, /^(https?:|urn:|mailto:|_:)/, `${file}: object is not absolute: ${triple.o}`)
      assert.match(triple.p, /^(https?:|urn:)/, `${file}: predicate is not absolute: ${triple.p}`)
    }

    const graph = buildGraph(parsed, { maxNodes: 1500 })
    assert.ok(graph.nodes.length >= 4, `${file}: expected nodes, got ${graph.nodes.length}`)
    assert.ok(graph.edges.length >= 3, `${file}: expected edges, got ${graph.edges.length}`)
    assert.ok(graph.nodes.every((node) => typeof node.label === 'string' && node.label.length > 0), `${file}: every node needs a label`)
    assert.ok(graph.nodes.every((node) => Array.isArray(node.literals)), `${file}: literals must be arrays`)

    const positions = layoutGraph(graph, { width: 900, height: 620, iterations: 80, seed: 7 })
    assert.equal(positions.length, graph.nodes.length)
    for (const point of positions) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${file}: non-finite position`)
      assert.ok(point.x >= 0 && point.x <= 900, `${file}: x out of box: ${point.x}`)
      assert.ok(point.y >= 0 && point.y <= 620, `${file}: y out of box: ${point.y}`)
    }
  })
}

test('fixture formats are detected from their file names', () => {
  const expected = {
    'pizza.ttl': 'turtle',
    'people.nt': 'ntriples',
    'library.rdf': 'rdfxml',
    'courses.jsonld': 'jsonld',
    'zoo.owl': 'rdfxml',
  }
  for (const [file, format] of Object.entries(expected)) {
    const parsed = parseOntology(load(file), { fileName: file })
    assert.equal(parsed.format, format, `${file}: detected ${parsed.format}`)
  }
})

test('owl restriction blank nodes are connected, not dropped', () => {
  const parsed = parseOntology(load('zoo.owl'), { fileName: 'zoo.owl' })
  const graph = buildGraph(parsed)
  const blanks = graph.nodes.filter((node) => node.kind === 'blank')
  assert.ok(blanks.length >= 1, 'zoo.owl should surface its owl:Restriction blank node')
  assert.ok(graph.edges.some((edge) => edge.kind === 'blank'), 'blank node edges should be classified')
})
