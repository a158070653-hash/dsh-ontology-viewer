/**
 * Graph model + deterministic layout for the ontology viewer.
 *
 * This module is pure ECMAScript on purpose: it is concatenated into the
 * browser Client bundle (see build/build.mjs) and also imported directly by
 * the Node test runner. No DOM, no React, no Node globals, no imports.
 *
 * The input contract is the parsed-RDF shape produced by src/rdf-parse.js:
 *   { prefixes, base, triples: [{ s, p, o, oKind, lang?, dt? }], stats, warnings }
 */

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL_NS = 'http://www.w3.org/2002/07/owl#'
const SKOS_NS = 'http://www.w3.org/2004/02/skos/core#'
const FOAF_NS = 'http://xmlns.com/foaf/0.1/'
const DCTERMS_NS = 'http://purl.org/dc/terms/'
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#'

const RDF_TYPE = RDF_NS + 'type'
const RDF_FIRST = RDF_NS + 'first'
const RDF_REST = RDF_NS + 'rest'
const RDF_NIL = RDF_NS + 'nil'
const RDF_PROPERTY = RDF_NS + 'Property'
const RDFS_LABEL = RDFS_NS + 'label'
const RDFS_COMMENT = RDFS_NS + 'comment'
const RDFS_SUBCLASSOF = RDFS_NS + 'subClassOf'
const RDFS_CLASS = RDFS_NS + 'Class'
const OWL_CLASS = OWL_NS + 'Class'
const OWL_OBJECT_PROPERTY = OWL_NS + 'ObjectProperty'
const OWL_DATATYPE_PROPERTY = OWL_NS + 'DatatypeProperty'
const SKOS_PREFLABEL = SKOS_NS + 'prefLabel'
const FOAF_NAME = FOAF_NS + 'name'
const DCTERMS_TITLE = DCTERMS_NS + 'title'

/** Common XSD datatypes, kept for callers that need to recognise literal types. */
const XSD_COMMON = new Set([
  XSD_NS + 'string', XSD_NS + 'boolean', XSD_NS + 'decimal', XSD_NS + 'integer',
  XSD_NS + 'int', XSD_NS + 'long', XSD_NS + 'short', XSD_NS + 'byte',
  XSD_NS + 'float', XSD_NS + 'double', XSD_NS + 'date', XSD_NS + 'dateTime',
  XSD_NS + 'time', XSD_NS + 'duration', XSD_NS + 'anyURI', XSD_NS + 'nonNegativeInteger',
  XSD_NS + 'positiveInteger', XSD_NS + 'unsignedInt', XSD_NS + 'unsignedLong',
])

const CLASS_TYPES = new Set([OWL_CLASS, RDFS_CLASS])
const PROPERTY_TYPES = new Set([OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY, RDF_PROPERTY])

/** Predicates that are list plumbing, not semantic edges. */
const LIST_PREDICATES = new Set([RDF_FIRST, RDF_REST])

/**
 * Preferred label predicates, best first. Lower rank wins; a later lower-rank
 * literal replaces an earlier weaker label so the result does not depend on
 * triple order in a surprising way.
 */
const LABEL_RANK = new Map([
  [RDFS_LABEL, 0],
  [SKOS_PREFLABEL, 1],
  [FOAF_NAME, 2],
  [DCTERMS_TITLE, 3],
  [RDFS_COMMENT, 4],
])

const BLANK_PREFIX = '_:'

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function stringValue(value) {
  return value === null || value === undefined ? '' : String(value)
}

function labelRank(predicate) {
  const rank = LABEL_RANK.get(predicate)
  return rank === undefined ? 9 : rank
}

function compareStrings(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function emptyStats() {
  return {
    triples: 0,
    nodes: 0,
    edges: 0,
    literals: 0,
    classes: 0,
    properties: 0,
    individuals: 0,
    blanks: 0,
    droppedNodes: 0,
  }
}

function emptyGraph(warnings) {
  return { nodes: [], edges: [], stats: emptyStats(), warnings: Array.isArray(warnings) ? warnings : [] }
}

/**
 * Resolve how an object term should be treated. Parsers normally set `oKind`,
 * but a wrong/absent value must never turn a literal into a node.
 */
function resolveObjectKind(triple, value) {
  const declared = typeof triple.oKind === 'string' ? triple.oKind : ''
  if (declared === 'literal' || declared === 'iri' || declared === 'blank') return declared
  if (typeof value !== 'string') return 'literal'
  if (value.startsWith(BLANK_PREFIX)) return 'blank'
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/\s/.test(value)) return 'iri'
  return 'literal'
}

