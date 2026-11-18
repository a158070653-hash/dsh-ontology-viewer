import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createOntologyAnalysisSnapshot,
  setOntologyAnalysisIdentity,
  createOntologyAnalysisIndex,
  createOntologyOverview,
  diagnoseOntologyStructure,
  inspectOntologyRdfList,
  explainOntologyRestriction,
  explainOntologyClassExpression,
  explainOntologyProperty,
  createOntologyAnalysisResult,
  stableOntologyAnalysisJson,
} from '../src/ontology-analysis.js'

import { parseOntology } from '../src/rdf-parse.js'
import { entityKeyForTerm } from '../src/ontology-identity.js'
setOntologyAnalysisIdentity({ entityKeyForTerm })

test('manual semantic fixture has traceable non-empty diagnostics and a complete restriction', () => {
  const text = readFileSync(new URL('./fixtures/semantic-inspection.ttl', import.meta.url), 'utf8')
  const parsed = parseOntology(text, 'semantic-inspection.ttl')
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: [{ sourceId: 'manual', revision: 1, status: 'ready', parsed }] })
  const index = createOntologyAnalysisIndex(snapshot)
  const result = diagnoseOntologyStructure(index)
  assert.ok(result.diagnostics.some((item) => item.ruleId === 'rdf-list-missing-link'))
  assert.ok(result.diagnostics.some((item) => item.ruleId.includes('cycle')))
  assert.ok(result.diagnostics.every((item) => item.evidence.every((entry) => entry.sourceId === 'manual')))
  const explanation = explainOntologyRestriction(index, 'urn:semantic-inspection:Restriction')
  assert.equal(explanation.status, 'complete')
})

function fixtureWorkspace() {
  return {
    revision: 4,
    sources: [
      {
        sourceId: 'src-a', revision: 2, status: 'ready', format: 'turtle', stale: false,
        parsed: {
          format: 'turtle',
          triples: [{
            s: 'urn:s', p: 'urn:p', o: 'visible', oKind: 'literal', lang: 'en',
            literalTruncated: true, literalOriginalLength: 100,
            literalIdentity: { version: 1, reliability: 'reliable', lexical: 'visible plus retained identity' },
            graph: { kind: 'blank', value: '_:g' }, location: null,
          }],
          diagnostics: [], warnings: [], errors: [],
          stats: { truncated: false, truncation: null },
        },
      },
      {
        sourceId: 'src-b', revision: 1, status: 'partial', format: 'ntriples', stale: true,
        parsed: {
          format: 'ntriples',
          triples: [{
            s: 'urn:s', p: 'urn:q', o: 'prefix', oKind: 'literal',
            literalTruncated: true, literalOriginalLength: 99,
            literalIdentity: { version: 1, reliability: 'unknown', reason: 'literal-identity-budget' },
            graph: { kind: 'default' }, location: null,
          }],
          diagnostics: [], warnings: [], errors: [],
          stats: { truncated: true, truncation: { reason: 'triple-limit', kept: 1 } },
        },
      },
    ],
  }
}

test('analysis snapshot uses accepted L0 occurrences and exposes completeness/evidence flags', () => {
  const snapshot = createOntologyAnalysisSnapshot(fixtureWorkspace())
  assert.equal(snapshot.schemaVersion, 1)
  assert.equal(snapshot.scope.layer, 'L0')
  assert.deepEqual(snapshot.scope.sourceIds, ['src-a', 'src-b'])
  assert.equal(snapshot.counts.acceptedOccurrences, 2)
  assert.equal(snapshot.statements.length, 2)
  assert.equal(snapshot.statements[0].literalIdentity.lexical, 'visible plus retained identity')
  assert.equal(snapshot.statements[1].literalIdentity.reliability, 'unknown')
  assert.equal(snapshot.statements[1].literalIdentity.reason, 'literal-identity-budget')
  assert.equal(snapshot.statements[0].location, null)
  assert.equal(snapshot.statements[0].statementId, '\u0000statement\u00005:src-a1:0')
  assert.equal(snapshot.completeness.status, 'partial')
  assert.equal(snapshot.completeness.parseTruncated, true)
  assert.equal(snapshot.completeness.literalIdentityUnknown, true)
  assert.deepEqual(snapshot.completeness.staleSources, ['src-b'])
})

