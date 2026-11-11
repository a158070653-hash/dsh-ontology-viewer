/**
 * Graph model + deterministic layout for the ontology viewer.
 *
 * This module is pure ECMAScript on purpose: it is concatenated into the
 * browser Client bundle (see build/build.mjs) and also imported directly by
 * the Node test runner. No DOM, no React, no Node globals, no imports.
 *
 * The input contract is the parsed-RDF shape produced by src/rdf-parse.js:
 *   { prefixes, base, triples: [{ s, p, o, oKind, lang?, dt? }], stats, warnings }
 *
 * Export surface (additive; the first seven keep their V1.0.0 signatures and
 * defaults, see design §10):
 *   buildGraph, shortenIri, localName, matchNodes, subgraph, neighborhood,
 *   layoutGraph,
 *   filterGraph, applyEdgeBudget, exploreNeighborhood, connectionGroups,
 *   createLayoutTask, budgetRecord.
 *
 * Data layers (design §1.5) that callers must state when they read them:
 *   L1 fullGraph      -- buildGraph output, read by search/details/exploration/totals
 *   L2 filteredGraph  -- filterGraph projection, read by exploration start
 *   L3 exploredGraph  -- exploreNeighborhood output, read for exploration counts
 *   L4 drawnGraph     -- applyEdgeBudget projection, read ONLY by rendering
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

/**
 * Structured budget record. Every truncation level reports the same
 * `{ total, kept, truncated, reason }` shape (design §1.5 / §8.2) so the UI can
 * derive counts and notices from one representation. `truncated` is a number
 * (kept vs total delta), `reason` is null when nothing was dropped.
 *
 * @param {number} total
 * @param {number} kept
 * @param {string} [reason]
 * @returns {{total: number, kept: number, truncated: number, reason: string|null}}
 */
export function budgetRecord(total, kept, reason) {
  const totalValue = typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  let keptValue = typeof kept === 'number' && Number.isFinite(kept) && kept > 0 ? Math.floor(kept) : 0
  if (keptValue > totalValue) keptValue = totalValue
  const truncated = totalValue - keptValue
  return {
    total: totalValue,
    kept: keptValue,
    truncated,
    reason: truncated > 0 ? (typeof reason === 'string' && reason ? reason : 'budget') : null,
  }
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
    droppedEdges: 0,
    droppedLiterals: 0,
  }
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
 * Resolve graph-level source metadata (spec "源位置预留", design §1.4).
 *
 * `options.source` is the authoritative explicit input; otherwise the parsed
 * document is consulted defensively (`resourceAddress` first, then a
 * resource-derived `base`). A document-declared `@base` is not a resource
 * address and must not be reported as one. Missing values are empty strings,
 * never a fabricated address or display name.
 *
 * @param {any} opts buildGraph options
 * @param {any} input parsed document
 * @returns {{address: string, displayName: string, format: string}}
 */
function resolveGraphSource(opts, input) {
  const explicit = isObject(opts.source) ? opts.source : {}
  let address = ''
  if (typeof explicit.address === 'string') address = explicit.address
  else if (typeof input.resourceAddress === 'string') address = input.resourceAddress
  else if (typeof input.base === 'string' && input.baseSource !== 'document') address = input.base
  let displayName = ''
  if (typeof explicit.displayName === 'string') displayName = explicit.displayName
  else if (typeof input.displayName === 'string') displayName = input.displayName
  else if (typeof input.fileName === 'string') displayName = input.fileName
  let format = ''
  if (typeof explicit.format === 'string') format = explicit.format
  else if (typeof input.format === 'string') format = input.format
  return { address, displayName, format }
}

/**
 * Graph context used when a caller hands over statements that predate the
 * graph field: the model never claims those statements belong to the default
 * graph, because the source may have lost that information.
 */
const FALLBACK_STATEMENT_GRAPH = Object.freeze({ kind: 'unknown' })
const LEGACY_SOURCE_ID = 'single'

/**
 * Expand the input into flat statements that carry source and statement
 * identity. The workspace composes merged records and passes the expanded
 * occurrences through `options.statements`; a plain parsed document keeps the
 * V1.0.0 `triples` contract and is wrapped as one legacy source.
 */
function normalizeStatements(input, opts) {
  if (Array.isArray(opts.statements)) return opts.statements
  const triples = Array.isArray(input.triples) ? input.triples : []
  const explicit = typeof opts.sourceId === 'string' && opts.sourceId
    ? opts.sourceId
    : (typeof input.sourceId === 'string' && input.sourceId ? input.sourceId : LEGACY_SOURCE_ID)
  const statements = new Array(triples.length)
  for (let index = 0; index < triples.length; index++) {
    const triple = triples[index]
    if (!isObject(triple)) {
      statements[index] = triple
      continue
    }
    statements[index] = {
      s: triple.s,
      p: triple.p,
      o: triple.o,
      oKind: triple.oKind,
      dt: triple.dt,
      lang: triple.lang,
      literalTruncated: triple.literalTruncated,
      graph: isObject(triple.graph) ? triple.graph : FALLBACK_STATEMENT_GRAPH,
      sourceId: typeof triple.sourceId === 'string' && triple.sourceId ? triple.sourceId : explicit,
      statementId: typeof triple.statementId === 'string' && triple.statementId
        ? triple.statementId
        : 'legacy:' + explicit + ':' + index,
    }
  }
  return statements
}