/**
 * Turn parsed triples into a renderable node-link graph.
 *
 * Classification (deterministic precedence, first match wins):
 *   1. blank      -- the id starts with "_:"
 *   2. property   -- typed owl:ObjectProperty / owl:DatatypeProperty / rdf:Property
 *   3. class      -- typed owl:Class / rdfs:Class, used as the object of an
 *                    rdf:type statement, or involved in rdfs:subClassOf
 *   4. external   -- a leaf target (no outgoing edges, no literals, no types,
 *                    at most one incoming edge); a reference to something the
 *                    document does not describe
 *   5. individual -- everything else
 *
 * Literals never become nodes; they are collected on the subject as
 * `node.literals`. rdf:first / rdf:rest triples are list plumbing and are
 * dropped from the graph (they still count in `stats.triples`).
 *
 * @param {{triples?: any[], prefixes?: Record<string, string>}} parsed
 * @param {{maxNodes?: number, maxLiteralsPerNode?: number}} [options]
 * @returns {{nodes: any[], edges: any[], stats: any, warnings: string[]}}
 */
export function buildGraph(parsed, options) {
  const opts = isObject(options) ? options : {}
  const maxNodes = positiveInteger(opts.maxNodes, 1200)
  const maxLiterals = positiveInteger(opts.maxLiteralsPerNode, 60)

  const input = isObject(parsed) ? parsed : {}
  const triples = Array.isArray(input.triples) ? input.triples : []
  const prefixes = isObject(input.prefixes) ? input.prefixes : {}
  const warnings = []

  /** id -> { id, types, literals, out, in, label, labelRank } */
  const records = new Map()
  /** id -> true when the node is used as the object of rdf:type (i.e. a class-like IRI) */
  const usedAsType = new Set()
  /** ids involved in rdfs:subClassOf (subject or IRI object) */
  const subclassNodes = new Set()
  /** "s\0p\0o" -> collapsed edge draft */
  const edgeDrafts = new Map()
  /** literal statements retained per subject after capping */
  let literalCount = 0
  let truncatedLiterals = false

  function ensureRecord(id) {
    let record = records.get(id)
    if (record === undefined) {
      record = { id, types: [], literals: [], out: 0, in: 0, label: '', labelRank: 99 }
      records.set(id, record)
    }
    return record
  }

  for (const triple of triples) {
    if (!isObject(triple)) continue
    const subject = typeof triple.s === 'string' ? triple.s : ''
    const predicate = typeof triple.p === 'string' ? triple.p : ''
    if (!subject || !predicate) continue
    if (triple.o === null || triple.o === undefined) continue

    const objectKind = resolveObjectKind(triple, triple.o)
    const objectText = stringValue(triple.o)

    if (objectKind === 'literal') {
      // List plumbing literals are irrelevant once the list is skipped.
      if (LIST_PREDICATES.has(predicate)) continue
      const record = ensureRecord(subject)
      const rank = labelRank(predicate)
      const literal = {
        p: predicate,
        value: objectText,
        order: record.literals.length,
        rank,
      }
      if (typeof triple.dt === 'string' && triple.dt) literal.dt = triple.dt
      if (typeof triple.lang === 'string' && triple.lang) literal.lang = triple.lang
      record.literals.push(literal)
      // rdfs:comment is useful in the detail panel but must not become the
      // node label; only ranks 0..3 are label predicates.
      if (rank <= 3 && rank < record.labelRank) {
        record.labelRank = rank
        record.label = objectText
      }
      continue
    }

    if (LIST_PREDICATES.has(predicate)) continue

    const object = objectText
    if (!object) continue
    const source = ensureRecord(subject)
    const target = ensureRecord(object)
    source.out += 1
    target.in += 1

    if (predicate === RDF_TYPE) {
      if (!source.types.includes(object)) source.types.push(object)
      if (objectKind === 'iri') usedAsType.add(object)
    } else if (predicate === RDFS_SUBCLASSOF) {
      subclassNodes.add(subject)
      subclassNodes.add(object)
    }

    const key = subject + '\u0000' + predicate + '\u0000' + object
    const draft = edgeDrafts.get(key)
    if (draft === undefined) {
      edgeDrafts.set(key, { source: subject, target: object, p: predicate, count: 1 })
    } else {
      draft.count += 1
    }
  }

  // Rank before capping: highest degree first, id as a stable tie-breaker.
  const ranked = []
  for (const record of records.values()) {
    ranked.push({ record, rank: record.out + record.in })
  }
  ranked.sort((a, b) => b.rank - a.rank || compareStrings(a.record.id, b.record.id))

  const droppedNodes = Math.max(0, ranked.length - maxNodes)
  const keptRecords = ranked.slice(0, maxNodes).map((entry) => entry.record)
  const keptIds = new Set(keptRecords.map((record) => record.id))
  if (droppedNodes > 0) {
    warnings.push(
      'Graph node limit reached: kept ' + maxNodes + ' of ' + ranked.length +
      ' nodes (highest degree first), dropped ' + droppedNodes + '.'
    )
  }

  // Keep only edges whose endpoints survived capping.
  const edges = []
  for (const draft of edgeDrafts.values()) {
    if (!keptIds.has(draft.source) || !keptIds.has(draft.target)) continue
    let kind = 'object'
    if (draft.p === RDF_TYPE) kind = 'type'
    else if (draft.p === RDFS_SUBCLASSOF) kind = 'subclass'
    else if (draft.source.startsWith(BLANK_PREFIX) || draft.target.startsWith(BLANK_PREFIX)) kind = 'blank'
    edges.push({
      id: 'e' + edges.length,
      source: draft.source,
      target: draft.target,
      p: draft.p,
      label: shortenIri(draft.p, prefixes),
      kind,
      count: draft.count,
    })
  }

  // Recompute degrees from the retained edges so width/radius match what is drawn.
  const outEdges = new Map()
  const inEdges = new Map()
  for (const record of keptRecords) {
    outEdges.set(record.id, 0)
    inEdges.set(record.id, 0)
  }
  for (const edge of edges) {
    outEdges.set(edge.source, (outEdges.get(edge.source) || 0) + 1)
    inEdges.set(edge.target, (inEdges.get(edge.target) || 0) + 1)
  }

  const nodes = []
  const stats = emptyStats()
  stats.triples = triples.length || Number(input.stats && input.stats.tripleCount) || 0

  for (const record of keptRecords) {
    const out = outEdges.get(record.id) || 0
    const incoming = inEdges.get(record.id) || 0
    const types = record.types.slice()
    let kind
    if (record.id.startsWith(BLANK_PREFIX)) kind = 'blank'
    else if (types.some((type) => PROPERTY_TYPES.has(type))) kind = 'property'
    else if (types.some((type) => CLASS_TYPES.has(type)) || usedAsType.has(record.id) || subclassNodes.has(record.id)) kind = 'class'
    else if (out === 0 && incoming <= 1 && record.literals.length === 0 && types.length === 0) kind = 'external'
    else kind = 'individual'

    // Labels first, then rdfs:comment, then the rest in document order.
    record.literals.sort((a, b) => a.rank - b.rank || a.order - b.order)
    if (record.literals.length > maxLiterals) truncatedLiterals = true
    const literals = record.literals.slice(0, maxLiterals).map((literal) => {
      const item = {
        p: literal.p,
        pLabel: shortenIri(literal.p, prefixes),
        value: literal.value,
      }
      if (literal.dt) item.dt = literal.dt
      if (literal.lang) item.lang = literal.lang
      return item
    })

    const rawLocal = localName(record.id)
    const local = rawLocal || record.id
    const label = record.label || local
    literalCount += literals.length

    if (kind === 'class') stats.classes += 1
    else if (kind === 'property') stats.properties += 1
    else if (kind === 'blank') stats.blanks += 1
    else if (kind === 'individual') stats.individuals += 1

    nodes.push({
      id: record.id,
      label,
      iri: record.id,
      local,
      kind,
      types,
      degree: out + incoming,
      literals,
      outEdges: out,
      inEdges: incoming,
    })
  }

  if (truncatedLiterals) {
    warnings.push('Literal properties were truncated to ' + maxLiterals + ' per node.')
  }

  stats.nodes = nodes.length
  stats.edges = edges.length
  stats.literals = literalCount
  stats.droppedNodes = droppedNodes

  return { nodes, edges, stats, warnings }
}