test('analysis snapshot filters selected L0 sources and declares missing selections', () => {
  const snapshot = createOntologyAnalysisSnapshot(fixtureWorkspace(), { sourceIds: ['src-b', 'missing'] })
  assert.deepEqual(snapshot.scope.sourceIds, ['src-b'])
  assert.deepEqual(snapshot.completeness.rejectedOrAbsentSelection, ['missing'])
  assert.equal(snapshot.statements.length, 1)
})

test('analysis index provides deterministic L0 subject/predicate/object lookup and counts', () => {
  const snapshot = createOntologyAnalysisSnapshot(fixtureWorkspace())
  const index = createOntologyAnalysisIndex(snapshot)
  assert.equal(index.snapshotId, snapshot.snapshotId)
  assert.equal(index.bySubject.get('urn:s').length, 2)
  assert.equal(index.byPredicate.get('urn:p').length, 1)
  assert.equal(index.byObject.get(JSON.stringify(['literal', 'visible', null, 'en'])).length, 1)
  assert.equal(index.byObject.has(JSON.stringify(['literal', 'visible plus retained identity', null, 'en'])), false)
  assert.deepEqual(index.relationTypes, [
    { predicate: 'urn:p', count: 1 },
    { predicate: 'urn:q', count: 1 },
  ])
  assert.equal(index.acceptedOccurrences, 2)
})

function listIndex(triples) {
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 1,
    sources: [{
      sourceId: 'list-src', revision: 1, status: 'ready', stale: false,
      parsed: { triples: triples.map((row) => ({ graph: { kind: 'default' }, ...row })), stats: { truncated: false }, diagnostics: [], warnings: [], errors: [] },
    }],
  })
  return createOntologyAnalysisIndex(snapshot)
}

test('RDF List inspection deduplicates reliable link values but retains occurrence evidence', () => {
  const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const index = listIndex([
    { s: '_:list', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:list', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:list', p: rdf + 'rest', o: rdf + 'nil', oKind: 'iri' },
    { s: '_:list', p: rdf + 'rest', o: rdf + 'nil', oKind: 'iri' },
  ])
  const result = inspectOntologyRdfList(index, '_:list')
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.members.map((member) => member.value), ['urn:A'])
  assert.equal(result.evidence.length, 4)
  assert.equal(new Set(result.evidence.map((item) => item.statementId)).size, 4)
})

test('RDF List inspection returns ordered members and statement evidence', () => {
  const index = listIndex([
    { s: '_:l1', p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first', o: 'urn:A', oKind: 'iri' },
    { s: '_:l1', p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest', o: '_:l2', oKind: 'blank' },
    { s: '_:l2', p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first', o: 'urn:B', oKind: 'iri' },
    { s: '_:l2', p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest', o: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil', oKind: 'iri' },
  ])
  const result = inspectOntologyRdfList(index, '_:l1')
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.members.map((item) => item.value), ['urn:A', 'urn:B'])
  assert.equal(result.evidence.length, 4)
})

test('RDF List inspection preserves repeated member occurrences and detects multi-node cycles', () => {
  const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const repeated = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:X', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: '_:b', oKind: 'blank' },
    { s: '_:b', p: rdf + 'first', o: 'urn:X', oKind: 'iri' },
    { s: '_:b', p: rdf + 'rest', o: rdf + 'nil', oKind: 'iri' },
  ])
  const result = inspectOntologyRdfList(repeated, '_:a')
  assert.deepEqual(result.members.map((member) => member.value), ['urn:X', 'urn:X'])
  const cyclic = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: '_:b', oKind: 'blank' },
    { s: '_:b', p: rdf + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:b', p: rdf + 'rest', o: '_:a', oKind: 'blank' },
  ])
  assert.equal(inspectOntologyRdfList(cyclic, '_:a').diagnostics[0].ruleId, 'rdf-list-cycle')
})

test('RDF List inspection marks cycles, missing/multiple links, invalid rest, and budget exhaustion', () => {
  const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const cycle = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: '_:a', oKind: 'blank' },
  ])
  assert.equal(inspectOntologyRdfList(cycle, '_:a').diagnostics[0].ruleId, 'rdf-list-cycle')

  const missing = listIndex([])
  assert.equal(inspectOntologyRdfList(missing, '_:missing').diagnostics[0].ruleId, 'rdf-list-missing-link')

  const multiple = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:a', p: rdf + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: rdf + 'nil', oKind: 'iri' },
  ])
  assert.equal(inspectOntologyRdfList(multiple, '_:a').diagnostics[0].ruleId, 'rdf-list-multiple-link')

  const invalidRest = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: 'not-an-iri', oKind: 'literal' },
  ])
  assert.equal(inspectOntologyRdfList(invalidRest, '_:a').diagnostics[0].ruleId, 'rdf-list-invalid-rest')

  const long = listIndex([
    { s: '_:a', p: rdf + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:a', p: rdf + 'rest', o: '_:b', oKind: 'blank' },
    { s: '_:b', p: rdf + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:b', p: rdf + 'rest', o: rdf + 'nil', oKind: 'iri' },
  ])
  const capped = inspectOntologyRdfList(long, '_:a', { maxCells: 1 })
  assert.equal(capped.status, 'incomplete')
  assert.equal(capped.members.length, 0)
  assert.equal(capped.diagnostics[0].ruleId, 'rdf-list-budget-exceeded')
})

