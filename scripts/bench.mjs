#!/usr/bin/env node
/**
 * Performance baseline for the ontology viewer (`npm run bench`, opt-in, not in CI).
 *
 * Covers the five fixture classes required by the change design (§8.1):
 *   - small: the checked-in `examples/*` files;
 *   - medium: a deterministic generated graph (~600 nodes / 3000 triples);
 *   - near-limit: ~120k triples over 1500 nodes (the current parser budget);
 *   - dense: 1500 nodes / 50k distinct edges;
 *   - invalid: bad syntax, very deep JSON-LD nesting, a huge literal.
 *
 * For every fixture it reports per-stage timings (parse, buildGraph, layout at
 * 320 and 1000 iterations), graph size, heap delta and a serialization proxy
 * for worker transfer (JSON byte size + `structuredClone` time). Timings are a
 * warmup plus 5 repetitions summarized as min / p50 / p95 / max.
 *
 * The same script is intended to be copied into a `git worktree` at the
 * pre-change baseline commit to produce an apples-to-apples comparison in the
 * same environment. Real Worker initialization / message round-trips are not
 * measurable from Node; they belong to the DSH runtime probe checklist and the
 * serialization proxy is the closest deterministic stand-in.
 *
 * Usage: node scripts/bench.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cpus, totalmem, platform, arch } from 'node:os'

import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph, layoutGraph } from '../src/graph-model.js'
import {
  createWorkspace,
  addSource,
  composeWorkspaceGraph,
} from '../src/ontology-workspace.js'
import {
  entityKeyForTerm,
  statementIdFor,
  graphIdentityFor,
} from '../src/ontology-identity.js'
import { buildHierarchy, layoutLayeredGraph } from '../src/ontology-views.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const JSON_OUTPUT = process.argv.slice(2).includes('--json')
const REPS = 5
const LAYOUT_320 = Object.freeze({ width: 900, height: 600, seed: 1, iterations: 320 })
const LAYOUT_1000 = Object.freeze({ width: 900, height: 600, seed: 1, iterations: 1000 })
const PARSE_OPTIONS = Object.freeze({
  fileName: undefined,
  maxTriples: 120000,
  maxLiteralLength: 16384,
  maxDepth: 256,
})
const BUILD_OPTIONS = Object.freeze({ maxNodes: 1500, maxLiteralsPerNode: 60 })

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL = 'http://www.w3.org/2002/07/owl#'

function now() {
  return typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

function summarize(samples) {
  const sorted = samples.slice().sort((left, right) => left - right)
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    n: sorted.length,
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

function roundSummary(summary) {
  return {
    min: round(summary.min),
    p50: round(summary.p50),
    p95: round(summary.p95),
    max: round(summary.max),
    n: summary.n,
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic fixture generation                                    */
/* ------------------------------------------------------------------ */

const TURTLE_PREFIXES = `@prefix ex: <http://example.org/> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n`

/** ~600 nodes / 3000 triples: 600 labels + 2400 distinct links. */
function mediumTurtle() {
  const lines = [TURTLE_PREFIXES]
  for (let index = 0; index < 2400; index += 1) {
    const round = Math.floor(index / 600)
    const subject = 'ex:n' + (index % 600)
    const predicate = 'ex:p' + (index % 12)
    const object = 'ex:n' + ((index * 37 + 11 + round * 151) % 600)
    lines.push(`${subject} ${predicate} ${object} .\n`)
  }
  for (let index = 0; index < 600; index += 1) {
    lines.push(`ex:n${index} rdfs:label "Node ${index}" .\n`)
  }
  for (let index = 0; index < 60; index += 1) {
    lines.push(`ex:n${index} rdf:type owl:Class .\n`)
  }
  return lines.join('')
}