/**
 * Shorten an IRI with a prefix map: "foaf:Person", else the local name, else
 * the original IRI. The longest matching namespace wins; an empty prefix
 * expands to the bare local name.
 */
export function shortenIri(iri, prefixes) {
  if (typeof iri !== 'string' || !iri) return ''
  if (isObject(prefixes)) {
    let bestPrefix = null
    let bestNamespace = ''
    for (const prefix of Object.keys(prefixes)) {
      const namespace = prefixes[prefix]
      if (typeof namespace !== 'string' || !namespace) continue
      if (!iri.startsWith(namespace)) continue
      if (namespace.length > bestNamespace.length ||
          (namespace.length === bestNamespace.length && bestPrefix !== null && prefix < bestPrefix)) {
        bestPrefix = prefix
        bestNamespace = namespace
      }
    }
    if (bestPrefix !== null && iri.length > bestNamespace.length) {
      const local = iri.slice(bestNamespace.length)
      return bestPrefix ? bestPrefix + ':' + local : local
    }
  }
  const local = localName(iri)
  return local || iri
}

/**
 * Local name after the last "#" or "/". For URNs the part after the last ":"
 * is used, and blank-node ids lose their "_:" marker. May be empty for an IRI
 * whose last segment is empty.
 */
export function localName(iri) {
  if (typeof iri !== 'string') return ''
  let value = iri.trim()
  if (!value) return ''
  if (value.startsWith(BLANK_PREFIX)) value = value.slice(2)
  const hash = value.lastIndexOf('#')
  const slash = value.lastIndexOf('/')
  const cut = hash > slash ? hash : slash
  if (cut >= 0) return value.slice(cut + 1)
  const colon = value.lastIndexOf(':')
  if (colon >= 0) return value.slice(colon + 1)
  return value
}

