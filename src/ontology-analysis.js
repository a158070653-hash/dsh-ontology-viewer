/** Versioned, read-only analysis contracts over accepted L0 workspace snapshots. */
export const ONTOLOGY_ANALYSIS_SCHEMA_VERSION = 1
let ontologyAnalysisIdentity = null
export function setOntologyAnalysisIdentity(identity) {
  ontologyAnalysisIdentity = identity && typeof identity.entityKeyForTerm === 'function' ? identity : null
}
export const ONTOLOGY_ANALYSIS_RULES = Object.freeze({
  'rdf-list-missing-link': Object.freeze({ category: 'structural', severity: 'error' }),
  'rdf-list-multiple-link': Object.freeze({ category: 'structural', severity: 'error' }),
  'rdf-list-invalid-rest': Object.freeze({ category: 'structural', severity: 'error' }),
  'rdf-list-cycle': Object.freeze({ category: 'suggestion', severity: 'warning' }),
  'rdf-list-graph-ambiguous': Object.freeze({ category: 'unverifiable', severity: 'warning' }),
  'property-kind-conflict': Object.freeze({ category: 'suggestion', severity: 'warning' }),
  'label-conflict': Object.freeze({ category: 'suggestion', severity: 'warning' }),
})

function analysisArray(value) {
  return Array.isArray(value) ? value : []
}