/** 120,000 triples over 1500 nodes (the parser triple budget). */
function nearLimitTurtle() {
  const lines = [TURTLE_PREFIXES]
  for (let index = 0; index < 118500; index += 1) {
    const subject = 'ex:n' + (index % 1500)
    const predicate = 'ex:p' + (index % 20)
    const object = 'ex:n' + ((index * 7919 + 17) % 1500)
    lines.push(`${subject} ${predicate} ${object} .\n`)
  }
  for (let index = 0; index < 1500; index += 1) {
    lines.push(`ex:n${index} rdfs:label "Node ${index}" .\n`)
  }
  return lines.join('')
}

/** 1500 nodes / 50,000 distinct edges (dense relationship graph). */
function denseTurtle() {
  const lines = [TURTLE_PREFIXES]
  const seen = new Set()
  let written = 0
  for (let subject = 0; subject < 1500 && written < 50000; subject += 1) {
    for (let step = 0; step < 34 && written < 50000; step += 1) {
      const object = (subject + 1 + step * 47) % 1500
      if (object === subject) continue
      const predicate = 'ex:rel' + (step % 12)
      const key = subject + '|' + predicate + '|' + object
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`ex:n${subject} ${predicate} ex:n${object} .\n`)
      written += 1
    }
  }
  return lines.join('')
}

/** Deeply nested JSON-LD unrelated nodes; the parser depth limit must stop it. */
function deepNestingJsonLd() {
  const depth = 2000
  const parts = []
  for (let index = 0; index < depth; index += 1) {
    parts.push('{"@id":"http://example.org/deep' + index + '","http://example.org/next":')
  }
  parts.push('{"@id":"http://example.org/leaf"}')
  for (let index = 0; index < depth; index += 1) parts.push('}')
  return parts.join('')
}

/** A single literal far beyond the per-literal length budget. */
function hugeLiteralTurtle() {
  return TURTLE_PREFIXES + 'ex:subject ex:value "' + 'x'.repeat(100000) + '" .\n'
}

const BAD_SYNTAX = TURTLE_PREFIXES +
  'ex:a ex:knows ex:b .\n' +
  'this is not turtle at all\n' +
  'ex:c ex:knows\n' +
  'ex:d ex:knows "unterminated literal .\n'

/** Load the small example fixtures that ship with the repository. */
function exampleFixtures() {
  const files = [
    ['pizza.ttl', 'ttl'],
    ['people.nt', 'nt'],
    ['library.rdf', 'rdf'],
    ['courses.jsonld', 'jsonld'],
    ['zoo.owl', 'owl'],
  ]
  const fixtures = []
  for (const [name] of files) {
    const text = readFileSync(path.join(root, 'examples', name), 'utf8')
    fixtures.push({
      name: 'small:' + name,
      kind: 'example',
      fileName: name,
      text: text,
    })
  }
  return fixtures
}

function createFixtures() {
  return [
    ...exampleFixtures(),
    { name: 'medium', kind: 'generated', fileName: 'medium.ttl', text: mediumTurtle() },
    { name: 'near-limit', kind: 'generated', fileName: 'near-limit.ttl', text: nearLimitTurtle() },
    { name: 'dense', kind: 'generated', fileName: 'dense.ttl', text: denseTurtle() },
    { name: 'invalid:bad-syntax', kind: 'invalid', fileName: 'bad.ttl', text: BAD_SYNTAX },
    { name: 'invalid:deep-nesting', kind: 'invalid', fileName: 'deep.jsonld', text: deepNestingJsonLd() },
    { name: 'invalid:huge-literal', kind: 'invalid', fileName: 'huge.ttl', text: hugeLiteralTurtle() },
  ]
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

function readGraphSize(graph) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes.length : 0
  const edges = graph && Array.isArray(graph.edges) ? graph.edges.length : 0
  const stats = graph && graph.stats && typeof graph.stats === 'object' ? graph.stats : {}
  const triples = typeof stats.triples === 'number'
    ? stats.triples
    : (typeof stats.tripleCount === 'number' ? stats.tripleCount : 0)
  return { nodes, edges, triples }
}