/**
 * Find nodes whose label, IRI or local name contains the query
 * (case-insensitive). Results are ordered best match first: exact, prefix,
 * label substring, then local/IRI substring. Returns node ids.
 */
export function matchNodes(graph, query, limit) {
  const nodes = isObject(graph) && Array.isArray(graph.nodes) ? graph.nodes : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!needle) return []
  const max = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : nodes.length
  const scored = []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!isObject(node) || typeof node.id !== 'string') continue
    const label = stringValue(node.label).toLowerCase()
    const iri = stringValue(node.iri || node.id).toLowerCase()
    const local = stringValue(node.local).toLowerCase()
    let score = 0
    if (label === needle || local === needle || iri === needle) score = 100
    else if (label.startsWith(needle) || local.startsWith(needle)) score = 60
    else if (label.indexOf(needle) >= 0) score = 40
    else if (local.indexOf(needle) >= 0 || iri.indexOf(needle) >= 0) score = 20
    if (score > 0) scored.push({ id: node.id, score, index })
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, max).map((entry) => entry.id)
}

/** Statistics for an already-selected node/edge subset. */
function statsFor(nodes, edges, triples) {
  const stats = emptyStats()
  stats.triples = Number.isFinite(triples) ? triples : 0
  stats.nodes = nodes.length
  stats.edges = edges.length
  for (const node of nodes) {
    if (!isObject(node)) continue
    if (Array.isArray(node.literals)) stats.literals += node.literals.length
    if (node.kind === 'class') stats.classes += 1
    else if (node.kind === 'property') stats.properties += 1
    else if (node.kind === 'blank') stats.blanks += 1
    else if (node.kind === 'individual') stats.individuals += 1
  }
  return stats
}

/**
 * Subgraph induced by the given node ids; edges survive only when both ends
 * are inside. Node objects are reused as-is (their degree still reflects the
 * full graph), which keeps focus-mode filtering cheap.
 */
export function subgraph(graph, nodeIds) {
  const input = isObject(graph) ? graph : {}
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  const wanted = new Set(Array.isArray(nodeIds) ? nodeIds.filter((id) => typeof id === 'string') : [])

  const keptNodes = nodes.filter((node) => isObject(node) && typeof node.id === 'string' && wanted.has(node.id))
  const keptIds = new Set(keptNodes.map((node) => node.id))
  const keptEdges = edges.filter((edge) =>
    isObject(edge) && keptIds.has(edge.source) && keptIds.has(edge.target))

  return {
    nodes: keptNodes,
    edges: keptEdges,
    stats: statsFor(keptNodes, keptEdges, input.stats && input.stats.triples),
    warnings: Array.isArray(input.warnings) ? input.warnings.slice() : [],
  }
}

