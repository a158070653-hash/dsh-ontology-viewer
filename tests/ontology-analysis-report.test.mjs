import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeOntologyAnalysisReport } from '../src/ontology-analysis-report.js'

const base = () => ({ scope: { layer: 'L0', sourceIds: ['source'] },
  completeness: { status: 'partial', parseTruncated: true },
  sources: [{ sourceId: 'source', revision: 2 }],
  diagnostics: { diagnostics: [{ ruleId: 'list', category: 'structural', status: 'partial',
    evidence: [{ statementId: 'stmt', sourceId: 'source', revision: 2, graph: { kind: 'iri', value: 'urn:g' } }] }] },
  statements: [{ s: 'urn:s', p: 'urn:p', o: '<script>[x](javascript:evil)</script>', oKind: 'literal',
    dt: 'urn:dt', lang: null, statementId: 'stmt', sourceId: 'source', revision: 2, graph: { kind: 'iri', value: 'urn:g' } }] })

test('JSON report retains valid schema, graph evidence and uncertainty', () => {
  const result = serializeOntologyAnalysisReport(base(), { format: 'json' })
  assert.ok(result.ok)
  const data = JSON.parse(result.text)
  assert.equal(data.schemaVersion, 1)
  assert.equal(data.completeness.status, 'partial')
  assert.equal(data.statements[0].dt, 'urn:dt')
  assert.equal(data.diagnostics.diagnostics[0].evidence[0].graph.value, 'urn:g')
  assert.deepEqual(data.groups.unverifiable, ['list'])
})

test('Markdown keeps hostile RDF strings inert and prints finding classifications', () => {
  const result = serializeOntologyAnalysisReport(base(), { format: 'markdown' })
  assert.ok(result.ok)
  assert.ok(!result.text.includes('<script>'))
  assert.ok(!result.text.includes('[x](javascript:evil)'))
  assert.match(result.text, /&lt;script&gt;/)
  assert.match(result.text, /## Unverifiable checks/)
  assert.match(result.text, /list/)
  assert.match(result.text, /## Limits/)
})

test('UTF8 output cap removes whole records and keeps parseable JSON', () => {
  const report = base()
  report.statements = Array.from({ length: 400 }, (_, i) => ({ ...base().statements[0], statementId: String(i), o: '中文'.repeat(500) }))
  const result = serializeOntologyAnalysisReport(report, { format: 'json', maxBytes: 6000 })
  assert.ok(result.ok)
  assert.ok(result.truncated)
  assert.ok(result.omitted.statements > 0)
  assert.ok(new TextEncoder().encode(result.text).length <= 6000)
  assert.equal(JSON.parse(result.text).scope.layer, 'L0')
  assert.deepEqual(result, serializeOntologyAnalysisReport(report, { format: 'json', maxBytes: 6000 }))
})

test('diagnostic floods cannot remove mandatory scope and source metadata', () => {
  const report = base()
  report.diagnostics.diagnostics = Array.from({ length: 2000 }, (_, index) => ({
    id: String(index), ruleId: 'many', category: 'suggestion', status: 'complete',
    evidence: Array.from({ length: 20 }, () => ({ sourceId: 'source', revision: 2, statementId: 'stmt', extra: 'x'.repeat(100) })),
  }))
  const result = serializeOntologyAnalysisReport(report)
  assert.ok(result.ok)
  const data = JSON.parse(result.text)
  assert.equal(data.scope.layer, 'L0')
  assert.equal(data.sources[0].revision, 2)
  assert.ok(Array.isArray(data.statements))
  assert.ok(data.truncated)
})

test('output trimming keeps every retained statement reference resolvable', () => {
  const report = base()
  report.statements = Array.from({ length: 100 }, (_, index) => ({
    ...base().statements[0], statementId: 's' + index, o: 'x'.repeat(100),
  }))
  report.diagnostics.diagnostics[0].evidence[0].statementId = 's99'
  report.explanations = [{ status: 'complete', evidence: [{ sourceId: 'source', revision: 2, statementId: 's99' }] }]
  const result = serializeOntologyAnalysisReport(report, { maxBytes: 2500 })
  assert.ok(result.ok)
  const data = JSON.parse(result.text)
  const accepted = new Set(data.statements.map((item) => item.statementId))
  for (const claim of [...data.diagnostics.diagnostics, ...data.explanations]) {
    for (const entry of claim.evidence) assert.ok(accepted.has(entry.statementId))
  }
  assert.ok(data.omitted.diagnostics > 0)
  assert.ok(data.omitted.explanations > 0)
})

test('report refuses a cap too small for scope metadata', () => {
  const result = serializeOntologyAnalysisReport(base(), { maxBytes: 10 })
  assert.equal(result.ok, false)
  assert.equal(result.text, '')
})