function restrictionIndex(triples, options) {
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 1,
    sources: [{
      sourceId: 'owl-src', revision: 1, status: options && options.status || 'ready',
      stale: false,
      parsed: {
        triples: triples.map((row) => ({ graph: { kind: 'default' }, ...row })),
        stats: { truncated: !!(options && options.truncated), truncation: null },
        diagnostics: [], warnings: [], errors: [],
      },
    }],
  })
  return createOntologyAnalysisIndex(snapshot)
}

const OWL = 'http://www.w3.org/2002/07/owl#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

function restrictionBase(extra, typeRows) {
  return [
    { s: '_:r', p: RDF + 'type', o: OWL + 'Restriction', oKind: 'iri' },
    { s: '_:r', p: OWL + 'onProperty', o: 'urn:p', oKind: 'iri' },
    ...(typeRows || []),
    ...extra,
  ]
}

test('restriction decoder explains some/all/has and non-negative cardinalities without inference', () => {
  for (const [form, value, kind] of [
    ['someValuesFrom', 'urn:Class', 'iri'],
    ['allValuesFrom', 'urn:Class', 'iri'],
    ['hasValue', 'urn:value', 'iri'],
  ]) {
    const index = restrictionIndex(restrictionBase([
      { s: '_:r', p: OWL + form, o: value, oKind: kind },
    ]))
    const result = explainOntologyRestriction(index, '_:r')
    assert.equal(result.data.form, form)
    assert.equal(result.data.explanationKey, 'analysis.restriction.' + form)
    assert.equal(result.data.inferred, false)
    assert.ok(result.evidence.length >= 3)
    assert.ok(result.evidence.every((item) => item.location === null))
  }

  const cardinality = restrictionIndex(restrictionBase([
    { s: '_:r', p: OWL + 'minCardinality', o: '2', oKind: 'literal', dt: XSD + 'nonNegativeInteger',
      literalIdentity: { version: 1, reliability: 'reliable', lexical: '2' } },
  ]))
  const result = explainOntologyRestriction(cardinality, '_:r')
  assert.equal(result.status, 'complete')
  assert.equal(result.data.explanationValues.cardinality, 2)
})