/** Sorted copy of a Set of strings, for stable output. */
function sortedValues(set) {
  const values = []
  for (const value of set) values.push(value)
  return values.sort(compareStrings)
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
 * Provenance: nodes, literals and edges carry `sourceIds` / `statementIds`
 * collected from the statements that produced them. They never infer a byte,
 * line or column position (`location` stays null upstream).
 *
 * Budgets (all optional, all structured, none silent):
 *   - maxNodes (default 1200): highest total degree first, id as stable tie-break.
 *   - maxLiteralsPerNode (default 60): per-node literal statements kept.
 *   - maxEdges (default off): model-level distinct edge budget. Kept edges are
 *     ordered by combined parallel `count` desc, full-graph degree sum desc,
 *     then (source, predicate, target) lexicographic; output order stays the
 *     first-occurrence order so ids remain stable.
 *   - maxLiteralLength (default off): single literal value `length` cap; a
 *     truncated value is marked with `literal.truncated = true`.
 *
 * @param {{triples?: any[], prefixes?: Record<string, string>, sources?: any[]}} parsed
 * @param {{statements?: any[], sources?: any[], sourceId?: string,
 *          maxNodes?: number, maxLiteralsPerNode?: number, maxEdges?: number,
 *          maxLiteralLength?: number,
 *          source?: {address?: string, displayName?: string, format?: string}}} [options]
 * @returns {{nodes: any[], edges: any[], stats: any, warnings: string[],
 *            truncation: any, sources: any[],
 *            source: {address: string, displayName: string, format: string}}}
 */
export function buildGraph(parsed, options) {
  const opts = isObject(options) ? options : {}
  const maxNodes = positiveInteger(opts.maxNodes, 1200)
  const maxLiterals = positiveInteger(opts.maxLiteralsPerNode, 60)
  const maxLiteralLength = optionalPositiveInteger(opts.maxLiteralLength)
  const maxEdges = optionalPositiveInteger(opts.maxEdges)

  const input = isObject(parsed) ? parsed : {}
  const statements = normalizeStatements(input, opts)
  const prefixes = isObject(input.prefixes) ? input.prefixes : {}
  const warnings = []
  const source = resolveGraphSource(opts, input)
  const sources = Array.isArray(opts.sources)
    ? opts.sources
    : (Array.isArray(input.sources) ? input.sources : [])

  /** id -> { id, types, literals, out, in, label, labelRank } */
  const records = new Map()
  /** id -> { sourceIds: Set, statementIds: Set, roles: Set } */
  const provenance = new Map()
  /** id -> true when the node is used as the object of rdf:type (i.e. a class-like IRI) */
  const usedAsType = new Set()
  /** ids involved in rdfs:subClassOf (subject or IRI object) */
  const subclassNodes = new Set()
  /** "s\0p\0o" -> collapsed edge draft */
  const edgeDrafts = new Map()
  /** literal value truncations applied because of maxLiteralLength */
  let truncatedValues = 0

  function ensureRecord(id) {
    let record = records.get(id)
    if (record === undefined) {
      record = { id, types: [], literals: [], out: 0, in: 0, label: '', labelRank: 99 }
      records.set(id, record)
    }
    return record
  }

  /** Record one entity occurrence for provenance, without inferring positions. */
  function noteProvenance(id, statement, role) {
    let entry = provenance.get(id)
    if (entry === undefined) {
      entry = { sourceIds: new Set(), statementIds: new Set(), roles: new Set(), bySource: new Map() }
      provenance.set(id, entry)
    }
    if (typeof statement.sourceId === 'string' && statement.sourceId) {
      entry.sourceIds.add(statement.sourceId)
      let contribution = entry.bySource.get(statement.sourceId)
      if (!contribution) {
        contribution = { roles: new Set(), statementIds: new Set() }
        entry.bySource.set(statement.sourceId, contribution)
      }
      contribution.roles.add(role)
      if (statement.statementId) contribution.statementIds.add(statement.statementId)
    }
    if (typeof statement.statementId === 'string' && statement.statementId) {
      entry.statementIds.add(statement.statementId)
    }
    entry.roles.add(role)
  }

  /**
   * Remember one distinct graph context of an edge. Blank and unknown graph
   * names stay scoped to their source so equal labels do not merge them.
   */
  function noteDraftGraph(draft, statement) {
    const graph = isObject(statement.graph) ? statement.graph : FALLBACK_STATEMENT_GRAPH
    const sourceId = typeof statement.sourceId === 'string' ? statement.sourceId : ''
    let kind = 'default'
    if (graph.kind === 'iri' && typeof graph.value === 'string' && graph.value !== '') kind = 'iri'
    else if (graph.kind === 'blank') kind = 'blank'
    else if (graph.kind === 'unknown') kind = 'unknown'
    let key = 'd'
    if (kind === 'iri') key = 'i\t' + graph.value
    else if (kind === 'blank') key = 'b\t' + sourceId + '\t' + String(graph.value || '')
    else if (kind === 'unknown') key = 'u\t' + sourceId
    let entry = draft.graphMap.get(key)
    if (entry === undefined) {
      entry = { kind: kind, sourceIds: new Set() }
      if (kind === 'iri' || kind === 'blank') entry.value = String(graph.value)
      draft.graphMap.set(key, entry)
    }
    if (sourceId) entry.sourceIds.add(sourceId)
  }

  for (const triple of statements) {
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
      noteProvenance(subject, triple, 'subject')
      const rank = labelRank(predicate)
      let value = objectText
      let valueTruncated = false
      if (maxLiteralLength > 0 && value.length > maxLiteralLength) {
        value = value.slice(0, maxLiteralLength)
        valueTruncated = true
        truncatedValues += 1
      }
      const literal = {
        p: predicate,
        value,
        order: record.literals.length,
        rank,
        sourceIds: typeof triple.sourceId === 'string' && triple.sourceId ? [triple.sourceId] : [],
        statementIds: typeof triple.statementId === 'string' && triple.statementId
          ? [triple.statementId]
          : [],
      }
      if (valueTruncated) literal.truncated = true
      if (typeof triple.dt === 'string' && triple.dt) literal.dt = triple.dt
      if (typeof triple.lang === 'string' && triple.lang) literal.lang = triple.lang
      record.literals.push(literal)
      // rdfs:comment is useful in the detail panel but must not become the
      // node label; only ranks 0..3 are label predicates.
      if (rank <= 3 && rank < record.labelRank) {
        record.labelRank = rank
        record.label = value
      }
      continue
    }

    if (LIST_PREDICATES.has(predicate)) continue

    const object = objectText
    if (!object) continue
    const sourceRecord = ensureRecord(subject)
    const targetRecord = ensureRecord(object)
    sourceRecord.out += 1
    targetRecord.in += 1

    if (predicate === RDF_TYPE) {
      if (!sourceRecord.types.includes(object)) sourceRecord.types.push(object)
      if (objectKind === 'iri') usedAsType.add(object)
    } else if (predicate === RDFS_SUBCLASSOF) {
      subclassNodes.add(subject)
      subclassNodes.add(object)
    }

    const key = subject + '\u0000' + predicate + '\u0000' + object
    let draft = edgeDrafts.get(key)
    if (draft === undefined) {
      draft = {
        source: subject,
        target: object,
        p: predicate,
        count: 0,
        sourceIds: new Set(),
        statementIds: new Set(),
        graphMap: new Map(),
      }
      edgeDrafts.set(key, draft)
    }
    draft.count += 1
    noteProvenance(subject, triple, 'subject')
    noteProvenance(object, triple, 'object')
    noteProvenance(predicate, triple, 'predicate')
    if (typeof triple.sourceId === 'string' && triple.sourceId) draft.sourceIds.add(triple.sourceId)
    if (typeof triple.statementId === 'string' && triple.statementId) {
      draft.statementIds.add(triple.statementId)
    }
    noteDraftGraph(draft, triple)
  }

  function degreeOf(id) {
    const record = records.get(id)
    return record === undefined ? 0 : record.out + record.in
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

  // Keep only edges whose endpoints survived capping, then optionally apply
  // the model-level distinct-edge budget.
  const totalEdgeCandidates = edgeDrafts.size
  const retainedDrafts = []
  for (const draft of edgeDrafts.values()) {
    if (!keptIds.has(draft.source) || !keptIds.has(draft.target)) continue
    retainedDrafts.push(draft)
  }
  const droppedByNodeLimit = totalEdgeCandidates - retainedDrafts.length
  let keptDrafts = retainedDrafts
  let droppedByBudget = 0
  if (maxEdges > 0 && retainedDrafts.length > maxEdges) {
    // Deterministic priority: parallel count first, then full-graph degree
    // sum, then the canonical (source, predicate, target) key.
    const rankedEdges = retainedDrafts.slice()
    rankedEdges.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count
      const degreeA = degreeOf(a.source) + degreeOf(a.target)
      const degreeB = degreeOf(b.source) + degreeOf(b.target)
      if (degreeA !== degreeB) return degreeB - degreeA
      return compareStrings(a.source, b.source) ||
        compareStrings(a.p, b.p) ||
        compareStrings(a.target, b.target)
    })
    const keptSet = new Set(rankedEdges.slice(0, maxEdges))
    keptDrafts = retainedDrafts.filter((draft) => keptSet.has(draft))
    droppedByBudget = retainedDrafts.length - keptDrafts.length
    warnings.push(
      'Graph edge limit reached: kept ' + keptDrafts.length + ' of ' +
      retainedDrafts.length + ' edges, dropped ' + droppedByBudget + '.'
    )
  }
  const keptDraftSet = new Set(keptDrafts)

  // Emit edges in first-occurrence order so ids stay stable across budgets.
  const edges = []
  function graphsOf(draft) {
    const list = []
    for (const entry of draft.graphMap.values()) {
      const item = { kind: entry.kind }
      if (entry.value !== undefined) item.value = entry.value
      item.sourceIds = sortedValues(entry.sourceIds)
      list.push(item)
    }
    list.sort((a, b) => compareStrings(a.kind, b.kind) ||
      compareStrings(String(a.value || ''), String(b.value || '')))
    return list
  }
  for (const draft of edgeDrafts.values()) {
    if (!keptDraftSet.has(draft)) continue
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
      sourceIds: sortedValues(draft.sourceIds),
      statementIds: sortedValues(draft.statementIds),
      graphs: graphsOf(draft),
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
  stats.triples = statements.length || Number(input.stats && input.stats.tripleCount) || 0
  let literalCandidates = 0
  let keptLiteralCount = 0
  let droppedLiteralCount = 0
  let truncatedLiteralNodes = 0

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
    const totalForNode = record.literals.length
    literalCandidates += totalForNode
    const keptLiterals = record.literals.slice(0, maxLiterals)
    const droppedForNode = totalForNode - keptLiterals.length
    if (droppedForNode > 0) {
      truncatedLiteralNodes += 1
      droppedLiteralCount += droppedForNode
    }
    keptLiteralCount += keptLiterals.length
    const literals = keptLiterals.map((literal) => {
      const item = {
        p: literal.p,
        pLabel: shortenIri(literal.p, prefixes),
        value: literal.value,
        sourceIds: Array.isArray(literal.sourceIds) ? literal.sourceIds.slice() : [],
        statementIds: Array.isArray(literal.statementIds) ? literal.statementIds.slice() : [],
      }
      if (literal.dt) item.dt = literal.dt
      if (literal.lang) item.lang = literal.lang
      if (literal.truncated) item.truncated = true
      return item
    })

    const rawLocal = localName(record.id)
    const local = rawLocal || record.id
    const label = record.label || local
    const origin = provenance.get(record.id)

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
      provenance: {
        sourceIds: origin === undefined ? [] : sortedValues(origin.sourceIds),
        statementIds: origin === undefined ? [] : sortedValues(origin.statementIds),
        roles: origin === undefined ? [] : sortedValues(origin.roles),
        bySource: origin === undefined ? [] : Array.from(origin.bySource, ([sourceId, value]) => ({
          sourceId: sourceId, roles: sortedValues(value.roles), statementIds: sortedValues(value.statementIds),
        })),
      },
      // Reserved source location: always null in this change (spec
      // "源位置预留"); never inferred from filenames or document order.
      literalsTruncated: droppedForNode,
      source: null,
    })
  }

  if (truncatedLiteralNodes > 0) {
    warnings.push('Literal properties were truncated to ' + maxLiterals + ' per node.')
  }
  if (truncatedValues > 0) {
    warnings.push('Literal values were truncated to ' + maxLiteralLength + ' characters.')
  }

  stats.nodes = nodes.length
  stats.edges = edges.length
  stats.literals = keptLiteralCount
  stats.droppedNodes = droppedNodes
  stats.droppedEdges = totalEdgeCandidates - edges.length
  stats.droppedLiterals = droppedLiteralCount

  const truncation = {
    nodes: budgetRecord(ranked.length, keptRecords.length, 'max-nodes'),
    literals: Object.assign(
      budgetRecord(literalCandidates, keptLiteralCount, 'max-literals-per-node'),
      {
        perNodeLimit: maxLiterals,
        truncatedNodes: truncatedLiteralNodes,
        valueTruncated: truncatedValues,
      },
    ),
    edges: Object.assign(
      budgetRecord(totalEdgeCandidates, edges.length, droppedByBudget > 0 ? 'max-edges' : 'node-limit'),
      { droppedByNodeLimit, droppedByBudget },
    ),
  }

  return { nodes, edges, stats, warnings, truncation, sources, source }
}

