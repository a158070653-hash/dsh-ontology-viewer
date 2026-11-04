// End-to-end statistics and stress check for the parse → graph → layout pipeline.
// Usage (from the plugin package root): node scripts/pipeline-check.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, layoutGraph } from '../src/graph-model.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const examples = path.join(root, 'examples')

for (const file of ['pizza.ttl', 'people.nt', 'library.rdf', 'courses.jsonld', 'zoo.owl']) {
  const text = readFileSync(path.join(examples, file), 'utf8')
  const started = performance.now()
  const parsed = parseOntology(text, { fileName: file })
  const graph = buildGraph(parsed, { maxNodes: 1500 })
  layoutGraph(graph, { width: 900, height: 620, seed: 3 })
  const elapsed = (performance.now() - started).toFixed(1)
  const kinds = {}
  for (const node of graph.nodes) kinds[node.kind] = (kinds[node.kind] || 0) + 1
  console.log(
    file.padEnd(16),
    String(parsed.format).padEnd(9),
    'triples', String(parsed.stats.tripleCount).padStart(4),
    'nodes', String(graph.nodes.length).padStart(3),
    'edges', String(graph.edges.length).padStart(3),
    'literals', String(graph.stats.literals).padStart(3),
    '|', JSON.stringify(kinds),
    `| ${elapsed}ms`,
    '| first label:', String(graph.nodes[0].label).slice(0, 32),
  )
}

// Synthetic worst case: 20k statements (~60k triples) must stay responsive.
const lines = ['@prefix ex: <http://example.org/x#> .']
for (let i = 0; i < 20000; i++) {
  lines.push(`ex:n${i} a ex:Thing ; ex:next ex:n${(i + 1) % 20000} ; ex:label "n${i}" .`)
}
const started = performance.now()
const parsed = parseOntology(lines.join('\n'), { fileName: 'big.ttl' })
const graph = buildGraph(parsed, { maxNodes: 1500 })
layoutGraph(graph, { width: 900, height: 620, seed: 1 })
console.log(
  'stress          ',
  'triples', parsed.stats.tripleCount,
  'nodes', graph.nodes.length,
  'dropped', graph.stats.droppedNodes,
  `| ${(performance.now() - started).toFixed(0)}ms`,
  '| errors', parsed.errors.length,
)