test('restriction decoder rejects invalid property and class operand term kinds', () => {
  for (const triple of [
    { s: '_:r', p: OWL + 'onProperty', o: 'urn:p', oKind: 'literal' },
    { s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:C', oKind: 'literal' },
    { s: '_:r', p: OWL + 'allValuesFrom', o: 'urn:C', oKind: 'literal' },
  ]) {
    const form = triple.p.endsWith('onProperty') ? { s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:C', oKind: 'iri' } : null
    const rows = restrictionBase(form ? [form] : [{ s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:C', oKind: 'iri' }])
    rows.push(triple)
    const result = explainOntologyRestriction(restrictionIndex(rows), '_:r')
    assert.notEqual(result.status, 'complete')
    assert.equal(result.data.explanationKey, 'analysis.restriction.incomplete')
  }
})

test('restriction decoder marks missing, conflicting, truncated and open-world-unsafe data incomplete', () => {
  const missing = explainOntologyRestriction(restrictionIndex(restrictionBase([])), '_:r')
  assert.equal(missing.status, 'incomplete')

  const conflict = explainOntologyRestriction(restrictionIndex(restrictionBase([
    { s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:A', oKind: 'iri' },
    { s: '_:r', p: OWL + 'allValuesFrom', o: 'urn:B', oKind: 'iri' },
  ])), '_:r')
  assert.equal(conflict.status, 'incomplete')

  const truncated = explainOntologyRestriction(restrictionIndex(restrictionBase([
    { s: '_:r', p: OWL + 'minCardinality', o: '2', oKind: 'literal', dt: XSD + 'integer',
      literalTruncated: true, literalOriginalLength: 3,
      literalIdentity: { version: 1, reliability: 'unknown' } },
  ])), '_:r')
  assert.equal(truncated.status, 'incomplete')
  assert.equal(truncated.data.explanationKey, 'analysis.restriction.incompleteCardinality')

  const partialSome = explainOntologyRestriction(restrictionIndex(restrictionBase([
    { s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:A', oKind: 'iri' },
  ]), { truncated: true }), '_:r')
  assert.equal(partialSome.status, 'partial')
  assert.equal(partialSome.data.explanationKey, 'analysis.restriction.incomplete')

  assert.equal(explainOntologyRestriction(restrictionIndex([]), '_:notRestriction').status, 'unavailable')
})

test('class expression decoder returns ordered complete lists and asserted relations only', () => {
  const list = restrictionIndex([
    { s: 'urn:C', p: OWL + 'intersectionOf', o: '_:l', oKind: 'blank' },
    { s: '_:l', p: RDF + 'first', o: 'urn:A', oKind: 'iri' },
    { s: '_:l', p: RDF + 'rest', o: '_:l2', oKind: 'blank' },
    { s: '_:l2', p: RDF + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:l2', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri' },
  ])
  const intersection = explainOntologyClassExpression(list, 'urn:C')
  assert.equal(intersection.status, 'complete')
  assert.deepEqual(intersection.data.explanationValues.operands.map((item) => item.value), ['urn:A', 'urn:B'])
  assert.equal(intersection.data.inferred, false)
  assert.equal(intersection.evidence.length, 5)

  const direct = restrictionIndex([
    { s: 'urn:A', p: OWL + 'equivalentClass', o: 'urn:B', oKind: 'iri' },
  ])
  const equivalent = explainOntologyClassExpression(direct, 'urn:A')
  assert.equal(equivalent.data.form, 'equivalentClass')
  assert.equal(equivalent.data.inferred, false)
})

test('class expression decoder independently explains multiple direct asserted axioms', () => {
  const index = restrictionIndex([
    { s: 'urn:A', p: OWL + 'equivalentClass', o: 'urn:B', oKind: 'iri' },
    { s: 'urn:A', p: OWL + 'disjointWith', o: 'urn:C', oKind: 'iri' },
    { s: 'urn:A', p: OWL + 'equivalentClass', o: 'urn:B', oKind: 'iri' },
  ])
  const result = explainOntologyClassExpression(index, 'urn:A')
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.data.explanations.map((item) => item.data.form), ['equivalentClass', 'equivalentClass', 'disjointWith'])
  assert.ok(result.data.explanations.every((item) => item.data.asserted && !item.data.inferred))
  assert.ok(result.data.explanations.every((item) => item.status === 'complete' && item.evidence.length === 1))
  assert.equal(result.evidence.length, 3)
  assert.equal(result.data.explanationKey, 'analysis.expression.multiple')
})

test('class expression decoder combines mixed direct and list forms independently', () => {
  const index = restrictionIndex([
    { s: 'urn:A', p: OWL + 'unionOf', o: '_:members', oKind: 'blank' },
    { s: 'urn:A', p: OWL + 'disjointWith', o: 'urn:C', oKind: 'iri' },
    { s: '_:members', p: RDF + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:members', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri' },
  ])
  const result = explainOntologyClassExpression(index, 'urn:A')
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.data.explanations.map((item) => item.data.form), ['disjointWith', 'unionOf'])
  assert.ok(result.data.explanations.every((item) => item.status === 'complete'))
  assert.deepEqual(result.data.explanations[1].data.explanationValues.operands.map((item) => item.value), ['urn:B'])
  assert.equal(result.evidence.length, 4)
})

test('duplicate identical class-list assertions collapse logically but preserve occurrence evidence', () => {
  const index = restrictionIndex([
    { s: 'urn:A', p: OWL + 'unionOf', o: '_:members', oKind: 'blank' },
    { s: 'urn:A', p: OWL + 'unionOf', o: '_:members', oKind: 'blank' },
    { s: '_:members', p: RDF + 'first', o: 'urn:B', oKind: 'iri' },
    { s: '_:members', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri' },
  ])
  const result = explainOntologyClassExpression(index, 'urn:A')
  assert.equal(result.status, 'complete')
  assert.equal(result.data.form, 'unionOf')
  assert.equal(result.evidence.length, 4)
  assert.equal(new Set(result.evidence.map((item) => item.statementId)).size, 4)
})

test('property decoder only reports explicit domain/range/inverse and characteristic axioms', () => {
  const index = restrictionIndex([
    { s: 'urn:p', p: 'http://www.w3.org/2000/01/rdf-schema#domain', o: 'urn:Domain', oKind: 'iri' },
    { s: 'urn:p', p: 'http://www.w3.org/2000/01/rdf-schema#range', o: 'urn:Range', oKind: 'iri' },
    { s: 'urn:p', p: OWL + 'inverseOf', o: 'urn:q', oKind: 'iri' },
    { s: 'urn:p', p: RDF + 'type', o: OWL + 'TransitiveProperty', oKind: 'iri' },
  ])
  const result = explainOntologyProperty(index, 'urn:p')
  assert.equal(result.status, 'complete')
  assert.equal(result.data.asserted, true)
  assert.equal(result.data.inferred, false)
  assert.deepEqual(result.data.assertions.map((item) => item.form), ['domain', 'range', 'inverseOf', 'transitive'])
})

test('overview reports L0 scope counts, hierarchy roots and stable entity targets', () => {
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 2,
    sources: [{
      sourceId: 'overview', revision: 1, status: 'ready', stale: false,
      parsed: {
        triples: [
          { s: 'urn:A', p: RDF + 'type', o: OWL + 'Class', oKind: 'iri' },
          { s: 'urn:B', p: RDF + 'type', o: OWL + 'Class', oKind: 'iri' },
          { s: 'urn:B', p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', o: 'urn:A', oKind: 'iri' },
          { s: 'urn:p', p: RDF + 'type', o: OWL + 'ObjectProperty', oKind: 'iri' },
          { s: 'urn:A', p: 'urn:p', o: 'urn:B', oKind: 'iri' },
        ],
        stats: { truncated: false }, diagnostics: [], warnings: [], errors: [],
      },
    }],
  })
  const overview = createOntologyOverview(createOntologyAnalysisIndex(snapshot))
  assert.equal(overview.counts.classes.value, 2)
  assert.equal(overview.counts.properties.value, 1)
  assert.equal(overview.counts.acceptedRelationships.value, 5)
  assert.deepEqual(overview.hierarchy.roots.items, ['urn:A'])
  assert.deepEqual(overview.hierarchy.isolated.items, [])
  assert.equal(overview.counts.classes.layer, 'L0')
  assert.equal(overview.counts.classes.basis, 'unique-terms')
  assert.equal(overview.counts.expressionStructures.value, 0)
})

test('quality diagnostics stop RDF List traversal at its explicit step budget', () => {
  const triples = Array.from({ length: 20 }, (_, i) => [
    { s: '_:cycle' + i, p: RDF + 'first', o: 'urn:A', oKind: 'iri', graph: { kind: 'default' } },
    { s: '_:cycle' + i, p: RDF + 'rest', o: '_:cycle' + i, oKind: 'blank', graph: { kind: 'default' } },
  ]).flat()
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: [{ sourceId: 'bounded', revision: 1,
    status: 'ready', parsed: { triples, stats: { truncated: false }, diagnostics: [], errors: [], warnings: [] } }] })
  const result = diagnoseOntologyStructure(createOntologyAnalysisIndex(snapshot), { maxListSteps: 3 })
  const cycles = result.diagnostics.filter((item) => item.ruleId === 'rdf-list-cycle')
  assert.ok(cycles.length > 0 && cycles.length < 20)
  assert.ok(result.diagnostics.some((item) => item.ruleId === 'rdf-list-budget-exceeded' && item.status === 'incomplete'))
  assert.equal(result.status, 'partial')
  assert.ok(result.total < 20)
})

test('quality diagnostics separate definite list defects from heuristic cycles/unused suggestions', () => {
  const rdfRdfs = 'http://www.w3.org/2000/01/rdf-schema#'
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 1,
    sources: [{
      sourceId: 'diag', revision: 1, status: 'ready', stale: false,
      parsed: {
        triples: [
          { s: '_:bad', p: RDF + 'first', o: 'urn:A', oKind: 'iri', graph: { kind: 'default' } },
          { s: 'urn:A', p: rdfRdfs + 'subClassOf', o: 'urn:B', oKind: 'iri' },
          { s: 'urn:B', p: rdfRdfs + 'subClassOf', o: 'urn:A', oKind: 'iri' },
          { s: 'urn:Unused', p: RDF + 'type', o: OWL + 'Class', oKind: 'iri' },
        ],
        stats: { truncated: false }, diagnostics: [], warnings: [], errors: [],
      },
    }],
  })
  const result = diagnoseOntologyStructure(createOntologyAnalysisIndex(snapshot))
  assert.ok(result.diagnostics.some((item) => item.ruleId === 'rdf-list-missing-link' && item.category === 'structural'))
  assert.ok(result.diagnostics.some((item) => item.ruleId === 'subclass-cycle' && item.category === 'suggestion'))
  assert.ok(result.diagnostics.some((item) => item.ruleId === 'entity-possibly-unused' && item.entityIds.includes('urn:Unused')))
  assert.ok(result.diagnostics.every((item) => item.evidence.every((evidence) => evidence.statementId)))
})

test('quality diagnostics do not assert duplicate identity for truncated literals', () => {
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 1,
    sources: [{
      sourceId: 'truncated', revision: 1, status: 'ready', stale: false,
      parsed: {
        triples: [
          { s: 'urn:s', p: 'urn:label', o: 'prefix', oKind: 'literal', literalTruncated: true,
            literalOriginalLength: 100, literalIdentity: { version: 1, reliability: 'unknown', reason: 'limit' } },
          { s: 'urn:s', p: 'urn:label', o: 'prefix', oKind: 'literal', literalTruncated: true,
            literalOriginalLength: 100, literalIdentity: { version: 1, reliability: 'unknown', reason: 'limit' } },
        ],
        stats: { truncated: false }, diagnostics: [], warnings: [], errors: [],
      },
    }],
  })
  const report = diagnoseOntologyStructure(createOntologyAnalysisIndex(snapshot))
  assert.ok(report.diagnostics.some((item) => item.ruleId === 'duplicate-identity-unknown' && item.status === 'incomplete'))
  assert.ok(!report.diagnostics.some((item) => item.ruleId === 'duplicate-statement' && item.category !== 'unverifiable'))
})