function readParseReport(parsed) {
  const stats = parsed && parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
  const diagnostics = Array.isArray(parsed && parsed.diagnostics) ? parsed.diagnostics : []
  const errors = Array.isArray(parsed && parsed.errors) ? parsed.errors.length : 0
  const warnings = Array.isArray(parsed && parsed.warnings) ? parsed.warnings.length : 0
  return {
    tripleCount: typeof stats.tripleCount === 'number' ? stats.tripleCount : (Array.isArray(parsed && parsed.triples) ? parsed.triples.length : 0),
    truncated: !!(stats.truncated || (stats.truncation && stats.truncation.reason)),
    diagnostics: diagnostics.length,
    errors,
    warnings,
    baseSource: parsed && typeof parsed.baseSource === 'string' ? parsed.baseSource : null,
  }
}

function structuredCloneTime(value, reps) {
  if (typeof structuredClone !== 'function') return null
  const samples = []
  for (let index = 0; index < reps; index += 1) {
    const startedAt = now()
    structuredClone(value)
    samples.push(now() - startedAt)
  }
  return summarize(samples)
}

/** Measure one fixture: warmup + REPS repetitions per stage. */
function measureFixture(fixture) {
  const parseOptions = Object.assign({}, PARSE_OPTIONS, {
    fileName: fixture.fileName,
    // The generated fixtures include prefixes, so pass the explicit format only
    // for files whose extension would otherwise be ambiguous; detectFormat is
    // never bypassed here on purpose (it is part of the parse cost).
  })
  const buildOptions = Object.assign({}, BUILD_OPTIONS, {
    source: { address: '', displayName: fixture.fileName, format: '' },
  })
  const samples = { parse: [], build: [], layout320: [], layout1000: [] }
  const last = { parsed: null, graph: null }
  let heapDeltaBytes = 0
  let failure = null

  // Warmup: parse + build + one 320-iteration layout, not recorded.
  let warmParsed = null
  let warmGraph = null
  try {
    warmParsed = parseOntology(fixture.text, parseOptions)
    warmGraph = buildGraph(warmParsed, buildOptions)
    layoutGraph(warmGraph, LAYOUT_320)
  } catch (error) {
    failure = String((error && error.message) || error)
  }

  for (let rep = 0; rep < REPS; rep += 1) {
    const heapBefore = process.memoryUsage().heapUsed
    let parsed = null
    let graph = null

    let startedAt = now()
    try {
      parsed = parseOntology(fixture.text, parseOptions)
    } catch (error) {
      failure = failure || ('parse threw: ' + String((error && error.message) || error))
    }
    samples.parse.push(now() - startedAt)

    startedAt = now()
    try {
      graph = buildGraph(parsed, buildOptions)
    } catch (error) {
      failure = failure || ('buildGraph threw: ' + String((error && error.message) || error))
    }
    samples.build.push(now() - startedAt)

    startedAt = now()
    try {
      layoutGraph(graph, LAYOUT_320)
    } catch (error) {
      failure = failure || ('layout320 threw: ' + String((error && error.message) || error))
    }
    samples.layout320.push(now() - startedAt)

    startedAt = now()
    try {
      layoutGraph(graph, LAYOUT_1000)
    } catch (error) {
      failure = failure || ('layout1000 threw: ' + String((error && error.message) || error))
    }
    samples.layout1000.push(now() - startedAt)

    heapDeltaBytes = Math.max(heapDeltaBytes, process.memoryUsage().heapUsed - heapBefore)
    last.parsed = parsed
    last.graph = graph
  }

  const graphSize = readGraphSize(last.graph)
  const parseReport = readParseReport(last.parsed)
  const jsonBytes = (() => {
    try {
      return JSON.stringify(last.graph).length
    } catch (error) {
      return null
    }
  })()
  const cloneSummary = structuredCloneTime(last.graph, 3)

  return {
    name: fixture.name,
    kind: fixture.kind,
    sourceBytes: Buffer.byteLength(fixture.text, 'utf8'),
    stages: {
      parse: roundSummary(summarize(samples.parse)),
      build: roundSummary(summarize(samples.build)),
      layout320: roundSummary(summarize(samples.layout320)),
      layout1000: roundSummary(summarize(samples.layout1000)),
    },
    graph: graphSize,
    parse: parseReport,
    memory: {
      heapDeltaBytes: heapDeltaBytes,
      heapDeltaMiB: round(heapDeltaBytes / (1024 * 1024)),
    },
    serialization: {
      graphJsonBytes: jsonBytes,
      structuredCloneMs: cloneSummary ? roundSummary(cloneSummary) : null,
    },
    failure: failure,
  }
}