function analysisText(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function analysisEntityKey(value, sourceId) {
  const part = (text) => text.length + ':' + text
  if (ontologyAnalysisIdentity) return ontologyAnalysisIdentity.entityKeyForTerm(value, sourceId)
  if (value.startsWith('_:')) return '_:\u0000blank\u0000' + part(sourceId) + part(value)
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return value
  return '\u0000relative\u0000' + part(sourceId) + part(value)
}

function analysisRows(index, subject) {
  if (!index || !index.bySubject) return []
  if (index.bySubject.has(subject)) return index.bySubject.get(subject)
  const ids = index.rawSubjects && index.rawSubjects.get(subject)
  return ids && ids.size === 1 ? index.bySubject.get([...ids][0]) || [] : []
}

function analysisGraphKey(row) {
  const graph = row.graph || { kind: 'unknown' }
  return JSON.stringify([graph.kind, graph.value || '',
    graph.kind === 'blank' || graph.kind === 'unknown' ? row.sourceId : ''])
}

function analysisGraphAmbiguous(rows) {
  return rows.some((row) => !row.graph || row.graph.kind === 'unknown') ||
    new Set(rows.map(analysisGraphKey)).size > 1
}

function analysisTermKey(row) {
  const literal = row.oKind === 'literal'
  const descriptor = row.literalIdentity
  const unknown = literal && (descriptor && descriptor.reliability === 'unknown' ||
    row.literalTruncated && !(descriptor && descriptor.reliability === 'reliable'))
  return JSON.stringify([row.s, row.p, row.oKind,
    unknown ? ['unknown', row.sourceId, row.revision, row.statementId] :
      descriptor && typeof descriptor.lexical === 'string' ? descriptor.lexical : row.o,
    row.dt || '', row.lang || '', analysisGraphKey(row)])
}

function analysisDistinctRows(rows) {
  const result = new Map()
  for (const row of rows) if (!result.has(analysisTermKey(row))) result.set(analysisTermKey(row), row)
  return [...result.values()]
}

function analysisEvidenceId(sourceId, ordinal) {
  const index = String(ordinal)
  return '\u0000statement\u0000' + sourceId.length + ':' + sourceId + index.length + ':' + index
}

function analysisSourceState(source) {
  const parsed = source && source.parsed && typeof source.parsed === 'object' ? source.parsed : {}
  const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {}
  const diagnostics = analysisArray(parsed.diagnostics).concat(analysisArray(parsed.errors).map((error) => ({ code: 'parse-error', error })))
  const identityUnknown = analysisArray(parsed.triples).some((triple) =>
    triple && triple.literalTruncated &&
    (!triple.literalIdentity || triple.literalIdentity.reliability !== 'reliable'))
  return {
    sourceId: analysisText(source && source.sourceId, ''),
    revision: Number.isSafeInteger(source && source.revision) ? source.revision : 0,
    status: analysisText(source && source.status, 'unknown'),
    stale: !!(source && source.stale),
    format: analysisText(source && source.format, analysisText(parsed.format, '')),
    tripleCount: analysisArray(parsed.triples).length,
    truncated: !!stats.truncated,
    truncation: stats.truncation && typeof stats.truncation === 'object' ? stats.truncation : null,
    errorCount: analysisArray(parsed.errors).length,
    warningCount: analysisArray(parsed.warnings).length,
    diagnosticsTruncated: diagnostics.some((entry) => entry && entry.code === 'diagnostics-truncated'),
    diagnostics: diagnostics.map((entry) => ({ ...entry, sample: analysisArray(entry.sample).slice(0, 3) })),
    errors: analysisArray(parsed.errors).slice(0, 200).map((error) => ({ code: 'parse-error', error })),
    parserDiagnosticsTotal: diagnostics.length + analysisArray(parsed.errors).length,
    displayName: analysisText(source && source.displayName, ''),
    identityUnknown,
  }
}

/**
 * Copy the selected, already accepted parser statements into a deterministic
 * bounded analysis snapshot. This function never reads or reconstructs L1.
 */
export function createOntologyAnalysisSnapshot(workspace, options) {
  const state = workspace && typeof workspace === 'object' ? workspace : {}
  const opts = options && typeof options === 'object' ? options : {}
  const allSources = analysisArray(state.sources)
  const selected = Array.isArray(opts.sourceIds) && opts.sourceIds.length > 0
    ? new Set(opts.sourceIds.filter((id) => typeof id === 'string'))
    : null
  const sources = allSources.filter((source) => !selected || selected.has(source && source.sourceId))
  const sourceStates = sources.map(analysisSourceState)
  const statements = []
  let acceptedOccurrences = 0
  for (const source of sources) {
    const sourceId = analysisText(source && source.sourceId, '')
    const revision = Number.isSafeInteger(source && source.revision) ? source.revision : 0
    const parsed = source && source.parsed && typeof source.parsed === 'object' ? source.parsed : {}
    const triples = analysisArray(parsed.triples)
    for (let ordinal = 0; ordinal < triples.length; ordinal += 1) {
      const triple = triples[ordinal]
      if (!triple || typeof triple.s !== 'string' || typeof triple.p !== 'string' ||
        triple.o === null || triple.o === undefined) continue
      const statementId = analysisEvidenceId(sourceId, ordinal)
      const graph = triple.graph && typeof triple.graph === 'object'
        ? { kind: analysisText(triple.graph.kind, 'unknown'), value: analysisText(triple.graph.value, null) }
        : { kind: 'unknown', value: null }
      const literalIdentity = triple.literalIdentity && typeof triple.literalIdentity === 'object'
        ? {
          version: Number.isSafeInteger(triple.literalIdentity.version) ? triple.literalIdentity.version : 0,
          reliability: triple.literalIdentity.reliability === 'reliable' ? 'reliable' : 'unknown',
          reason: analysisText(triple.literalIdentity.reason, null),
        }
        : (triple.literalTruncated ? { version: 0, reliability: 'unknown', reason: 'missing-identity' } : null)
      if (literalIdentity && literalIdentity.reliability === 'reliable') {
        literalIdentity.lexical = triple.literalIdentity.lexical
      }
      statements.push({
        statementId,
        sourceId,
        revision,
        raw: { s: triple.s, p: triple.p, o: String(triple.o) },
        s: analysisEntityKey(triple.s, sourceId),
        p: analysisEntityKey(triple.p, sourceId),
        o: triple.oKind === 'literal' ? String(triple.o) : analysisEntityKey(String(triple.o), sourceId),
        oKind: triple.oKind === 'literal' || triple.oKind === 'blank' ? triple.oKind : 'iri',
        dt: typeof triple.dt === 'string' ? triple.dt : null,
        lang: typeof triple.lang === 'string' ? triple.lang : null,
        graph,
        literalTruncated: !!triple.literalTruncated,
        literalOriginalLength: Number.isSafeInteger(triple.literalOriginalLength)
          ? triple.literalOriginalLength : null,
        literalIdentity,
        location: null,
      })
      acceptedOccurrences += 1
    }
  }

  const sourceIncomplete = sourceStates.some((source) =>
    source.stale || source.truncated || source.diagnosticsTruncated || source.errorCount > 0 ||
    ['partial', 'error', 'rejected', 'unknown'].includes(source.status))
  const identityUnknown = sourceStates.some((source) => source.identityUnknown) ||
    statements.some((statement) => statement.literalIdentity && statement.literalIdentity.reliability === 'unknown')
  const completeness = {
    status: sourceIncomplete || identityUnknown ? 'partial' : 'complete',
    selectedSourceCount: sources.length,
    acceptedOccurrenceCount: acceptedOccurrences,
    rejectedOrAbsentSelection: selected ? [...selected].filter((id) => !sources.some((source) => source.sourceId === id)) : [],
    sourceIncomplete,
    parseTruncated: sourceStates.some((source) => source.truncated),
    staleSources: sourceStates.filter((source) => source.stale).map((source) => source.sourceId),
    errorSources: sourceStates.filter((source) => source.errorCount > 0 || source.status === 'error')
      .map((source) => source.sourceId),
    literalIdentityUnknown: identityUnknown,
    locationsAvailable: false,
  }

  return {
    schemaVersion: ONTOLOGY_ANALYSIS_SCHEMA_VERSION,
    snapshotId: JSON.stringify([
      Number.isSafeInteger(state.revision) ? state.revision : 0,
      sourceStates.map((source) => [source.sourceId, source.revision]),
    ]),
    scope: {
      layer: 'L0',
      sourceIds: sourceStates.map((source) => source.sourceId),
      workspaceRevision: Number.isSafeInteger(state.revision) ? state.revision : 0,
    },
    sources: sourceStates,
    statements,
    counts: { acceptedOccurrences, reliableStatements: null },
    completeness,
  }
}

function analysisNamespace(iri) {
  if (typeof iri !== 'string' || !iri || iri.startsWith('_:') || iri[0] === '\u0000') return ''
  const hash = iri.lastIndexOf('#')
  const slash = iri.lastIndexOf('/')
  const colon = iri.lastIndexOf(':')
  const split = Math.max(hash, slash, colon)
  return split >= 0 ? iri.slice(0, split + 1) : ''
}

/** Build deterministic L0 lookup indexes and scope counts without graph data. */
export function inspectOntologyRdfList(index, head, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const maxCells = Number.isSafeInteger(settings.maxCells) && settings.maxCells > 0
    ? Math.min(settings.maxCells, 10000) : 2048
  const maxDepth = Number.isSafeInteger(settings.maxDepth) && settings.maxDepth > 0
    ? Math.min(settings.maxDepth, 256) : 128
  const maxEvidence = Number.isSafeInteger(settings.maxEvidence) && settings.maxEvidence > 0
    ? Math.min(settings.maxEvidence, 20000) : 4096
  const graphKey = settings.graphKey || null
  const rowsFor = (predicate, subject) =>
    analysisRows(index, subject).filter((row) => row.p === predicate && (!graphKey || analysisGraphKey(row) === graphKey))
  const diagnostics = []
  const members = []
  const evidence = []
  const visited = new Set()
  const first = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
  const rest = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
  const nil = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
  const cacheKey = JSON.stringify([head, graphKey, maxCells, maxDepth, maxEvidence])
  if (index.listCache && index.listCache.has(cacheKey)) return index.listCache.get(cacheKey)
  let cell = head
  let status = 'complete'
  let steps = 0
  if (cell === nil) return { head, status, members, evidence, diagnostics, steps }
  while (cell !== nil) {
    if (steps >= maxCells || steps >= maxDepth || index.listSteps >= index.maxListSteps) {
      status = 'incomplete'
      diagnostics.push({ ruleId: 'rdf-list-budget-exceeded', category: 'unverifiable', severity: 'warning' })
      break
    }
    if (visited.has(cell)) {
      status = 'invalid'
      diagnostics.push({ ruleId: 'rdf-list-cycle', category: 'structural', severity: 'error', cell })
      break
    }
    visited.add(cell)
    steps += 1
    index.listSteps = (index.listSteps || 0) + 1
    const cellRows = analysisRows(index, cell)
    if (!graphKey && analysisGraphAmbiguous(cellRows)) {
      status = 'incomplete'
      for (const row of cellRows.slice(0, Math.max(0, maxEvidence - evidence.length))) evidence.push(analysisEvidence(row)[0])
      diagnostics.push({ ruleId: 'rdf-list-graph-ambiguous', category: 'unverifiable', severity: 'warning', cell })
      break
    }
    const firstOccurrences = rowsFor(first, cell)
    const restOccurrences = rowsFor(rest, cell)
    const occurrences = firstOccurrences.concat(restOccurrences)
    if (occurrences.length > maxEvidence - evidence.length) {
      for (const row of occurrences.slice(0, Math.max(0, maxEvidence - evidence.length))) evidence.push(analysisEvidence(row)[0])
      status = 'incomplete'
      diagnostics.push({ ruleId: 'rdf-list-budget-exceeded', category: 'unverifiable', severity: 'warning', cell, reason: 'evidence-budget' })
      break
    }
    for (const row of occurrences) evidence.push(analysisEvidence(row)[0])
    const firstRows = analysisDistinctRows(firstOccurrences)
    const restRows = analysisDistinctRows(restOccurrences)
    if (firstRows.length !== 1 || restRows.length !== 1) {
      status = 'invalid'
      diagnostics.push({
        ruleId: firstRows.length > 1 || restRows.length > 1 ? 'rdf-list-multiple-link' : 'rdf-list-missing-link',
        category: 'structural', severity: 'error', cell,
        firstCount: firstRows.length, restCount: restRows.length,
      })
      break
    }
    const firstRow = firstRows[0]
    const restRow = restRows[0]
    if (firstRow.literalTruncated || firstRow.literalIdentity && firstRow.literalIdentity.reliability === 'unknown') {
      status = 'incomplete'
      diagnostics.push({ ruleId: 'rdf-list-member-incomplete', category: 'unverifiable', severity: 'warning', cell })
      break
    }
    members.push({ value: firstRow.o, kind: firstRow.oKind, dt: firstRow.dt, lang: firstRow.lang })
    if (!['iri', 'blank'].includes(restRow.oKind) || typeof restRow.o !== 'string') {
      status = 'invalid'
      diagnostics.push({ ruleId: 'rdf-list-invalid-rest', category: 'structural', severity: 'error', cell })
      break
    }
    cell = restRow.o
  }
  if (status === 'invalid' && index.snapshot && index.snapshot.completeness.status !== 'complete') {
    status = 'incomplete'
    for (const diagnostic of diagnostics) { diagnostic.category = 'unverifiable'; diagnostic.severity = 'warning' }
  }
  const result = { head, status, members: status === 'complete' ? members : [], evidence: uniqueAnalysisEvidence(evidence), diagnostics, steps }
  if (index.listCache && index.listCache.size < 256) index.listCache.set(cacheKey, result)
  return result
}

function analysisEvidence(statement) {
  return [{ sourceId: statement.sourceId, revision: statement.revision, statementId: statement.statementId,
    s: statement.s, p: statement.p, o: statement.o, raw: statement.raw || null,
    oKind: statement.oKind, dt: statement.dt || null, lang: statement.lang || null,
    graph: statement.graph || { kind: 'unknown' }, literalTruncated: !!statement.literalTruncated,
    literalOriginalLength: statement.literalOriginalLength || null,
    literalIdentity: statement.literalIdentity || null, location: null }]
}

const ONTOLOGY_ANALYSIS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const ONTOLOGY_ANALYSIS_RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const ONTOLOGY_ANALYSIS_OWL = 'http://www.w3.org/2002/07/owl#'
const ONTOLOGY_ANALYSIS_XSD = 'http://www.w3.org/2001/XMLSchema#'

function analysisValueKind(statement) {
  if (statement.oKind !== 'literal') return statement.oKind
  return 'literal'
}

function analysisRestrictionCompleteness(index, nodeId, evidence, extraStatus) {
  const snapshot = index && index.snapshot
  const unknownIdentity = evidence.some((item) => item.oKind === 'literal' &&
    (item.literalTruncated || (item.literalIdentity && item.literalIdentity.reliability !== 'reliable')))
  if (extraStatus === 'invalid') return 'invalid'
  if (extraStatus === 'incomplete' || unknownIdentity) return 'incomplete'
  if (!snapshot || !snapshot.completeness || snapshot.completeness.status !== 'complete') return 'partial'
  return 'complete'
}

/** Decode one explicit OWL restriction without inference or instance validation. */
export function explainOntologyRestriction(index, nodeId) {
  const rows = analysisRows(index, nodeId)
  if (analysisGraphAmbiguous(rows)) return createOntologyAnalysisResult(index.snapshot, {
    status: 'incomplete', data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incomplete', reason: 'graph-scope-ambiguous' }, evidence: rows })
  const typeRows = rows.filter((row) => row.p === ONTOLOGY_ANALYSIS_RDF + 'type' && row.o === ONTOLOGY_ANALYSIS_OWL + 'Restriction')
  if (!typeRows.length) return createOntologyAnalysisResult(index && index.snapshot, {
    status: 'unavailable', data: { kind: 'restriction', nodeId, explanationKey: 'analysis.notRestriction' }, evidence: [],
  })

  const predicates = {
    onProperty: ONTOLOGY_ANALYSIS_OWL + 'onProperty',
    someValuesFrom: ONTOLOGY_ANALYSIS_OWL + 'someValuesFrom',
    allValuesFrom: ONTOLOGY_ANALYSIS_OWL + 'allValuesFrom',
    hasValue: ONTOLOGY_ANALYSIS_OWL + 'hasValue',
    cardinality: ONTOLOGY_ANALYSIS_OWL + 'cardinality',
    minCardinality: ONTOLOGY_ANALYSIS_OWL + 'minCardinality',
    maxCardinality: ONTOLOGY_ANALYSIS_OWL + 'maxCardinality',
    qualifiedCardinality: ONTOLOGY_ANALYSIS_OWL + 'qualifiedCardinality',
    minQualifiedCardinality: ONTOLOGY_ANALYSIS_OWL + 'minQualifiedCardinality',
    maxQualifiedCardinality: ONTOLOGY_ANALYSIS_OWL + 'maxQualifiedCardinality',
    onClass: ONTOLOGY_ANALYSIS_OWL + 'onClass',
    onDataRange: ONTOLOGY_ANALYSIS_OWL + 'onDataRange',
  }
  const allEvidence = rows.slice()
  const find = (predicate) => analysisDistinctRows(rows.filter((row) => row.p === predicate))
  const propertyRows = find(predicates.onProperty)
  const restrictionRows = Object.entries(predicates)
    .filter(([name]) => !['onProperty', 'onClass', 'onDataRange'].includes(name))
    .flatMap(([name, predicate]) => find(predicate).map((row) => ({ name, row })))
  const distinctForms = new Set(restrictionRows.map((item) => item.name))
  const hasOperandConflict = propertyRows.length !== 1 || distinctForms.size > 1 ||
    restrictionRows.some((item) => find(item.row.p).length !== 1)
  if (hasOperandConflict || restrictionRows.length !== 1) {
    return createOntologyAnalysisResult(index.snapshot, {
      status: analysisRestrictionCompleteness(index, nodeId, allEvidence, 'incomplete'),
      data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incomplete', explanationValues: {} },
      evidence: allEvidence,
    })
  }

  const form = restrictionRows[0]
  const value = form.row
  const property = propertyRows[0]
  if (!['iri', 'blank'].includes(property.oKind) ||
    (['someValuesFrom', 'allValuesFrom'].includes(form.name) && value.oKind === 'literal')) {
    return createOntologyAnalysisResult(index.snapshot, {
      status: 'incomplete',
      data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incomplete', explanationValues: {} },
      evidence: allEvidence,
    })
  }
  if (form.name === 'hasValue' && value.oKind !== 'iri' && value.oKind !== 'blank' && value.oKind !== 'literal') {
    return createOntologyAnalysisResult(index.snapshot, {
      status: 'incomplete',
      data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incomplete', explanationValues: {} },
      evidence: allEvidence,
    })
  }
  let explanationKey = 'analysis.restriction.' + form.name
  const explanationValues = {
    property: propertyRows[0].o,
    value: value.o,
    valueKind: analysisValueKind(value),
    datatype: value.dt || null,
    language: value.lang || null,
  }
  if (/cardinality$/i.test(form.name)) {
    const isInteger = value.oKind === 'literal' && !value.literalTruncated &&
      value.dt === ONTOLOGY_ANALYSIS_XSD + 'nonNegativeInteger' && /^\+?\d+$/.test(value.o)
    if (!isInteger || value.literalIdentity && value.literalIdentity.reliability !== 'reliable') {
      return createOntologyAnalysisResult(index.snapshot, {
        status: 'incomplete',
        data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incompleteCardinality', explanationValues },
        evidence: allEvidence,
      })
    }
    explanationValues.cardinality = Number(value.o)
    if (!Number.isSafeInteger(explanationValues.cardinality)) {
      return createOntologyAnalysisResult(index.snapshot, {
        status: 'incomplete',
        data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incompleteCardinality', explanationValues },
        evidence: allEvidence,
      })
    }
    if (/qualified/i.test(form.name)) {
      const qualifiers = find(predicates.onClass).concat(find(predicates.onDataRange))
      const qualifier = qualifiers[0]
      if (qualifiers.length !== 1 || qualifier.oKind === 'literal') {
        return createOntologyAnalysisResult(index.snapshot, {
          status: 'incomplete',
          data: { kind: 'restriction', nodeId, explanationKey: 'analysis.restriction.incomplete', explanationValues },
          evidence: allEvidence,
        })
      }
      explanationValues.qualifier = qualifier.o
      allEvidence.push(qualifier)
    }
  }
  const evidence = allEvidence.map(analysisEvidence).flat()
  const status = analysisRestrictionCompleteness(index, nodeId, allEvidence)
  return createOntologyAnalysisResult(index.snapshot, {
    status,
    data: {
      kind: 'restriction', nodeId, form: form.name,
      explanationKey: status === 'complete' ? explanationKey : 'analysis.restriction.incomplete',
      explanationValues,
      asserted: true,
      openWorld: true,
      instanceValidation: 'not-performed',
      inferred: false,
    },
    evidence,
  })
}

/** Explain one explicit boolean class expression; list operands must be complete. */
export function explainOntologyClassExpression(index, subjectId, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const source = index && index.snapshot
  const rows = analysisRows(index, subjectId)
  if (analysisGraphAmbiguous(rows)) return createOntologyAnalysisResult(source, {
    status: 'incomplete', data: { kind: 'class-expression', subjectId, explanationKey: 'analysis.expression.incomplete', reason: 'graph-scope-ambiguous' }, evidence: rows })
  const listPredicates = {
    intersectionOf: ONTOLOGY_ANALYSIS_OWL + 'intersectionOf',
    unionOf: ONTOLOGY_ANALYSIS_OWL + 'unionOf',
    oneOf: ONTOLOGY_ANALYSIS_OWL + 'oneOf',
  }
  const directPredicates = {
    equivalentClass: ONTOLOGY_ANALYSIS_OWL + 'equivalentClass',
    disjointWith: ONTOLOGY_ANALYSIS_OWL + 'disjointWith',
  }
  const listRows = Object.entries(listPredicates).flatMap(([form, predicate]) => {
    const groups = new Map()
    for (const row of rows.filter((item) => item.p === predicate)) {
      const key = analysisTermKey(row)
      if (!groups.has(key)) groups.set(key, { form, row, occurrences: [] })
      groups.get(key).occurrences.push(row)
    }
    return [...groups.values()]
  })
  const directRows = Object.entries(directPredicates).flatMap(([form, predicate]) =>
    rows.filter((row) => row.p === predicate).map((row) => ({ form, row })))
  if (!listRows.length && !directRows.length) {
    return createOntologyAnalysisResult(source, {
      status: 'unavailable', data: { kind: 'class-expression', subjectId, explanationKey: 'analysis.expression.notFound' }, evidence: [],
    })
  }
  const directResults = directRows.map((item) => {
    const complete = source && source.completeness && source.completeness.status === 'complete'
    return createOntologyAnalysisResult(source, {
      status: complete ? 'complete' : 'partial',
      data: {
        kind: 'class-expression', form: item.form, subjectId,
        explanationKey: complete ? 'analysis.expression.' + item.form : 'analysis.expression.incomplete',
        explanationValues: { subject: subjectId, object: item.row.o, objectKind: item.row.oKind },
        asserted: true, inferred: false,
      },
      evidence: [analysisEvidence(item.row)[0]],
    })
  })
  const listResults = listRows.map((item) => {
    const list = inspectOntologyRdfList(index, item.row.o, { ...opts.listLimits, graphKey: analysisGraphKey(item.row) })
    const status = list.status === 'complete'
      ? (source && source.completeness && source.completeness.status === 'complete' ? 'complete' : 'partial')
      : list.status === 'invalid' ? 'invalid' : 'incomplete'
    return createOntologyAnalysisResult(source, {
      status,
      data: {
        kind: 'class-expression', form: item.form, subjectId,
        explanationKey: status === 'complete' ? 'analysis.expression.' + item.form : 'analysis.expression.incomplete',
        explanationValues: { subject: subjectId, operands: list.members },
        asserted: true, inferred: false, listStatus: list.status,
        diagnostics: list.diagnostics,
      },
      evidence: uniqueAnalysisEvidence([
        ...item.occurrences.map((row) => analysisEvidence(row)[0]), ...list.evidence,
      ]),
    })
  })
  const explanations = directResults.concat(listResults)
  if (explanations.length === 1) return explanations[0]
  const status = explanations.some((item) => ['incomplete', 'invalid', 'unavailable'].includes(item.status))
    ? 'incomplete'
    : explanations.some((item) => item.status === 'partial') ? 'partial' : 'complete'
  return createOntologyAnalysisResult(source, {
    status,
    data: {
      kind: 'class-expression', subjectId,
      explanationKey: status === 'complete' ? 'analysis.expression.multiple' : 'analysis.expression.incomplete',
      explanations,
      asserted: true, inferred: false,
    },
    evidence: uniqueAnalysisEvidence(explanations.flatMap((item) => item.evidence)),
  })
}

/** Describe explicit property axioms and characteristics, without entailment. */
export function createOntologyOverview(index, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const snapshot = index && index.snapshot
  const statements = analysisArray(snapshot && snapshot.statements)
  const limit = Number.isSafeInteger(settings.maxItems) && settings.maxItems > 0
    ? Math.min(settings.maxItems, 500) : 100
  const classes = new Set()
  const properties = new Set()
  const individuals = new Set()
  const namespaces = new Map()
  const relationTypes = new Map()
  const entityDegree = new Map()
  const declaredTypes = new Map()
  const restrictionNodes = new Set()
  const expressionNodes = new Set()
  const explicitParents = new Map()
  const explicitChildren = new Map()
  let literalCount = 0
  let unknownLiteralIdentities = 0
  const addDegree = (entity) => entityDegree.set(entity, (entityDegree.get(entity) || 0) + 1)
  for (const statement of statements) {
    relationTypes.set(statement.p, (relationTypes.get(statement.p) || 0) + 1)
    for (const term of [statement.s, statement.p, statement.oKind === 'literal' ? '' : statement.o]) {
      const namespace = analysisNamespace(term)
      if (namespace) namespaces.set(namespace, (namespaces.get(namespace) || 0) + 1)
    }
    addDegree(statement.s)
    if (statement.oKind !== 'literal') addDegree(statement.o)
    if (statement.oKind === 'literal') {
      literalCount += 1
      if (statement.literalIdentity && statement.literalIdentity.reliability !== 'reliable') unknownLiteralIdentities += 1
    }
    if (statement.p === ONTOLOGY_ANALYSIS_RDF + 'type' && statement.oKind !== 'literal') {
      if (!declaredTypes.has(statement.s)) declaredTypes.set(statement.s, new Set())
      declaredTypes.get(statement.s).add(statement.o)
      if ([ONTOLOGY_ANALYSIS_OWL + 'Class', ONTOLOGY_ANALYSIS_RDFS + 'Class'].includes(statement.o)) classes.add(statement.s)
      if ([ONTOLOGY_ANALYSIS_OWL + 'ObjectProperty', ONTOLOGY_ANALYSIS_OWL + 'DatatypeProperty', ONTOLOGY_ANALYSIS_RDF + 'Property'].includes(statement.o)) properties.add(statement.s)
      if (statement.o === ONTOLOGY_ANALYSIS_OWL + 'Restriction') restrictionNodes.add(statement.s)
      if (statement.o === ONTOLOGY_ANALYSIS_OWL + 'Restriction') expressionNodes.add(statement.s)
    }
    if (statement.p === ONTOLOGY_ANALYSIS_RDFS + 'subClassOf' && statement.oKind !== 'literal') {
      classes.add(statement.s)
      classes.add(statement.o)
      if (!explicitParents.has(statement.s)) explicitParents.set(statement.s, new Set())
      if (!explicitChildren.has(statement.o)) explicitChildren.set(statement.o, new Set())
      explicitParents.get(statement.s).add(statement.o)
      explicitChildren.get(statement.o).add(statement.s)
      classes.add(statement.s)
      classes.add(statement.o)
    }
  }
  const roots = [...classes].filter((id) => !explicitParents.has(id)).sort()
  const isolated = [...classes].filter((id) => !explicitParents.has(id) && !explicitChildren.has(id)).sort()
  const highConnection = [...entityDegree].map(([entityId, degree]) => ({ entityId, degree }))
    .sort((a, b) => b.degree - a.degree || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))
  const propertyMetaTypes = new Set([
    ONTOLOGY_ANALYSIS_OWL + 'ObjectProperty', ONTOLOGY_ANALYSIS_OWL + 'DatatypeProperty',
    ONTOLOGY_ANALYSIS_RDF + 'Property', ONTOLOGY_ANALYSIS_OWL + 'FunctionalProperty',
    ONTOLOGY_ANALYSIS_OWL + 'InverseFunctionalProperty', ONTOLOGY_ANALYSIS_OWL + 'TransitiveProperty',
    ONTOLOGY_ANALYSIS_OWL + 'SymmetricProperty', ONTOLOGY_ANALYSIS_OWL + 'AsymmetricProperty',
    ONTOLOGY_ANALYSIS_OWL + 'ReflexiveProperty', ONTOLOGY_ANALYSIS_OWL + 'IrreflexiveProperty',
  ])
  for (const [entityId, types] of declaredTypes) {
    if (types.has(ONTOLOGY_ANALYSIS_OWL + 'Class') || types.has(ONTOLOGY_ANALYSIS_RDFS + 'Class') ||
      types.has(ONTOLOGY_ANALYSIS_OWL + 'Restriction') ||
      [...types].some((type) => propertyMetaTypes.has(type))) continue
    individuals.add(entityId)
  }
  const sortedCounts = (map, key) => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => ({ [key]: value, count, basis: 'accepted-term-occurrences' }))
  const parseDiagnostics = analysisArray(snapshot && snapshot.sources).flatMap((source) =>
    analysisArray(source.diagnostics).concat(analysisArray(source.errors).map((error) => ({ code: 'parse-error', error })))
      .map((diagnostic) => ({ ...diagnostic, sourceId: source.sourceId })))
  const metric = (value, basis = 'unique-terms') => ({ value, layer: 'L0', basis, complete: snapshot && snapshot.completeness && snapshot.completeness.status === 'complete' })
  return {
    snapshotId: snapshot ? snapshot.snapshotId : '',
    counts: {
      classes: metric(classes.size), properties: metric(properties.size), individuals: metric(individuals.size),
      literalOccurrences: metric(literalCount, 'accepted-occurrences'), acceptedRelationships: metric(statements.length, 'accepted-occurrences'),
      reliableStatementOccurrences: metric(statements.length - unknownLiteralIdentities, 'accepted-occurrences'),
      unknownLiteralIdentityOccurrences: metric(unknownLiteralIdentities, 'accepted-occurrences'),
      restrictionStructures: metric(restrictionNodes.size),
      expressionStructures: metric(expressionNodes.size),
      declaredTypeOccurrences: metric([...declaredTypes.values()].reduce((sum, types) => sum + types.size, 0)),
    },
    namespaces: sortedCounts(namespaces, 'namespace').slice(0, limit),
    relationTypes: sortedCounts(relationTypes, 'predicate').slice(0, limit),
    parseDiagnostics,
    categoryCounts: {
      classes: { count: classes.size, basis: 'unique-explicit-class-entities' },
      properties: { count: properties.size, basis: 'unique-explicit-property-entities' },
      individuals: { count: individuals.size, basis: 'unique-explicitly-typed-non-class-non-property-entities' },
    },
    hierarchy: {
      roots: { items: roots.slice(0, limit), total: roots.length, omitted: Math.max(0, roots.length - limit) },
      isolated: { items: isolated.slice(0, limit), total: isolated.length, omitted: Math.max(0, isolated.length - limit) },
      highConnection: { items: highConnection.slice(0, limit), total: highConnection.length, omitted: Math.max(0, highConnection.length - limit) },
    },
    completeness: snapshot ? snapshot.completeness : { status: 'unavailable' },
  }
}

/** Deterministic local structure checks over accepted L0 statements. */
export function diagnoseOntologyStructure(index, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const maxDiagnostics = Number.isSafeInteger(settings.maxDiagnostics) && settings.maxDiagnostics > 0
    ? Math.min(settings.maxDiagnostics, 2000) : 200
  const snapshot = index && index.snapshot
  const statements = analysisArray(snapshot && snapshot.statements)
  const diagnostics = []
  let totalDiagnostics = 0
  const ruleCatalog = new Map(Object.entries(ONTOLOGY_ANALYSIS_RULES))
  const ruleMetadata = (ruleId) => {
    if (!ruleCatalog.has(ruleId)) ruleCatalog.set(ruleId, Object.freeze({ category: 'suggestion', severity: 'info' }))
    return ruleCatalog.get(ruleId)
  }
  const push = (ruleId, category, severity, messageKey, rows, entityIds, status) => {
    const evidenceLimit = 20
    const boundedRows = rows.slice(0, evidenceLimit)
    const evidence = uniqueAnalysisEvidence(boundedRows.flatMap(analysisEvidence))
    const metadata = ruleMetadata(ruleId)
    category = category || metadata.category
    severity = severity || metadata.severity
    const completeInput = snapshot && snapshot.completeness && snapshot.completeness.status === 'complete'
    const uncertainConclusion = !completeInput && category === 'structural'
    const entities = [...new Set((entityIds || []).slice(0, 20))].sort()
    const diagnostic = {
      ruleId, category: uncertainConclusion ? 'unverifiable' : category,
      severity: uncertainConclusion ? 'warning' : severity,
      messageKey: typeof messageKey === 'string' ? messageKey : 'analysis.diag.unknown',
      evidence: evidence.slice(0, 20), sourceIds: [...new Set(evidence.map((item) => item.sourceId))].sort(),
      revisions: [...new Set(evidence.map((item) => item.revision))].sort((a, b) => a - b),
      navigable: entities.some((id) => id && index.bySubject.has(id)),
      entityIds: entities.slice(0, 20),
      status: status || (completeInput ? 'complete' : 'partial'),
      location: null,
    }
    diagnostic.id = JSON.stringify([ruleId, diagnostic.evidence.map((item) => item.statementId), entities])
    totalDiagnostics += 1
    if (diagnostics.length < maxDiagnostics) diagnostics.push(diagnostic)
  }
  const rdfFirst = ONTOLOGY_ANALYSIS_RDF + 'first'
  const rdfRest = ONTOLOGY_ANALYSIS_RDF + 'rest'
  const rdfNil = ONTOLOGY_ANALYSIS_RDF + 'nil'
  const listLinks = new Map()
  const rowsBySubject = new Map()
  for (const row of statements) {
    let subjectRows = rowsBySubject.get(row.s)
    if (!subjectRows) rowsBySubject.set(row.s, subjectRows = [])
    subjectRows.push(row)
    if (row.p === rdfFirst || row.p === rdfRest) {
      let links = listLinks.get(row.s)
      if (!links) listLinks.set(row.s, links = { first: [], rest: [] })
      links[row.p === rdfFirst ? 'first' : 'rest'].push(row)
    }
  }
  const listCells = new Set(listLinks.keys())
  for (const cell of [...listCells].sort()) {
    const cellRows = rowsBySubject.get(cell) || []
    if (analysisGraphAmbiguous(cellRows)) {
      push('rdf-list-graph-ambiguous', 'unverifiable', 'warning', 'analysis.diag.rdfListAmbiguous', cellRows, [cell], 'incomplete')
      continue
    }
    const first = analysisDistinctRows(listLinks.get(cell).first)
    const rest = analysisDistinctRows(listLinks.get(cell).rest)
    if (first.length > 1 || rest.length > 1) {
      push('rdf-list-multiple-link', 'structural', 'error', 'analysis.diag.rdfListMultiple', first.concat(rest), [cell])
    } else if (first.length !== 1 || rest.length !== 1) {
      const complete = snapshot && snapshot.completeness && snapshot.completeness.status === 'complete'
      push('rdf-list-missing-link', complete ? 'structural' : 'unverifiable', complete ? 'error' : 'warning',
        'analysis.diag.rdfListMissing', first.concat(rest), [cell], complete ? undefined : 'incomplete')
    } else if (rest[0].oKind === 'literal' || typeof rest[0].o !== 'string') {
      push('rdf-list-invalid-rest', 'structural', 'error', 'analysis.diag.rdfListInvalidRest', rest, [cell])
    }
    if (rest.length === 1 && rest[0].o === rdfNil && first.length === 0) continue
  }

  const rdfListEdges = new Map([...listLinks].map(([cell, links]) => [cell,
    analysisDistinctRows(links.rest).filter((row) => ['iri', 'blank'].includes(row.oKind) && row.o !== rdfNil)
      .map((row) => ({ target: row.o, graphKey: analysisGraphKey(row) }))]))
  const listVisited = new Set()
  const listActive = new Map()
  const listStack = []
  const listCycleKeys = new Set()
  let listTraversalSteps = 0
  let listBudgetExceeded = false
  const maxListSteps = Number.isSafeInteger(settings.maxListSteps) && settings.maxListSteps > 0
    ? Math.min(settings.maxListSteps, 1000000) : 200000
  for (const start of [...listCells].sort()) {
    if (listBudgetExceeded) break
    if (listVisited.has(start)) continue
    listActive.set(start, listStack.length)
    listStack.push(start)
    const startRows = rowsBySubject.get(start) || []
    const startGraphKey = analysisGraphAmbiguous(startRows) ? null : analysisGraphKey(startRows[0] || {})
    const frames = [{ node: start, next: 0, edges: rdfListEdges.get(start) || [], graphKey: startGraphKey }]
    while (frames.length) {
      if (listTraversalSteps++ >= maxListSteps) { listBudgetExceeded = true; break }
      const frame = frames[frames.length - 1]
      if (frame.next >= frame.edges.length) {
        listVisited.add(frame.node); listActive.delete(frame.node); listStack.pop(); frames.pop(); continue
      }
      const edge = frame.edges[frame.next++]
      const target = edge.target
      const targetRows = rowsBySubject.get(target) || []
      if (analysisGraphAmbiguous(targetRows) || frame.graphKey && edge.graphKey !== frame.graphKey) {
        push('rdf-list-graph-ambiguous', 'unverifiable', 'warning', 'analysis.diag.rdfListAmbiguous', targetRows, [frame.node, target], 'incomplete')
        continue
      }
      const targetGraphKey = frame.graphKey || edge.graphKey
      if (listActive.has(target)) {
        const cycle = listStack.slice(listActive.get(target)).sort()
        const key = JSON.stringify([targetGraphKey, cycle])
        if (!listCycleKeys.has(key)) {
          listCycleKeys.add(key)
          const cycleRows = []
          for (const cell of cycle) {
            for (const row of listLinks.get(cell) && listLinks.get(cell).rest || []) {
              if (analysisGraphKey(row) !== targetGraphKey) continue
              cycleRows.push(row)
              if (cycleRows.length >= 20) break
            }
            if (cycleRows.length >= 20) break
          }
          push('rdf-list-cycle', 'suggestion', 'warning', 'analysis.diag.rdfListCycle', cycleRows, cycle.slice(0, 20))
        }
      } else if (!listVisited.has(target)) {
        listActive.set(target, listStack.length); listStack.push(target)
        frames.push({ node: target, next: 0, edges: rdfListEdges.get(target) || [], graphKey: targetGraphKey })
      }
    }
  }

  const subclass = statements.filter((row) => row.p === ONTOLOGY_ANALYSIS_RDFS + 'subClassOf' && row.oKind !== 'literal')
  const parents = new Map()
  for (const row of subclass) {
    if (!parents.has(row.s)) parents.set(row.s, [])
    parents.get(row.s).push(row.o)
  }
  let cycleSteps = 0
  const maxCycleSteps = Number.isSafeInteger(settings.maxSteps) && settings.maxSteps > 0
    ? Math.min(settings.maxSteps, 1000000) : 200000
  const visited = new Set()
  const activeIndex = new Map()
  const stack = []
  const cycleKeys = new Set()
  let budgetExceeded = false
  for (const start of [...new Set(subclass.flatMap((row) => [row.s, row.o]))].sort()) {
    if (visited.has(start)) continue
    const frames = [{ node: start, next: 0, edges: [...new Set(parents.get(start) || [])].sort() }]
    activeIndex.set(start, stack.length)
    stack.push(start)
    while (frames.length) {
      if (cycleSteps++ >= maxCycleSteps) { budgetExceeded = true; break }
      const frame = frames[frames.length - 1]
      if (frame.next >= frame.edges.length) {
        visited.add(frame.node)
        activeIndex.delete(frame.node)
        stack.pop()
        frames.pop()
        continue
      }
      const target = frame.edges[frame.next++]
      if (activeIndex.has(target)) {
        const cycle = stack.slice(activeIndex.get(target)).sort()
        const key = JSON.stringify(cycle)
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key)
          const cycleSet = new Set(cycle)
          const cycleRows = subclass.filter((row) => cycleSet.has(row.s) && cycleSet.has(row.o))
          push('subclass-cycle', 'suggestion', 'warning', 'analysis.diag.subclassCycle', cycleRows, cycle, 'partial')
        }
      } else if (!visited.has(target)) {
        activeIndex.set(target, stack.length)
        stack.push(target)
        frames.push({ node: target, next: 0, edges: [...new Set(parents.get(target) || [])].sort() })
      }
    }
    if (budgetExceeded) break
  }
  if (budgetExceeded) {
    push('subclass-cycle-budget', 'unverifiable', 'warning', 'analysis.diag.cycleBudget', [], [], 'incomplete')
  }
  if (listBudgetExceeded) {
    push('rdf-list-budget-exceeded', 'unverifiable', 'warning', 'analysis.diag.cycleBudget', [], [], 'incomplete')
  }

  const declarations = new Map()
  const mentioned = new Set()
  for (const row of statements) {
    if (row.p === ONTOLOGY_ANALYSIS_RDF + 'type' && row.oKind !== 'literal') {
      let rows = declarations.get(row.s)
      if (!rows) declarations.set(row.s, rows = [])
      rows.push(row)
    } else {
      mentioned.add(row.s)
      if (row.oKind !== 'literal') mentioned.add(row.o)
    }
  }
  for (const [entity, rows] of declarations) {
    if (!mentioned.has(entity)) push('entity-possibly-unused', 'suggestion', 'info', 'analysis.diag.possiblyUnused', rows, [entity])
  }
  const labelPredicate = ONTOLOGY_ANALYSIS_RDFS + 'label'
  for (const row of statements.filter((item) => item.p === labelPredicate && item.oKind === 'literal')) {
    if (!row.o.trim()) push('label-empty', 'suggestion', 'warning', 'analysis.diag.emptyLabel', [row], [row.s])
    if (row.literalTruncated || (row.literalIdentity && row.literalIdentity.reliability !== 'reliable')) {
      push('label-identity-unknown', 'unverifiable', 'warning', 'analysis.diag.labelUnknown', [row], [row.s], 'incomplete')
    }
  }

  const propertyKinds = new Map()
  for (const row of statements) {
    if (row.p !== ONTOLOGY_ANALYSIS_RDF + 'type') continue
    const kind = row.o === ONTOLOGY_ANALYSIS_OWL + 'ObjectProperty' ? 'object' :
      row.o === ONTOLOGY_ANALYSIS_OWL + 'DatatypeProperty' ? 'datatype' : null
    if (!kind) continue
    if (!propertyKinds.has(row.s)) propertyKinds.set(row.s, new Map())
    const kinds = propertyKinds.get(row.s)
    if (!kinds.has(kind)) kinds.set(kind, [])
    kinds.get(kind).push(row)
  }
  for (const [entity, kinds] of propertyKinds) {
    if (kinds.has('object') && kinds.has('datatype'))
      push('property-kind-conflict', 'suggestion', 'warning', 'analysis.diag.propertyKindConflict', [...kinds.values()].flat(), [entity])
  }
  const labelsByLanguage = new Map()
  for (const row of statements.filter((item) => item.p === ONTOLOGY_ANALYSIS_RDFS + 'label' && item.oKind === 'literal')) {
    const key = JSON.stringify([row.s, row.lang || ''])
    if (!labelsByLanguage.has(key)) labelsByLanguage.set(key, [])
    labelsByLanguage.get(key).push(row)
  }
  for (const rows of labelsByLanguage.values()) {
    const values = new Set(rows.filter((row) => !row.literalTruncated).map((row) => row.o))
    if (values.size > 1) push('label-conflict', 'suggestion', 'warning', 'analysis.diag.labelConflict', rows, [rows[0].s])
  }
  for (const source of analysisArray(snapshot && snapshot.sources)) {
    for (const entry of analysisArray(source.diagnostics).concat(analysisArray(source.errors).map((error) => ({ code: 'parse-error', error })))) {
      const item = { sourceId: source.sourceId, revision: source.revision, statementId: null, raw: null }
      push(entry && entry.code === 'parse-error' ? 'parse-error' : 'parser-diagnostic', 'unverifiable', 'warning',
        'analysis.diag.parser', [item], [], 'incomplete')
    }
  }

  const duplicates = new Map()
  const uncertainLiteralCandidates = new Map()
  for (const row of statements) {
    const uncertainLiteral = row.oKind === 'literal' && (row.literalTruncated ||
      row.literalIdentity && row.literalIdentity.reliability !== 'reliable')
    const key = uncertainLiteral
      ? JSON.stringify(['uncertain-literal-candidate', row.s, row.p, row.dt, row.lang, analysisGraphKey(row)])
      : analysisTermKey(row)
    const map = uncertainLiteral ? uncertainLiteralCandidates : duplicates
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  for (const rows of [...duplicates.values(), ...uncertainLiteralCandidates.values()]) {
    if (rows.length < 2) continue
    const uncertain = rows.some((row) => row.oKind === 'literal' && (row.literalTruncated ||
      row.literalIdentity && row.literalIdentity.reliability !== 'reliable'))
    push(uncertain ? 'duplicate-identity-unknown' : 'duplicate-statement',
      uncertain ? 'unverifiable' : 'suggestion', 'info',
      uncertain ? 'analysis.diag.duplicateUnknown' : 'analysis.diag.duplicateStatement',
      rows, [rows[0].s], uncertain ? 'incomplete' : undefined)
  }
  diagnostics.sort((a, b) => a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 :
    JSON.stringify(a.entityIds).localeCompare(JSON.stringify(b.entityIds)))
  return {
    snapshotId: snapshot ? snapshot.snapshotId : '',
    diagnostics,
    total: totalDiagnostics,
    omitted: Math.max(0, totalDiagnostics - diagnostics.length),
    status: !snapshot ? 'unavailable' : (snapshot.completeness.status === 'complete' && !listBudgetExceeded && !budgetExceeded ? 'complete' : 'partial'),
  }
}