test('quality diagnostics downgrade absence claims on partial sources and cap output deterministically', () => {
  const triples = Array.from({ length: 4 }, (_, index) => ({
    s: 'urn:Unused' + index, p: RDF + 'type', o: OWL + 'Class', oKind: 'iri',
  }))
  const snapshot = createOntologyAnalysisSnapshot({
    revision: 1,
    sources: [{
      sourceId: 'partial', revision: 1, status: 'partial', stale: false,
      parsed: { triples, stats: { truncated: true }, diagnostics: [], warnings: [], errors: [] },
    }],
  })
  const report = diagnoseOntologyStructure(createOntologyAnalysisIndex(snapshot), { maxDiagnostics: 2 })
  assert.equal(report.status, 'partial')
  assert.ok(report.diagnostics.every((item) => item.category === 'suggestion' && item.status === 'partial'))
  assert.equal(report.diagnostics.length, 2)
  assert.equal(report.omitted, report.total - 2)
  assert.deepEqual(report.diagnostics.map((item) => item.ruleId), ['entity-possibly-unused', 'entity-possibly-unused'])
})

test('diagnostics traverse deep subclass chains iteratively and report parse diagnostics', () => {
  const chain = Array.from({ length: 15000 }, (_, i) => ({
    s: 'urn:C' + i, p: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', o: 'urn:C' + (i + 1), oKind: 'iri',
  }))
  const partialWithParseDiagnostic = createOntologyAnalysisSnapshot({ revision: 1, sources: [{
    sourceId: 'deep', revision: 1, status: 'partial', stale: false,
    parsed: { triples: chain, stats: { truncated: false }, diagnostics: [{ code: 'parser-note' }], errors: [], warnings: [] },
  }] })
  const index = createOntologyAnalysisIndex(partialWithParseDiagnostic)
  const report = diagnoseOntologyStructure(index)
  assert.equal(report.diagnostics.some((item) => item.ruleId === 'subclass-cycle-budget'), false)
  const overview = createOntologyOverview(index)
  assert.equal(overview.parseDiagnostics[0].code, 'parser-note')
})