function environment() {
  return {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    totalMemGiB: round(totalmem() / (1024 * 1024 * 1024)),
    measuredAt: new Date().toISOString(),
    reps: REPS,
  }
}

function formatNumber(value, digits) {
  return typeof value === 'number' ? value.toFixed(digits === undefined ? 2 : digits) : String(value)
}

function printHumanReport(report) {
  const env = report.environment
  console.log('dsh-ontology-viewer benchmark')
  console.log(`node ${env.node} | ${env.platform}/${env.arch} | ${env.cpus} cpus | ${env.totalMemGiB} GiB | reps=${env.reps}`)
  console.log('')
  console.log(
    ['fixture', 'src', 'stage', 'p50', 'p95', 'min', 'max'].join('\t')
  )
  for (const fixture of report.fixtures) {
    for (const stage of ['parse', 'build', 'layout320', 'layout1000']) {
      const summary = fixture.stages[stage]
      console.log([
        fixture.name,
        fixture.sourceBytes,
        stage,
        formatNumber(summary.p50),
        formatNumber(summary.p95),
        formatNumber(summary.min),
        formatNumber(summary.max),
      ].join('\t'))
    }
    const graph = fixture.graph
    const parse = fixture.parse
    console.log([
      fixture.name,
      '-',
      'graph',
      `nodes=${graph.nodes}`,
      `edges=${graph.edges}`,
      `triples=${graph.triples}`,
      `diag=${parse.diagnostics}`,
      `errors=${parse.errors}`,
      `warnings=${parse.warnings}`,
      `heapDelta=${fixture.memory.heapDeltaMiB}MiB`,
      `json=${fixture.serialization.graphJsonBytes}`,
    ].join('\t'))
    if (fixture.failure) console.log([fixture.name, '-', 'failure', fixture.failure].join('\t'))
    console.log('')
  }
  if (report.workspace) {
    const workspace = report.workspace
    console.log('workspace: multi-file compose')
    console.log([
      'workspace',
      '-',
      'files=' + workspace.files,
      'parsedTriples=' + workspace.parsedTriples,
      'statements=' + workspace.statements,
      'occurrences=' + workspace.occurrences,
      'parseMs=' + workspace.parseMs.p50 + '/' + workspace.parseMs.p95,
      'composeMs=' + workspace.composeMs.p50 + '/' + workspace.composeMs.p95,
      'treeMs=' + workspace.treeProjectionMs.p50,
      'layeredMs=' + workspace.layeredProjectionMs.p50,
    ].join('\t'))
    console.log('')
  }
  console.log('Notes: timings are milliseconds (p50/p95 of ' + REPS + ' reps after one warmup).')
  console.log('`json` is JSON.stringify(graph).length: the structured-clone payload proxy for worker transfer.')
  console.log('Real Worker init / message round-trip / transfer cost are measured by the DSH runtime probe, not here.')
}


function createWorkspaceFixture() {
  // Two deterministic sources sharing one entity: the merge/projection cost is
  // what matters here, not the single-file pipeline.
  const shared = 'http://bench.example/shared'
  let one = '@prefix ex: <http://bench.example/> .\n'
  let two = '@prefix ex: <http://bench.example/> .\n'
  for (let index = 0; index < 300; index += 1) {
    one += 'ex:a' + index + ' ex:link ex:shared .\n'
    one += 'ex:a' + index + ' ex:label "node ' + index + '" .\n'
    two += 'ex:b' + index + ' ex:link ex:shared .\n'
    two += 'ex:b' + index + ' ex:label "node ' + index + '" .\n'
  }
  one += 'ex:Sub ex:sub rdf:subClassOf ex:Base .\n'
  return {
    one: one,
    two: two,
    shared: shared,
  }
}