/**
 * Neighbour ids of one node within `depth` hops (default 1), including the
 * node itself. Unknown nodes return an empty array.
 */
export function neighborhood(graph, nodeId, depth) {
  const input = isObject(graph) ? graph : {}
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  if (typeof nodeId !== 'string' || !nodes.some((node) => isObject(node) && node.id === nodeId)) return []

  const requestedDepth = Number.isFinite(depth) ? Math.floor(depth) : 1
  const limit = Math.max(0, Math.min(10, requestedDepth))
  const adjacency = new Map()
  for (const node of nodes) {
    if (isObject(node) && typeof node.id === 'string') adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    if (!isObject(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') continue
    if (edge.source === edge.target) continue
    const from = adjacency.get(edge.source)
    const to = adjacency.get(edge.target)
    if (from) from.push(edge.target)
    if (to) to.push(edge.source)
  }

  const seen = new Set([nodeId])
  const order = [nodeId]
  let frontier = [nodeId]
  for (let step = 0; step < limit; step += 1) {
    const next = []
    for (const current of frontier) {
      const neighbours = adjacency.get(current)
      if (!neighbours) continue
      for (const neighbour of neighbours) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        order.push(neighbour)
        next.push(neighbour)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return order
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function positiveInteger(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.floor(value)
  return integer > 0 ? integer : fallback
}

function numberOption(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

/** Mulberry32: tiny, fast, deterministic PRNG (never Math.random). */
function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic per-index pseudo-random value in [0, 1) for cheap sampling. */
function hashUnit(a, b, c) {
  let value = Math.imul(a + 1, 0x9e3779b1)
  value ^= Math.imul(b + 1, 0x85ebca6b)
  value ^= Math.imul(c + 1, 0xc2b2ae35)
  value ^= value >>> 15
  value = Math.imul(value, 0x2545f491)
  value ^= value >>> 13
  return (value >>> 0) / 4294967296
}

/**
 * Deterministic force-directed layout in a width x height box.
 *
 * The graph is split into connected components, components are seeded on a
 * grid of cells (so they cannot collapse onto each other), and each cell gets
 * a phyllotaxis seed. A Fruchterman-Reingold style pass then runs with:
 *   - attractive forces along edges,
 *   - repulsive forces between nodes (exact for small graphs, deterministic
 *     sampling for large ones so 1200 nodes stay interactive),
 *   - a weak pull towards the component's grid cell centre,
 *   - a linear cooling schedule and a per-iteration displacement cap.
 * The result is finally scaled and centred into the padded box.
 *
 * Same graph + same seed => byte-identical positions.
 *
 * @param {any} graph
 * @param {{width?: number, height?: number, iterations?: number, seed?: number, padding?: number}} [options]
 * @returns {{id: string, x: number, y: number, vx: number, vy: number}[]}
 */
export function layoutGraph(graph, options) {
  const opts = isObject(options) ? options : {}
  const width = Math.max(1, numberOption(opts.width, 900))
  const height = Math.max(1, numberOption(opts.height, 600))
  const iterations = Math.max(0, Math.min(2000, Math.floor(numberOption(opts.iterations, 320))))
  const seed = Number.isFinite(opts.seed) ? Math.floor(opts.seed) >>> 0 : 1
  const requestedPadding = Math.max(0, numberOption(opts.padding, 24))
  const padding = Math.min(requestedPadding, Math.min(width, height) * 0.45)

  const nodes = isObject(graph) && Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = isObject(graph) && Array.isArray(graph.edges) ? graph.edges : []

  // Deduplicate ids while preserving input order; the caller normally sends
  // already-deduped buildGraph output.
  const ids = []
  const indexById = new Map()
  for (const node of nodes) {
    if (!isObject(node) || typeof node.id !== 'string') continue
    if (indexById.has(node.id)) continue
    indexById.set(node.id, ids.length)
    ids.push(node.id)
  }

  const count = ids.length
  if (count === 0) return []
  if (count === 1) {
    return [{ id: ids[0], x: width / 2, y: height / 2, vx: 0, vy: 0 }]
  }

  const adjacency = []
  for (let i = 0; i < count; i += 1) adjacency.push([])
  const usableEdges = []
  for (const edge of edges) {
    if (!isObject(edge)) continue
    const source = indexById.get(edge.source)
    const target = indexById.get(edge.target)
    if (source === undefined || target === undefined || source === target) continue
    adjacency[source].push(target)
    adjacency[target].push(source)
    usableEdges.push([source, target])
  }

  // --- connected components -------------------------------------------------
  const componentOf = new Int32Array(count).fill(-1)
  const components = []
  for (let start = 0; start < count; start += 1) {
    if (componentOf[start] !== -1) continue
    const componentIndex = components.length
    const members = [start]
    componentOf[start] = componentIndex
    const stack = [start]
    while (stack.length > 0) {
      const current = stack.pop()
      for (const neighbour of adjacency[current]) {
        if (componentOf[neighbour] !== -1) continue
        componentOf[neighbour] = componentIndex
        members.push(neighbour)
        stack.push(neighbour)
      }
    }
    components.push(members)
  }

  const placement = components.map((members, index) => ({ members, index }))
  placement.sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0])

  const random = mulberry32(seed)
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  const centerX = new Float64Array(components.length)
  const centerY = new Float64Array(components.length)

  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)))
  const rows = Math.max(1, Math.ceil(components.length / columns))
  const cellWidth = width / columns
  const cellHeight = height / rows
  const largest = placement[0].members.length
  const ideal = Math.max(6, Math.min(0.45 * Math.min(width, height), 0.8 * Math.sqrt((width * height) / count)))
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let slot = 0; slot < placement.length; slot += 1) {
    const entry = placement[slot]
    const column = slot % columns
    const row = Math.floor(slot / columns)
    const cx = (column + 0.5) * cellWidth
    const cy = (row + 0.5) * cellHeight
    centerX[entry.index] = cx
    centerY[entry.index] = cy

    const members = entry.members
    const sizeFactor = Math.sqrt(members.length / Math.max(1, largest))
    const radius = 0.42 * Math.min(cellWidth, cellHeight) * sizeFactor
    for (let position = 0; position < members.length; position += 1) {
      const nodeIndex = members[position]
      // Seeded jitter breaks the perfect rotational symmetry and makes a
      // different seed produce a different (but still stable) drawing.
      const angle = position * goldenAngle + (random() - 0.5) * 0.7
      const distance = radius * Math.sqrt((position + 0.5) / members.length) * (0.9 + random() * 0.2)
      xs[nodeIndex] = cx + Math.cos(angle) * distance
      ys[nodeIndex] = cy + Math.sin(angle) * distance
    }
  }

  // --- force pass -----------------------------------------------------------
  const exactRepulsion = count <= 420
  const sampleCount = Math.min(count - 1, 28)
  const repulsionScale = exactRepulsion ? 1 : (count - 1) / sampleCount
  const edgeStride = usableEdges.length > 30000 ? Math.ceil(usableEdges.length / 30000) : 1
  const dispX = new Float64Array(count)
  const dispY = new Float64Array(count)
  const startTemperature = ideal * 0.9

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    dispX.fill(0)
    dispY.fill(0)

    // Attractive forces along edges (Fruchterman-Reingold f = d^2 / k).
    for (let index = 0; index < usableEdges.length; index += edgeStride) {
      const edge = usableEdges[index]
      const source = edge[0]
      const target = edge[1]
      let dx = xs[source] - xs[target]
      let dy = ys[source] - ys[target]
      let distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < 0.01) {
        dx = (hashUnit(source, target, iteration) - 0.5) * 0.02
        dy = (hashUnit(target, source, iteration) - 0.5) * 0.02
        distance = Math.sqrt(dx * dx + dy * dy)
      }
      if (!(distance > 1e-9)) {
        dx = 0.01
        dy = 0
        distance = 0.01
      }
      const force = Math.min((distance * distance) / ideal, ideal * 4) * edgeStride
      const ux = dx / distance
      const uy = dy / distance
      dispX[source] -= ux * force
      dispY[source] -= uy * force
      dispX[target] += ux * force
      dispY[target] += uy * force
    }

    // Repulsive forces between nodes.
    if (exactRepulsion) {
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          let dx = xs[i] - xs[j]
          let dy = ys[i] - ys[j]
          let distance = Math.sqrt(dx * dx + dy * dy)
          if (distance < 0.01) {
            dx = (hashUnit(i, j, iteration) - 0.5) * 0.02
            dy = (hashUnit(j, i, iteration) - 0.5) * 0.02
            distance = Math.sqrt(dx * dx + dy * dy)
          }
          if (!(distance > 1e-9)) {
            dx = 0.01
            dy = 0
            distance = 0.01
          }
          const force = Math.min((ideal * ideal) / distance, ideal * 8)
          const ux = dx / distance
          const uy = dy / distance
          dispX[i] += ux * force
          dispY[i] += uy * force
          dispX[j] -= ux * force
          dispY[j] -= uy * force
        }
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        for (let sample = 0; sample < sampleCount; sample += 1) {
          let j = Math.floor(hashUnit(i, sample, iteration + seed) * count)
          if (j >= count) j = count - 1
          if (j === i) continue
          let dx = xs[i] - xs[j]
          let dy = ys[i] - ys[j]
          let distance = Math.sqrt(dx * dx + dy * dy)
          if (distance < 0.01) {
            dx = (hashUnit(i, sample, iteration) - 0.5) * 0.02
            dy = (hashUnit(sample, i, iteration) - 0.5) * 0.02
            distance = Math.sqrt(dx * dx + dy * dy)
          }
          if (!(distance > 1e-9)) {
            dx = 0.01
            dy = 0
            distance = 0.01
          }
          const force = Math.min((ideal * ideal) / distance, ideal * 8) * repulsionScale
          const ux = dx / distance
          const uy = dy / distance
          dispX[i] += ux * force
          dispY[i] += uy * force
          dispX[j] -= ux * force * 0.25
          dispY[j] -= uy * force * 0.25
        }
      }
    }

    // Weak gravity towards each component's grid cell centre keeps
    // disconnected clusters in their own region of the canvas.
    for (let i = 0; i < count; i += 1) {
      const component = componentOf[i]
      dispX[i] += (centerX[component] - xs[i]) * 0.02
      dispY[i] += (centerY[component] - ys[i]) * 0.02
    }

    // Cool down and apply a capped displacement.
    const temperature = startTemperature * (1 - (iteration + 1) / iterations) + ideal * 0.002
    for (let i = 0; i < count; i += 1) {
      const dx = dispX[i]
      const dy = dispY[i]
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (!Number.isFinite(distance) || distance < 1e-9) continue
      const step = Math.min(distance, temperature) / distance
      const nextX = xs[i] + dx * step
      const nextY = ys[i] + dy * step
      if (Number.isFinite(nextX)) xs[i] = nextX
      if (Number.isFinite(nextY)) ys[i] = nextY
    }
  }

  // --- fit into the padded box ---------------------------------------------
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i += 1) {
    if (xs[i] < minX) minX = xs[i]
    if (xs[i] > maxX) maxX = xs[i]
    if (ys[i] < minY) minY = ys[i]
    if (ys[i] > maxY) maxY = ys[i]
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minX = maxX = minY = maxY = 0
  }

  const spanX = maxX - minX
  const spanY = maxY - minY
  const availableWidth = Math.max(0, width - padding * 2)
  const availableHeight = Math.max(0, height - padding * 2)
  const scaleX = spanX > 1e-9 ? availableWidth / spanX : Infinity
  const scaleY = spanY > 1e-9 ? availableHeight / spanY : Infinity
  let scale = Math.min(scaleX, scaleY)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  const offsetX = (width - spanX * scale) / 2 - minX * scale
  const offsetY = (height - spanY * scale) / 2 - minY * scale
  const lowerX = padding
  const upperX = width - padding
  const lowerY = padding
  const upperY = height - padding

  const result = new Array(count)
  for (let i = 0; i < count; i += 1) {
    let x = offsetX + xs[i] * scale
    let y = offsetY + ys[i] * scale
    if (!Number.isFinite(x)) x = width / 2
    if (!Number.isFinite(y)) y = height / 2
    x = Math.min(upperX, Math.max(lowerX, x))
    y = Math.min(upperY, Math.max(lowerY, y))
    result[i] = { id: ids[i], x, y, vx: 0, vy: 0 }
  }
  return result
}