test('overview treats properties as metadata, counts typed individuals, and excludes internal namespaces', () => {
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: [{
    sourceId: 'overview-meta', revision: 1, status: 'ready', stale: false,
    parsed: { stats: { truncated: false }, diagnostics: [], errors: [], warnings: [], triples: [
      { s: 'urn:prop', p: RDF + 'type', o: OWL + 'ObjectProperty', oKind: 'iri' },
      { s: 'urn:dt', p: RDF + 'type', o: OWL + 'DatatypeProperty', oKind: 'iri' },
      { s: 'urn:person', p: RDF + 'type', o: 'urn:Person', oKind: 'iri' },
      { s: '_:b', p: 'urn:p', o: 'urn:o', oKind: 'iri' },
    ] },
  }] })
  const overview = createOntologyOverview(createOntologyAnalysisIndex(snapshot))
  assert.equal(overview.counts.individuals.value, 1)
  assert.equal(overview.namespaces.some((item) => item.namespace.includes('blank')), false)
})

test('diagnostics bound output, isolate list graphs, deduplicate links, and report parser errors', () => {
  const g = (value) => ({ kind: 'iri', value })
  const triples = [
    { s: '_:a', p: RDF + 'first', o: 'urn:A', oKind: 'iri', graph: g('urn:g1') },
    { s: '_:a', p: RDF + 'first', o: 'urn:A', oKind: 'iri', graph: g('urn:g1') },
    { s: '_:a', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri', graph: g('urn:g1') },
    { s: '_:a', p: RDF + 'first', o: 'urn:B', oKind: 'iri', graph: g('urn:g2') },
    { s: '_:a', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri', graph: g('urn:g2') },
    { s: 'urn:p', p: RDF + 'type', o: OWL + 'ObjectProperty', oKind: 'iri' },
    { s: 'urn:p', p: RDF + 'type', o: OWL + 'DatatypeProperty', oKind: 'iri' },
    { s: 'urn:e', p: 'http://www.w3.org/2000/01/rdf-schema#label', o: 'One', oKind: 'literal', lang: 'en' },
    { s: 'urn:e', p: 'http://www.w3.org/2000/01/rdf-schema#label', o: 'Two', oKind: 'literal', lang: 'en' },
    { s: 'urn:e', p: 'http://www.w3.org/2000/01/rdf-schema#label', o: 'Uno', oKind: 'literal', lang: 'es' },
  ]
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: [{ sourceId: 'rules', revision: 1,
    status: 'partial', stale: false, parsed: { triples, stats: { truncated: true },
      diagnostics: [{ code: 'parser-note' }], errors: [{ message: 'bad input' }], warnings: [] } }] })
  const index = createOntologyAnalysisIndex(snapshot)
  const report = diagnoseOntologyStructure(index, { maxDiagnostics: 2 })
  assert.equal(report.diagnostics.length, 2)
  assert.ok(report.total > report.diagnostics.length)
  assert.equal(report.omitted, report.total - report.diagnostics.length)
  const complete = diagnoseOntologyStructure(createOntologyAnalysisIndex(createOntologyAnalysisSnapshot({ revision: 1, sources: [{
    sourceId: 'duplicate', revision: 1, status: 'ready', stale: false,
    parsed: { stats: { truncated: false }, diagnostics: [], errors: [], warnings: [], triples: [
      { s: '_:x', p: RDF + 'first', o: 'urn:A', oKind: 'iri' },
      { s: '_:x', p: RDF + 'first', o: 'urn:A', oKind: 'iri' },
      { s: '_:x', p: RDF + 'rest', o: RDF + 'nil', oKind: 'iri' },
    ] },
  }] })))
  assert.equal(complete.diagnostics.some((item) => item.ruleId === 'rdf-list-multiple-link'), false)
  assert.ok(report.diagnostics.every((item) => item.id))
  assert.ok(report.total >= 1)
  const unbounded = diagnoseOntologyStructure(index, { maxDiagnostics: 200 })
  assert.ok(unbounded.diagnostics.some((item) => item.ruleId === 'property-kind-conflict'))
  assert.ok(unbounded.diagnostics.some((item) => item.ruleId === 'label-conflict'))
  assert.ok(unbounded.diagnostics.some((item) => item.ruleId === 'parse-error'))
  assert.ok(createOntologyOverview(index).parseDiagnostics.some((item) => item.code === 'parse-error'))
})