export function explainOntologyProperty(index, propertyId) {
  const source = index && index.snapshot
  const rows = analysisRows(index, propertyId)
  if (analysisGraphAmbiguous(rows)) return createOntologyAnalysisResult(source, {
    status: 'incomplete', data: { kind: 'property', propertyId, explanationKey: 'analysis.property.partial', reason: 'graph-scope-ambiguous' }, evidence: rows })
  const predicates = new Map([
    [ONTOLOGY_ANALYSIS_RDFS + 'domain', 'domain'],
    [ONTOLOGY_ANALYSIS_RDFS + 'range', 'range'],
    [ONTOLOGY_ANALYSIS_OWL + 'inverseOf', 'inverseOf'],
  ])
  const characteristics = new Map([
    [ONTOLOGY_ANALYSIS_OWL + 'FunctionalProperty', 'functional'],
    [ONTOLOGY_ANALYSIS_OWL + 'InverseFunctionalProperty', 'inverseFunctional'],
    [ONTOLOGY_ANALYSIS_OWL + 'TransitiveProperty', 'transitive'],
    [ONTOLOGY_ANALYSIS_OWL + 'SymmetricProperty', 'symmetric'],
    [ONTOLOGY_ANALYSIS_OWL + 'AsymmetricProperty', 'asymmetric'],
    [ONTOLOGY_ANALYSIS_OWL + 'ReflexiveProperty', 'reflexive'],
    [ONTOLOGY_ANALYSIS_OWL + 'IrreflexiveProperty', 'irreflexive'],
  ])
  const assertions = rows.filter((row) => predicates.has(row.p))
    .map((row) => ({ form: predicates.get(row.p), row }))
  const types = rows.filter((row) => row.p === ONTOLOGY_ANALYSIS_RDF + 'type' && characteristics.has(row.o))
    .map((row) => ({ form: characteristics.get(row.o), row }))
  const items = assertions.concat(types)
  if (!items.length) {
    return createOntologyAnalysisResult(source, {
      status: 'unavailable', data: { kind: 'property', propertyId, explanationKey: 'analysis.property.notFound' }, evidence: [],
    })
  }
  const incomplete = !source || !source.completeness || source.completeness.status !== 'complete'
  return createOntologyAnalysisResult(source, {
    status: incomplete ? 'partial' : 'complete',
    data: {
      kind: 'property', propertyId,
      assertions: items.map(({ form, row }) => ({ form, value: row.o, valueKind: row.oKind })),
      explanationKey: incomplete ? 'analysis.property.partial' : 'analysis.property.asserted',
      asserted: true, inferred: false,
    },
    evidence: items.map((item) => item.row).map(analysisEvidence).flat(),
  })
}