/**
 * Source-contribution projection (L1 → L2).
 *
 * An empty or absent selection means "all sources". Otherwise an edge is kept
 * only when at least one selected source contributed it, a node only when a
 * selected source contributed to it or it touches a kept edge, and a literal
 * only when a selected source contributed it. The input graph is never
 * mutated: nodes are shallow-copied when their literal list changes.
 *
 * This projection runs before the existing type/predicate/direction filter and
 * exploration, so a shared node cannot drag another source's edges back in.
 *
 * @param {any} graph L1 graph produced by buildGraph
 * @param {string[]} sourceIds selected source ids (empty = all)
 * @returns {{nodes: any[], edges: any[], stats: any, hidden: object}}
 */
export function filterBySources(graph, sourceIds) {
  const input = isObject(graph) ? graph : {}
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  const selected = new Set(
    (Array.isArray(sourceIds) ? sourceIds : []).filter((id) => typeof id === 'string'),
  )
  const all = selected.size === 0
  const contributes = (ids) => all || (Array.isArray(ids) && ids.some((id) => selected.has(id)))

  const keptEdges = edges.filter((edge) => contributes(edge && edge.sourceIds))
  const keptEdgeSet = new Set(keptEdges)
  const touched = new Set()
  for (const edge of keptEdges) {
    touched.add(edge.source)
    touched.add(edge.target)
  }

  const keptNodes = []
  let hiddenNodes = 0
  let hiddenLiterals = 0
  for (const node of nodes) {
    if (!isObject(node)) continue
    const origin = isObject(node.provenance) ? node.provenance : null
    const literals = Array.isArray(node.literals) ? node.literals : []
    const keptLiterals = all
      ? literals
      : literals.filter((literal) => contributes(literal && literal.sourceIds))
    const droppedHere = literals.length - keptLiterals.length
    if (!all && !touched.has(node.id) && !contributes(origin && origin.sourceIds)) {
      hiddenNodes += 1
      hiddenLiterals += literals.length
      continue
    }
    if (droppedHere > 0 || keptLiterals !== literals) {
      hiddenLiterals += droppedHere
      keptNodes.push(Object.assign({}, node, { literals: keptLiterals }))
    } else {
      keptNodes.push(node)
    }
  }

  const stats = statsFor(keptNodes, keptEdges, input.stats && input.stats.triples)
  return {
    nodes: keptNodes,
    edges: keptEdges,
    stats: stats,
    hidden: {
      nodes: hiddenNodes,
      edges: edges.length - keptEdges.length,
      literals: hiddenLiterals,
    },
    sourceIds: all ? [] : Array.from(selected),
  }
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
// Filter projection (L2, design §4)
// ---------------------------------------------------------------------------

/**
 * Pure display projection over the retained full graph (L1). Never mutates the
 * input graph or the parsed data, never re-parses.
 *
 * Criteria semantics (design §4.2):
 *   - `kinds`: node kind allow-list (class/property/individual/blank/external);
 *     empty/absent = all kinds.
 *   - `predicates`: edge predicate allow-list; empty/absent = all predicates.
 *   - `direction`: direction relative to `anchorId`, applied to direct relation
 *     edges only (1 hop): `'out'` keeps edges whose source is the anchor,
 *     `'in'` edges whose target is the anchor, `'both'` edges touching the
 *     anchor in either direction. This is a projection filter, not a traversal:
 *     multi-hop expansion belongs to `exploreNeighborhood`, which applies the
 *     direction again on every hop (so the filter layer must not pre-compute a
 *     reachability cone). Without a usable anchor, or when no direction is
 *     provided at all, the direction condition is inert (spec "无锚点时方向条件
 *     不生效").
 *   - `anchorId`: the selected node; it is always retained, even when it fails
 *     the kind filter, so the selection context cannot vanish.
 *
 * When a relation filter is active (predicates or a direction), nodes that have
 * no retained incident edge are dropped, except the anchor -- relation filtering
 * making isolated nodes disappear is expected behaviour (design §4.2). A pure
 * kind filter keeps matching nodes connected or not.
 *
 * The result is `{ nodes, edges, stats, hidden, graph }` where `graph` is the
 * same projection shaped like a graph model (design names this `{ graph, stats,
 * hidden }`; the flat fields are kept for direct use). `hidden` reports total
 * hidden counts plus independent marginal counts by kind / predicate / direction
 * (the marginals can overlap; totals are exact).
 *
 * @param {any} graph full (L1) or filtered (L2/L3) graph model
 * @param {{kinds?: string[], predicates?: string[], direction?: 'both'|'out'|'in', anchorId?: string}} criteria
 * @param {any} [_options] reserved
 */
export function filterGraph(graph, criteria, _options) {
  const input = isObject(graph) ? graph : {}
  const spec = isObject(criteria) ? criteria : {}
  const allNodes = Array.isArray(input.nodes) ? input.nodes : []
  const allEdges = Array.isArray(input.edges) ? input.edges : []

  const kindSet = new Set(Array.isArray(spec.kinds) ? spec.kinds.filter((kind) => typeof kind === 'string') : [])
  const predicateSet = new Set(Array.isArray(spec.predicates) ? spec.predicates.filter((predicate) => typeof predicate === 'string') : [])
  const directionSpecified = spec.direction === 'out' || spec.direction === 'in' || spec.direction === 'both'
  const requestedDirection = spec.direction === 'out' || spec.direction === 'in' ? spec.direction : 'both'
  const anchorId = typeof spec.anchorId === 'string' ? spec.anchorId : ''
  const hasAnchor = anchorId !== '' && allNodes.some((node) => isObject(node) && node.id === anchorId)
  // Direction filtering only runs when the caller explicitly asks for it and an
  // anchor exists. With an anchor all three directions are meaningful --
  // including 'both', which keeps the anchor's direct in+out relations.
  const directionActive = hasAnchor && directionSpecified
  const kindsActive = kindSet.size > 0
  const predicatesActive = predicateSet.size > 0
  const relationActive = predicatesActive || directionActive

  function nodeAllowed(node) {
    if (!kindsActive) return true
    return kindSet.has(node.kind)
  }

  const keptNodeIds = new Set()
  const keptNodes = []
  for (const node of allNodes) {
    if (!isObject(node) || typeof node.id !== 'string') continue
    if (node.id === anchorId || nodeAllowed(node)) {
      keptNodeIds.add(node.id)
      keptNodes.push(node)
    }
  }

  function edgeAllowed(edge) {
    if (!predicatesActive) return true
    return predicateSet.has(edge.p)
  }

  const predicateEdges = allEdges.filter((edge) =>
    isObject(edge) &&
    keptNodeIds.has(edge.source) &&
    keptNodeIds.has(edge.target) &&
    edgeAllowed(edge))

  // Direction filters direct relation edges relative to the anchor (1 hop).
  // The filter layer never traverses: multi-hop expansion belongs to
  // exploreNeighborhood, which re-applies the direction on every hop.
  let finalEdges = predicateEdges
  if (directionActive) {
    finalEdges = predicateEdges.filter((edge) => {
      if (requestedDirection === 'out') return edge.source === anchorId
      if (requestedDirection === 'in') return edge.target === anchorId
      return edge.source === anchorId || edge.target === anchorId
    })
  }

  let finalNodes = keptNodes
  if (relationActive) {
    const incident = new Set()
    for (const edge of finalEdges) {
      incident.add(edge.source)
      incident.add(edge.target)
    }
    finalNodes = keptNodes.filter((node) => node.id === anchorId || incident.has(node.id))
  }

  const stats = statsFor(finalNodes, finalEdges, input.stats && input.stats.triples)
  stats.totalNodes = allNodes.length
  stats.totalEdges = allEdges.length

  let hiddenByKindNodes = 0
  for (const node of allNodes) {
    if (!isObject(node) || typeof node.id !== 'string' || node.id === anchorId) continue
    if (!nodeAllowed(node)) hiddenByKindNodes += 1
  }
  let hiddenByPredicateEdges = 0
  for (const edge of allEdges) {
    if (!isObject(edge)) continue
    if (!edgeAllowed(edge)) hiddenByPredicateEdges += 1
  }
  let hiddenByDirectionEdges = 0
  if (directionActive) {
    for (const edge of allEdges) {
      if (!isObject(edge)) continue
      if (!edgeAllowed(edge)) continue
      if (!keptNodeIds.has(edge.source) || !keptNodeIds.has(edge.target)) continue
      let incident
      if (requestedDirection === 'out') incident = edge.source === anchorId
      else if (requestedDirection === 'in') incident = edge.target === anchorId
      else incident = edge.source === anchorId || edge.target === anchorId
      if (!incident) hiddenByDirectionEdges += 1
    }
  }

  const hidden = {
    nodes: allNodes.length - finalNodes.length,
    edges: allEdges.length - finalEdges.length,
    byKind: { nodes: hiddenByKindNodes },
    byPredicate: { edges: hiddenByPredicateEdges },
    byDirection: { edges: hiddenByDirectionEdges },
  }

  const projectedGraph = {
    nodes: finalNodes,
    edges: finalEdges,
    stats,
    warnings: Array.isArray(input.warnings) ? input.warnings.slice() : [],
    source: isObject(input.source) ? input.source : null,
    truncation: isObject(input.truncation) ? input.truncation : null,
  }

  return { nodes: finalNodes, edges: finalEdges, stats, hidden, graph: projectedGraph }
}

// ---------------------------------------------------------------------------
// Draw budget (L4, design §8 / spec "绘制预算")
// ---------------------------------------------------------------------------

/**
 * Deterministic drawing projection: keep at most `maxEdges` distinct edges
 * (optionally bounded further by `maxElements`, where one element is one node
 * plus one edge). The result is display-only: search, exploration, details and
 * totals must keep reading the retained full graph (L1).
 *
 * Priority (design §8.3): edges incident to `priorityIds` (selected node /
 * search hit) first, then higher parallel `count`, then edge id lexicographic.
 * Output keeps the input edge order so z-order stays stable.
 *
 * @param {any} graph
 * @param {{maxEdges?: number, maxElements?: number, priorityIds?: string[]}} [budget]
 * @returns {{nodes: any[], edges: any[], stats: {keptEdges: number, hiddenEdges: number, totalEdges: number},
 *            truncation: {edges: any}, displayOnly: true}}
 */
export function applyEdgeBudget(graph, budget) {
  const input = isObject(graph) ? graph : {}
  const spec = isObject(budget) ? budget : {}
  const allNodes = Array.isArray(input.nodes) ? input.nodes : []
  const allEdges = Array.isArray(input.edges) ? input.edges : []
  const requestedMaxEdges = optionalPositiveInteger(spec.maxEdges)
  const requestedMaxElements = optionalPositiveInteger(spec.maxElements)
  const prioritySet = new Set(Array.isArray(spec.priorityIds) ? spec.priorityIds.filter((id) => typeof id === 'string') : [])

  let limit = Infinity
  let reason = null
  if (requestedMaxEdges > 0) {
    limit = requestedMaxEdges
    reason = 'max-edges'
  }
  if (requestedMaxElements > 0) {
    // One element per node plus one per edge is the approximate SVG cost.
    const elementLimit = Math.max(0, requestedMaxElements - allNodes.length)
    if (elementLimit < limit) {
      limit = elementLimit
      reason = 'max-elements'
    }
  }

  const total = allEdges.length
  let keptEdges = allEdges
  if (Number.isFinite(limit) && total > limit) {
    const ranked = allEdges.map((edge, index) => ({ edge, index }))
    ranked.sort((a, b) => {
      const aPriority = isPriorityEdge(a.edge, prioritySet) ? 0 : 1
      const bPriority = isPriorityEdge(b.edge, prioritySet) ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      const aCount = isObject(a.edge) && Number.isFinite(a.edge.count) ? a.edge.count : 0
      const bCount = isObject(b.edge) && Number.isFinite(b.edge.count) ? b.edge.count : 0
      if (aCount !== bCount) return bCount - aCount
      const aId = isObject(a.edge) && typeof a.edge.id === 'string' ? a.edge.id : ''
      const bId = isObject(b.edge) && typeof b.edge.id === 'string' ? b.edge.id : ''
      return compareStrings(aId, bId) || a.index - b.index
    })
    const keptIndexes = new Set(ranked.slice(0, limit).map((entry) => entry.index))
    keptEdges = allEdges.filter((edge, index) => keptIndexes.has(index))
  }

  const truncation = {
    edges: budgetRecord(total, keptEdges.length, reason === null ? 'max-edges' : reason),
  }
  return {
    nodes: allNodes,
    edges: keptEdges,
    stats: {
      keptEdges: keptEdges.length,
      hiddenEdges: total - keptEdges.length,
      totalEdges: total,
    },
    truncation,
    displayOnly: true,
  }
}

function isPriorityEdge(edge, prioritySet) {
  if (prioritySet.size === 0 || !isObject(edge)) return false
  return prioritySet.has(edge.source) || prioritySet.has(edge.target)
}

// ---------------------------------------------------------------------------
// Multi-hop exploration (L3, design §5 / spec "多跳探索与展开预算")
// ---------------------------------------------------------------------------

function edgeIdentity(edge) {
  return stringValue(edge.source) + '\u0000' + stringValue(edge.p) + '\u0000' + stringValue(edge.target)
}

function cursorExtension(cursor) {
  let value = NaN
  if (typeof cursor === 'number' && Number.isFinite(cursor)) value = cursor
  else if (isObject(cursor)) {
    if (Number.isFinite(cursor.extension)) value = cursor.extension
    else if (Number.isFinite(cursor.extensions)) value = cursor.extensions
  }
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(1000, Math.floor(value))
}

/**
 * Budgeted BFS over an already-filtered graph (L2/L3). Hidden/filtered-away
 * nodes are simply absent, so they can never act as stepping stones.
 *
 *   - depth: clamped to 1..5 (hard cap); request > 5 reports `depthCapped`.
 *   - direction: applies to every hop (out edges / in edges / both).
 *   - predicates: predicate allow-list applied on every hop.
 *   - neighbour order: predicate IRI first, then neighbour node id (deterministic).
 *   - budget: `perHopNodes` new nodes per hop, `maxEdges` global distinct edges.
 *   - cursor: a deterministic effective-budget extension `{ extension: k }`.
 *     Continuing with the returned cursor increases the effective budgets
 *     (base * (k + 1)), so a continued result is always a superset of the
 *     previous result with no duplicate nodes/edges; identical input + cursor
 *     gives an identical result.
 *
 * Result: `{ nodes, edges, nodeIds, stats, truncation, truncated, nextCursor,
 * nextBudget, depthCapped, reachedDepthLimit }`. `stats` carries `nodes`,
 * `edges`, `hops`, `depth`, `totalNodes`, `totalEdges`, `perHopNodes`,
 * `maxEdges`, `extension`, `depthLimit`; `truncation.{nodes,edges}` are
 * `{ total, kept, truncated, reason }` records where `total` is the unbudgeted
 * expansion available within the requested depth (so the UI can show "已展开
 * X / 共 Y"). `truncated` is true when a budget cut the expansion or the
 * requested depth exceeded the hard cap; `nextCursor` is non-null only for
 * budget truncation.
 *
 * @param {any} graph
 * @param {{startId?: string, depth?: number, direction?: 'out'|'in'|'both',
 *          predicates?: string[], budget?: {perHopNodes?: number, maxEdges?: number},
 *          cursor?: number|{extension?: number}}} [options]
 */
export function exploreNeighborhood(graph, options) {
  const input = isObject(graph) ? graph : {}
  const opts = isObject(options) ? options : {}
  const allNodes = Array.isArray(input.nodes) ? input.nodes : []
  const allEdges = Array.isArray(input.edges) ? input.edges : []
  const nodeById = new Map()
  for (const node of allNodes) {
    if (isObject(node) && typeof node.id === 'string' && !nodeById.has(node.id)) nodeById.set(node.id, node)
  }

  const requestedDepth = Number.isFinite(opts.depth) ? Math.floor(opts.depth) : 1
  const depth = Math.max(1, Math.min(5, requestedDepth))
  const depthCapped = requestedDepth > 5
  const direction = opts.direction === 'out' || opts.direction === 'in' ? opts.direction : 'both'
  const predicateSet = new Set(Array.isArray(opts.predicates)
    ? opts.predicates.filter((predicate) => typeof predicate === 'string')
    : [])
  const budgetOptions = isObject(opts.budget) ? opts.budget : {}
  const basePerHopNodes = positiveInteger(budgetOptions.perHopNodes, 300)
  const baseMaxEdges = positiveInteger(budgetOptions.maxEdges, 800)
  const extension = cursorExtension(opts.cursor)
  const perHopNodes = basePerHopNodes * (1 + extension)
  const maxEdges = baseMaxEdges * (1 + extension)

  const stats = {
    nodes: 0,
    edges: 0,
    hops: 0,
    depth,
    requestedDepth,
    totalNodes: nodeById.size,
    totalEdges: allEdges.length,
    perHopNodes,
    maxEdges,
    extension,
    depthLimit: 5,
  }

  const startId = typeof opts.startId === 'string' ? opts.startId : ''
  if (!nodeById.has(startId)) {
    return {
      nodes: [],
      edges: [],
      nodeIds: [],
      stats,
      truncation: {
        nodes: budgetRecord(0, 0, null),
        edges: budgetRecord(0, 0, null),
      },
      truncated: false,
      nextCursor: null,
      nextBudget: null,
      depthCapped,
      reachedDepthLimit: false,
    }
  }

  const outAdjacency = new Map()
  const inAdjacency = new Map()
  for (const id of nodeById.keys()) {
    outAdjacency.set(id, [])
    inAdjacency.set(id, [])
  }
  for (const edge of allEdges) {
    if (!isObject(edge)) continue
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    if (predicateSet.size > 0 && !predicateSet.has(edge.p)) continue
    const p = stringValue(edge.p)
    outAdjacency.get(edge.source).push({ edge, p, other: edge.target })
    inAdjacency.get(edge.target).push({ edge, p, other: edge.source })
  }

  function byPredicateThenNode(a, b) {
    return compareStrings(a.p, b.p) || compareStrings(a.other, b.other)
  }
  for (const list of outAdjacency.values()) list.sort(byPredicateThenNode)
  for (const list of inAdjacency.values()) list.sort(byPredicateThenNode)

  function candidatesFor(currentId) {
    if (direction === 'out') return outAdjacency.get(currentId) || []
    if (direction === 'in') return inAdjacency.get(currentId) || []
    const outgoing = outAdjacency.get(currentId) || []
    const incoming = inAdjacency.get(currentId) || []
    if (outgoing.length === 0) return incoming
    if (incoming.length === 0) return outgoing
    const merged = outgoing.concat(incoming)
    merged.sort(byPredicateThenNode)
    const seen = new Set()
    const unique = []
    for (const candidate of merged) {
      const key = edgeIdentity(candidate.edge)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(candidate)
    }
    return unique
  }

  function runBfs(perHopLimit, edgeLimit) {
    const included = new Set([startId])
    const nodeOrder = [startId]
    const includedEdges = []
    const seenEdgeKeys = new Set()
    let frontier = [startId]
    let hops = 0
    let truncated = false
    let stopReason = null

    for (let hop = 1; hop <= depth && stopReason === null; hop += 1) {
      const nextFrontier = []
      let addedInHop = 0
      outer: for (const current of frontier) {
        const candidates = candidatesFor(current)
        for (const candidate of candidates) {
          const key = edgeIdentity(candidate.edge)
          const neighborId = candidate.other
          if (included.has(neighborId)) {
            if (seenEdgeKeys.has(key)) continue
            if (includedEdges.length >= edgeLimit) {
              truncated = true
              stopReason = 'max-edges'
              break outer
            }
            seenEdgeKeys.add(key)
            includedEdges.push(candidate.edge)
            continue
          }
          if (addedInHop >= perHopLimit) {
            truncated = true
            stopReason = 'per-hop-nodes'
            break outer
          }
          if (includedEdges.length >= edgeLimit) {
            truncated = true
            stopReason = 'max-edges'
            break outer
          }
          included.add(neighborId)
          nodeOrder.push(neighborId)
          nextFrontier.push(neighborId)
          addedInHop += 1
          seenEdgeKeys.add(key)
          includedEdges.push(candidate.edge)
        }
      }
      if (stopReason !== null) {
        hops = hop
        break
      }
      if (nextFrontier.length === 0) {
        hops = hop - 1
        break
      }
      hops = hop
      frontier = nextFrontier
    }

    return { nodeOrder, edges: includedEdges, hops, truncated, stopReason }
  }

  const budgeted = runBfs(perHopNodes, maxEdges)
  // Only pay for the unbudgeted reference run when a budget actually cut the
  // expansion; it supplies the "已展开 X / 共 Y" totals without changing the
  // deterministic budgeted result.
  const unbudgeted = budgeted.truncated ? runBfs(Infinity, Infinity) : budgeted

  const nodes = budgeted.nodeOrder.map((id) => nodeById.get(id))
  stats.nodes = nodes.length
  stats.edges = budgeted.edges.length
  stats.hops = budgeted.hops

  const truncation = {
    nodes: budgetRecord(unbudgeted.nodeOrder.length, nodes.length, budgeted.stopReason),
    edges: budgetRecord(unbudgeted.edges.length, budgeted.edges.length, budgeted.stopReason),
  }

  const nextCursor = budgeted.truncated ? { extension: extension + 1 } : null
  const reachedDepthLimit = depth >= 5 && budgeted.hops >= 5
  return {
    nodes,
    edges: budgeted.edges,
    nodeIds: budgeted.nodeOrder,
    stats,
    truncation,
    truncated: budgeted.truncated || depthCapped,
    nextCursor,
    nextBudget: nextCursor,
    depthCapped,
    reachedDepthLimit,
  }
}

// ---------------------------------------------------------------------------
// Detail connection groups (design §6 / spec "详情连接分组")
// ---------------------------------------------------------------------------

/**
 * Group a node's outgoing/incoming edges by predicate for the detail panel.
 * Read-only, deterministic, computed on demand from the retained full graph
 * (never from the draw-budget projection).
 *
 * Group order: `rdf:type` first, then group edge count descending, then
 * predicate IRI lexicographic. Items within a group are ordered by neighbour
 * node id. Each group keeps at most `maxPerGroup` items (default 10) and
 * reports `hidden` = count - items.length so the panel can offer "show more"
 * by re-calling with a larger `maxPerGroup`.
 *
 * @param {any} graph
 * @param {string} nodeId
 * @param {{maxPerGroup?: number}} [options]
 * @returns {{out: any[], in: any[], summary: {outEdges: number, inEdges: number, degree: number}}}
 */
export function connectionGroups(graph, nodeId, options) {
  const input = isObject(graph) ? graph : {}
  const opts = isObject(options) ? options : {}
  const allNodes = Array.isArray(input.nodes) ? input.nodes : []
  const allEdges = Array.isArray(input.edges) ? input.edges : []
  const maxPerGroup = positiveInteger(opts.maxPerGroup, 10)
  const nodeById = new Map()
  for (const node of allNodes) {
    if (isObject(node) && typeof node.id === 'string' && !nodeById.has(node.id)) nodeById.set(node.id, node)
  }

  if (typeof nodeId !== 'string' || !nodeById.has(nodeId)) {
    return { out: [], in: [], summary: { outEdges: 0, inEdges: 0, degree: 0 } }
  }

  const outGroups = new Map()
  const inGroups = new Map()

  function addEdge(groupMap, predicate, neighborId, edge) {
    let group = groupMap.get(predicate)
    if (group === undefined) {
      group = {
        predicate,
        label: stringValue(edge.label) || localName(predicate) || predicate,
        count: 0,
        neighbors: new Map(),
      }
      groupMap.set(predicate, group)
    }
    group.count += 1
    if (group.neighbors.has(neighborId)) return
    const neighbor = nodeById.get(neighborId)
    group.neighbors.set(neighborId, {
      id: neighborId,
      label: stringValue(neighbor && neighbor.label) || localName(neighborId) || neighborId,
      kind: neighbor && typeof neighbor.kind === 'string' ? neighbor.kind : 'external',
    })
  }

  let outEdges = 0
  let inEdges = 0
  for (const edge of allEdges) {
    if (!isObject(edge)) continue
    const predicate = typeof edge.p === 'string' ? edge.p : ''
    if (edge.source === nodeId) {
      outEdges += 1
      addEdge(outGroups, predicate, edge.target, edge)
    }
    if (edge.target === nodeId) {
      inEdges += 1
      addEdge(inGroups, predicate, edge.source, edge)
    }
  }

  function finalize(groupMap) {
    const groups = []
    for (const group of groupMap.values()) {
      const items = Array.from(group.neighbors.values())
        .sort((a, b) => compareStrings(a.id, b.id))
      const keptItems = items.slice(0, maxPerGroup)
      groups.push({
        predicate: group.predicate,
        label: group.label,
        count: group.count,
        items: keptItems,
        hidden: Math.max(0, group.count - keptItems.length),
      })
    }
    groups.sort((a, b) => {
      const aType = a.predicate === RDF_TYPE ? 0 : 1
      const bType = b.predicate === RDF_TYPE ? 0 : 1
      if (aType !== bType) return aType - bType
      if (a.count !== b.count) return b.count - a.count
      return compareStrings(a.predicate, b.predicate)
    })
    return groups
  }

  return {
    out: finalize(outGroups),
    in: finalize(inGroups),
    summary: { outEdges, inEdges, degree: outEdges + inEdges },
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function positiveInteger(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.floor(value)
  return integer > 0 ? integer : fallback
}

/** Positive integer or 0 meaning "budget disabled". */
function optionalPositiveInteger(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const integer = Math.floor(value)
  return integer > 0 ? integer : 0
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

const layoutNow = typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
  ? function now() { return performance.now() }
  : function now() { return Date.now() }

/**
 * Prepare the deterministic layout state shared by `layoutGraph` and
 * `createLayoutTask`: split connected components, seed them on a grid of
 * cells, and allocate all force-pass buffers. Only seeding consumes the seeded
 * PRNG, so stepping the force pass later cannot change the result.
 *
 * @param {any} graph
 * @param {any} options
 * @returns {any} layout state
 */
function prepareLayout(graph, options) {
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
  if (count === 0) {
    return { empty: true, single: false, count: 0, ids, width, height, iterations: 0, seed, padding }
  }
  if (count === 1) {
    return { empty: false, single: true, count: 1, ids, width, height, iterations: 0, seed, padding }
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

  const exactRepulsion = count <= 420
  const sampleCount = Math.min(count - 1, 28)

  return {
    empty: false,
    single: false,
    count,
    ids,
    width,
    height,
    iterations,
    seed,
    padding,
    usableEdges,
    componentOf,
    centerX,
    centerY,
    xs,
    ys,
    exactRepulsion,
    sampleCount,
    repulsionScale: exactRepulsion ? 1 : (count - 1) / sampleCount,
    edgeStride: usableEdges.length > 30000 ? Math.ceil(usableEdges.length / 30000) : 1,
    dispX: new Float64Array(count),
    dispY: new Float64Array(count),
    startTemperature: ideal * 0.9,
    ideal,
  }
}

/**
 * Run the Fruchterman-Reingold style force pass for iterations [from, to).
 * The body is the single source of truth shared by the one-shot layout and the
 * stepped layout task, which is what makes them mathematically identical.
 */
function runLayoutIterations(state, from, to) {
  const count = state.count
  const xs = state.xs
  const ys = state.ys
  const usableEdges = state.usableEdges
  const edgeStride = state.edgeStride
  const ideal = state.ideal
  const componentOf = state.componentOf
  const centerX = state.centerX
  const centerY = state.centerY
  const dispX = state.dispX
  const dispY = state.dispY
  const exactRepulsion = state.exactRepulsion
  const sampleCount = state.sampleCount
  const repulsionScale = state.repulsionScale
  const startTemperature = state.startTemperature
  const seed = state.seed
  const iterations = state.iterations

  for (let iteration = from; iteration < to; iteration += 1) {
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
}

/** Scale and centre the solved coordinates into the padded box. */
function finalizeLayout(state) {
  const count = state.count
  const xs = state.xs
  const ys = state.ys
  const ids = state.ids
  const width = state.width
  const height = state.height
  const padding = state.padding

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

function singlePoint(state) {
  return [{ id: state.ids[0], x: state.width / 2, y: state.height / 2, vx: 0, vy: 0 }]
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
  const state = prepareLayout(graph, options)
  if (state.empty) return []
  if (state.single) return singlePoint(state)
  runLayoutIterations(state, 0, state.iterations)
  return finalizeLayout(state)
}

/**
 * Chunked, cancellable layout task used when layout must not block the main
 * thread (design §3.4). It shares `prepareLayout` / `runLayoutIterations` /
 * `finalizeLayout` with `layoutGraph`, so running it to completion yields
 * mathematically identical positions (same seed, iteration order and sampling
 * decisions; a Node test asserts deep equality).
 *
 * @param {any} graph
 * @param {{width?: number, height?: number, iterations?: number, seed?: number, padding?: number}} [options]
 * @returns {{step: (maxMillis?: number) => {done: boolean, progress: number, canceled?: boolean},
 *            result: () => any[]|null, cancel: () => void}}
 */
export function createLayoutTask(graph, options) {
  const state = prepareLayout(graph, options)
  let next = 0
  let done = state.empty || state.single || state.iterations === 0
  let positions = null
  if (state.empty) positions = []
  else if (state.single) positions = singlePoint(state)
  else if (done) positions = finalizeLayout(state)
  let progress = done ? 1 : 0
  let canceled = false

  function step(maxMillis) {
    if (canceled) return { done: true, progress: 1, canceled: true }
    if (done) return { done: true, progress: 1 }
    const budget = typeof maxMillis === 'number' && Number.isFinite(maxMillis) ? maxMillis : 8
    const started = layoutNow()
    while (next < state.iterations) {
      runLayoutIterations(state, next, next + 1)
      next += 1
      if (budget <= 0) break
      if (layoutNow() - started >= budget) break
    }
    progress = Math.min(1, next / state.iterations)
    if (next >= state.iterations) {
      positions = finalizeLayout(state)
      done = true
      progress = 1
      return { done: true, progress }
    }
    return { done: false, progress }
  }

  function result() {
    return positions
  }

  function cancel() {
    canceled = true
    done = true
    progress = 1
    positions = null
  }

  return { step, result, cancel }
}