test('analysis result rejects forged evidence with accepted IDs but altered statements', () => {
  const snapshot = createOntologyAnalysisSnapshot(fixtureWorkspace())
  const accepted = snapshot.statements[0]
  const result = createOntologyAnalysisResult(snapshot, { evidence: [{
    sourceId: accepted.sourceId, revision: accepted.revision, statementId: accepted.statementId,
    s: accepted.s, p: accepted.p, o: 'forged', oKind: accepted.oKind, graph: accepted.graph,
  }] })
  assert.equal(result.evidence.length, 0)
})

test('analysis result preserves only accepted evidence references and never fabricates locations', () => {
  const snapshot = createOntologyAnalysisSnapshot(fixtureWorkspace())
  const result = createOntologyAnalysisResult(snapshot, {
    data: { ruleId: 'list-cycle' },
    evidence: [
      { sourceId: 'src-a', revision: 2, statementId: snapshot.statements[0].statementId, entityId: 'urn:s',
        s: snapshot.statements[0].s, p: snapshot.statements[0].p, o: snapshot.statements[0].o,
        oKind: snapshot.statements[0].oKind, graph: snapshot.statements[0].graph },
      { sourceId: '', statementId: null, location: { line: 10 } },
    ],
  })
  assert.equal(result.snapshotId, snapshot.snapshotId)
  assert.equal(result.status, 'partial')
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].location, null)
})