/**
 * Measure the multi-file path: parse each source once, then compose twice
 * (the second compose represents switching views without re-parsing).
 */
function measureWorkspace() {
  const fixture = createWorkspaceFixture()
  const identity = { entityKeyForTerm, statementIdFor, graphIdentityFor }
  const makeWorkspace = () => createWorkspace({ buildGraph, identity })
  const parseOne = { name: 'one.ttl', path: 'D:/bench/one.ttl' }
  const parseTwo = { name: 'two.ttl', path: 'D:/bench/two.ttl' }
  const parsedOne = parseOntology(fixture.one, Object.assign({}, PARSE_OPTIONS, {
    fileName: parseOne.name, absolutePath: parseOne.path,
  }))
  const parsedTwo = parseOntology(fixture.two, Object.assign({}, PARSE_OPTIONS, {
    fileName: parseTwo.name, absolutePath: parseTwo.path,
  }))
  const parseTimes = []
  const composeTimes = []
  const treeTimes = []
  const layeredTimes = []
  let statements = 0
  let occurrences = 0
  for (let rep = 0; rep < REPS; rep += 1) {
    const startParse = now()
    const parsedA = parseOntology(fixture.one, Object.assign({}, PARSE_OPTIONS, {
      fileName: parseOne.name, absolutePath: parseOne.path,
    }))
    const parsedB = parseOntology(fixture.two, Object.assign({}, PARSE_OPTIONS, {
      fileName: parseTwo.name, absolutePath: parseTwo.path,
    }))
    parseTimes.push(now() - startParse)

    let workspace = makeWorkspace()
    workspace = addSource(workspace, {
      origin: 'host', displayName: parseOne.name, absolutePath: parseOne.path,
      parsed: parsedA, text: fixture.one, byteSize: fixture.one.length,
    }).workspace
    workspace = addSource(workspace, {
      origin: 'host', displayName: parseTwo.name, absolutePath: parseTwo.path,
      parsed: parsedB, text: fixture.two, byteSize: fixture.two.length,
    }).workspace

    const startCompose = now()
    const first = composeWorkspaceGraph(workspace, {
      maxNodes: 1500, maxEdges: 6000, maxLiteralsPerNode: 60, maxLiteralLength: 16384,
    })
    composeTimes.push(now() - startCompose)
    const second = composeWorkspaceGraph(workspace, {
      maxNodes: 1500, maxEdges: 6000, maxLiteralsPerNode: 60, maxLiteralLength: 16384,
    })
    statements = first.statements
    occurrences = first.occurrences
    if (second.occurrences !== occurrences) throw new Error('compose is not deterministic')

    const startTree = now()
    const hierarchy = buildHierarchy(first.graph, { mode: 'class' })
    treeTimes.push(now() - startTree)
    const startLayered = now()
    layoutLayeredGraph(first.graph, {
      predicates: ['http://www.w3.org/2000/01/rdf-schema#subClassOf'],
      width: 900, height: 600,
    })
    layeredTimes.push(now() - startLayered)
  }
  // Parse once more after the loop to report source sizes without touching
  // the measured arrays.
  return {
    files: 2,
    statements: statements,
    occurrences: occurrences,
    parseMs: summarize(parseTimes),
    composeMs: summarize(composeTimes),
    treeProjectionMs: summarize(treeTimes),
    layeredProjectionMs: summarize(layeredTimes),
    parsedTriples: parsedOne.triples.length + parsedTwo.triples.length,
  }
}

function main() {
  const report = {
    tool: 'scripts/bench.mjs',
    environment: environment(),
    layout: { layout320: LAYOUT_320, layout1000: LAYOUT_1000 },
    fixtures: [],
  }
  for (const fixture of createFixtures()) {
    report.fixtures.push(measureFixture(fixture))
  }
  report.workspace = measureWorkspace()
  if (JSON_OUTPUT) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    printHumanReport(report)
  }
}

main()