function uniqueAnalysisEvidence(items) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = JSON.stringify([item.sourceId, item.revision, item.statementId])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function createOntologyAnalysisIndex(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : createOntologyAnalysisSnapshot(null)
  const bySubject = new Map()
  const rawSubjects = new Map()
  const byPredicate = new Map()
  const byObject = new Map()
  const namespaces = new Map()
  const relationTypes = new Map()
  const put = (map, key, statement) => {
    let rows = map.get(key)
    if (!rows) map.set(key, rows = [])
    rows.push(statement)
  }
  for (const statement of analysisArray(source.statements)) {
    put(bySubject, statement.s, statement)
    const rawSubject = statement.raw ? statement.raw.s : statement.s
    if (!rawSubjects.has(rawSubject)) rawSubjects.set(rawSubject, new Set())
    rawSubjects.get(rawSubject).add(statement.s)
    put(byPredicate, statement.p, statement)
    const objectKey = statement.oKind === 'literal'
      ? JSON.stringify(['literal', statement.o, statement.dt, statement.lang])
      : JSON.stringify([statement.oKind, statement.o])
    put(byObject, objectKey, statement)
    relationTypes.set(statement.p, (relationTypes.get(statement.p) || 0) + 1)
    for (const term of [statement.s, statement.oKind === 'literal' ? '' : statement.o]) {
      const namespace = analysisNamespace(term)
      if (namespace) namespaces.set(namespace, (namespaces.get(namespace) || 0) + 1)
    }
  }
  const toSortedMap = (map) => new Map([...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  for (const map of [bySubject, byPredicate, byObject]) {
    for (const rows of map.values()) rows.sort((a, b) => a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0)
  }
  return {
    snapshotId: source.snapshotId,
    snapshot: source,
    listCache: new Map(), listSteps: 0, maxListSteps: 20000,
    bySubject,
    rawSubjects,
    byPredicate,
    byObject,
    namespaces: [...toSortedMap(namespaces)].map(([namespace, count]) => ({ namespace, count })),
    relationTypes: [...toSortedMap(relationTypes)].map(([predicate, count]) => ({ predicate, count })),
    acceptedOccurrences: source.counts && Number.isSafeInteger(source.counts.acceptedOccurrences)
      ? source.counts.acceptedOccurrences : 0,
  }
}

/** Build a stable envelope for one result tied to an immutable L0 snapshot. */
export function createOntologyAnalysisResult(snapshot, input) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : createOntologyAnalysisSnapshot(null)
  const options = input && typeof input === 'object' ? input : {}
  let status = ['complete', 'partial', 'incomplete', 'invalid', 'unavailable'].includes(options.status)
    ? options.status
    : source.completeness && source.completeness.status === 'complete' ? 'complete' : 'partial'
  if (status === 'complete' && (!source.completeness || source.completeness.status !== 'complete')) status = 'partial'
  const accepted = new Map(analysisArray(source.statements).map((row) => [JSON.stringify([row.sourceId, row.revision, row.statementId]), row]))
  const evidence = analysisArray(options.evidence).filter((item) => {
    if (!item) return false
    const row = accepted.get(JSON.stringify([item.sourceId, item.revision, item.statementId]))
    return !!row && item.s === row.s && item.p === row.p && item.o === row.o &&
      item.oKind === row.oKind && JSON.stringify(item.graph || null) === JSON.stringify(row.graph || null)
  }).map((item) => ({
    ...analysisEvidence(accepted.get(JSON.stringify([item.sourceId, item.revision, item.statementId])))[0],
    entityId: analysisText(item.entityId, null), location: null,
  }))
  return {
    schemaVersion: ONTOLOGY_ANALYSIS_SCHEMA_VERSION,
    snapshotId: analysisText(source.snapshotId, ''),
    status,
    completeness: source.completeness || { status: 'unavailable', locationsAvailable: false },
    data: options.data === undefined ? null : options.data,
    evidence,
  }
}

/** Stable JSON serialization for deterministic tests, exports and cache keys. */
export function stableOntologyAnalysisJson(value) {
  function stable(item) {
    if (Array.isArray(item)) return item.map(stable)
    if (!item || typeof item !== 'object') return item
    const result = {}
    for (const key of Object.keys(item).sort()) result[key] = stable(item[key])
    return result
  }
  return JSON.stringify(stable(value))
}