test('source-scoped blank nodes cannot form cross-file list or restriction structures', () => {
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: ['a', 'b'].map((sourceId) => ({
    sourceId, revision: 1, status: 'ready', parsed: parseOntology(
      '_:b0 <' + RDF + 'first> <urn:' + sourceId + '> ; <' + RDF + 'rest> <' + RDF + 'nil> .', { format: 'turtle' }),
  })) })
  const index = createOntologyAnalysisIndex(snapshot)
  const heads = [...index.rawSubjects.get('_:b0')]
  assert.deepEqual(heads.sort(), [entityKeyForTerm('_:b0', 'a'), entityKeyForTerm('_:b0', 'b')].sort())
  assert.equal(heads.length, 2)
  assert.notEqual(heads[0], heads[1])
  assert.deepEqual(heads.map((id) => inspectOntologyRdfList(index, id).members[0].value).sort(), ['urn:a', 'urn:b'])
  const evidence = inspectOntologyRdfList(index, heads[0]).evidence[0]
  assert.equal(evidence.graph.kind, 'default')
  assert.equal(evidence.raw.s, '_:b0')
})

test('graph ambiguity and unknown graph do not produce complete OWL explanations', () => {
  const triples = restrictionBase([{ s: '_:r', p: OWL + 'someValuesFrom', o: 'urn:A', oKind: 'iri' }])
    .map((row, i) => ({ ...row, graph: i === 0 ? { kind: 'default' } : { kind: 'iri', value: 'urn:g' } }))
  const result = explainOntologyRestriction(restrictionIndex(triples), '_:r')
  assert.equal(result.status, 'incomplete')
  assert.equal(result.data.reason, 'graph-scope-ambiguous')
  const unknown = explainOntologyRestriction(restrictionIndex(triples.map((row) => ({ ...row, graph: { kind: 'unknown' } }))), '_:r')
  assert.equal(unknown.status, 'incomplete')
})

test('actual parser cardinality retains short lexical semantics and qualified conflicts are incomplete', () => {
  const parsed = parseOntology('@prefix owl: <' + OWL + '> . _:r a owl:Restriction ; owl:onProperty <urn:p> ; owl:cardinality "2"^^<' + XSD + 'nonNegativeInteger> .', { format: 'turtle' })
  const snapshot = createOntologyAnalysisSnapshot({ revision: 1, sources: [{ sourceId: 'src', revision: 1, status: 'ready', parsed }] })
  const result = explainOntologyRestriction(createOntologyAnalysisIndex(snapshot), '_:r')
  assert.equal(result.status, 'complete')
  assert.equal(result.data.explanationValues.cardinality, 2)
  assert.equal(result.data.openWorld, true)
  for (const dt of [null, XSD + 'string']) {
    const invalid = explainOntologyRestriction(restrictionIndex(restrictionBase([{ s: '_:r', p: OWL + 'cardinality', o: '2', oKind: 'literal', dt }])), '_:r')
    assert.equal(invalid.status, 'incomplete')
  }
  const qualified = explainOntologyRestriction(restrictionIndex(restrictionBase([
    { s: '_:r', p: OWL + 'qualifiedCardinality', o: '1', oKind: 'literal', dt: XSD + 'nonNegativeInteger' },
    { s: '_:r', p: OWL + 'onClass', o: 'urn:A', oKind: 'iri' },
    { s: '_:r', p: OWL + 'onDataRange', o: XSD + 'integer', oKind: 'iri' },
  ])), '_:r')
  assert.equal(qualified.status, 'incomplete')
})

test('analysis snapshot has stable deterministic serialization', () => {
  const first = createOntologyAnalysisSnapshot(fixtureWorkspace())
  const second = createOntologyAnalysisSnapshot(fixtureWorkspace())
  assert.equal(stableOntologyAnalysisJson(first), stableOntologyAnalysisJson(second))
})
