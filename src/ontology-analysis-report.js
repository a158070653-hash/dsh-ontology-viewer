/** Browser-local, bounded report serialization. No DOM, IO, or runtime imports. */
export function serializeOntologyAnalysisReport(input, options) {
  const opts = options || {}
  const format = opts.format === 'markdown' ? 'markdown' : 'json'
  const maxBytes = Number.isSafeInteger(opts.maxBytes)
    ? Math.max(0, Math.min(opts.maxBytes, 1024 * 1024)) : 256 * 1024
  const bytes = (text) => new TextEncoder().encode(text).length
  const omitted = { values: 0, items: 0, diagnostics: 0, explanations: 0, statements: 0 }
  let nodes = 0
  // Bound traversal and copied text BEFORE stringify. Omitted content is always
  // recorded; a summary string can never masquerade as a full RDF lexical value.
  function copy(value, depth) {
    if (++nodes > 30000 || depth > 16) { omitted.values++; return null }
    if (typeof value === 'string') {
      if (value.length > 16384) {
        omitted.values++
        return { omitted: true, reason: 'report-string-budget', originalLength: value.length }
      }
      return value
    }
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (Array.isArray(value)) {
      const count = Math.min(value.length, 2000)
      omitted.items += value.length - count
      const result = []
      for (let i = 0; i < count && nodes < 30000; i++) result.push(copy(value[i], depth + 1))
      omitted.items += count - result.length
      return result
    }
    if (value && typeof value === 'object') {
      const result = Object.create(null)
      const keys = Object.keys(value).sort()
      const count = Math.min(keys.length, 100)
      omitted.values += keys.length - count
      let copied = 0
      for (; copied < count && nodes < 30000; copied++) {
        const key = keys[copied]
        if (key === 'location') { result.location = null; continue }
        if (value[key] !== undefined) result[key] = copy(value[key], depth + 1)
      }
      omitted.values += count - copied
      return result
    }
    return null
  }
  const source = input && typeof input === 'object' ? input : {}
  // Scope and source revisions are mandatory. Copy them before optional trees
  // so diagnostic floods cannot consume their traversal allocation.
  const report = Object.create(null)
  report.scope = copy(source.scope || { layer: 'L0', sourceIds: [] }, 0)
  report.completeness = copy(source.completeness || { status: 'unavailable' }, 0)
  report.sources = copy(source.sources || [], 0)
  if (omitted.values || omitted.items || nodes > 8000) {
    return { ok: false, text: '', reason: 'report-metadata-budget', omitted, truncated: true }
  }
  report.generatedAt = typeof source.generatedAt === 'string' ? copy(source.generatedAt, 0) : null
  // Accepted statements precede claims: a claim without its retained evidence
  // is removed below rather than exported with a dangling statement reference.
  report.statements = copy(Array.isArray(source.statements) ? source.statements : [], 0)
  report.overview = copy(source.overview || null, 0)
  report.explanations = copy(Array.isArray(source.explanations) ? source.explanations : [], 0)
  if (!Array.isArray(report.explanations)) report.explanations = []
  report.diagnostics = copy(source.diagnostics || { diagnostics: [] }, 0)
  if (!report.diagnostics || typeof report.diagnostics !== 'object') report.diagnostics = { diagnostics: [] }
  report.schemaVersion = 1
  report.omitted = omitted
  report.truncated = false
  report.limitations = 'Accepted local L0 data only; no OWL reasoner, consistency verdict, SHACL validation, or recorded statement positions.'
  const diagnostics = report.diagnostics && !Array.isArray(report.diagnostics)
    ? report.diagnostics.diagnostics : report.diagnostics
  const findings = Array.isArray(diagnostics) ? diagnostics : []
  const referenceKey = (item) => item && typeof item.sourceId === 'string' &&
    typeof item.statementId === 'string' && Number.isSafeInteger(item.revision)
    ? JSON.stringify([item.sourceId, item.revision, item.statementId]) : null
  const sourceKeys = new Set(report.sources.map((item) => JSON.stringify([item.sourceId, item.revision])))
  // Drop incomplete copied records; never call a partially copied RDF row an
  // accepted statement. The omission count marks the report partial.
  report.statements = report.statements.filter((item) => {
    const valid = referenceKey(item) && typeof item.s === 'string' && typeof item.p === 'string' &&
      typeof item.o === 'string' && typeof item.oKind === 'string' &&
      sourceKeys.has(JSON.stringify([item.sourceId, item.revision]))
    if (!valid) omitted.statements++
    return valid
  })
  function retainEvidenceClosure() {
    const accepted = new Set(report.statements.map(referenceKey))
    const referencesResolve = (value, depth) => {
      if (value === null || typeof value !== 'object') return true
      if (depth > 16) return false
      if (Object.prototype.hasOwnProperty.call(value, 'statementId') && !accepted.has(referenceKey(value))) return false
      return Object.values(value).every((child) => referencesResolve(child, depth + 1))
    }
    for (const [name, list] of [['diagnostics', findings], ['explanations', report.explanations]]) {
      if (!Array.isArray(list)) continue
      for (let index = list.length - 1; index >= 0; index--) {
        if (!list[index] || !referencesResolve(list[index], 0)) { list.splice(index, 1); omitted[name]++ }
      }
    }
    if (report.overview && !referencesResolve(report.overview, 0)) { report.overview = null; omitted.values++ }
  }
  retainEvidenceClosure()
  const refreshGroups = () => {
    const currentDiagnostics = report.diagnostics && !Array.isArray(report.diagnostics)
      ? report.diagnostics.diagnostics : report.diagnostics
    const current = Array.isArray(currentDiagnostics) ? currentDiagnostics : []
    const groups = {
      confirmed: current.filter((item) => item && item.category === 'structural' && item.status === 'complete'),
      suggestions: current.filter((item) => item && item.category === 'suggestion'),
      unverifiable: current.filter((item) => item && (item.category === 'unverifiable' ||
        (item.category === 'structural' && item.status !== 'complete'))),
      parse: current.filter((item) => item && item.category === 'parse'),
    }
    report.groups = Object.fromEntries(Object.entries(groups)
      .map(([key, items]) => [key, items.map((item) => item.id || item.ruleId)]))
  }
  refreshGroups()
  const escape = (value) => String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|])/g, '\\$1')
  function markdown() {
    const lines = ['# Ontology analysis report', '',
      'Scope: ' + escape(JSON.stringify(report.scope)),
      'Completeness: ' + escape(JSON.stringify(report.completeness)), '',
      '## Overview', '', escape(JSON.stringify(report.overview)), '',
      '## Semantic explanations', '']
    for (const item of report.explanations || []) lines.push('- ' + escape(JSON.stringify(item)))
    const currentDiagnostics = report.diagnostics && !Array.isArray(report.diagnostics)
      ? report.diagnostics.diagnostics : report.diagnostics
    const currentFindings = Array.isArray(currentDiagnostics) ? currentDiagnostics : []
    const categories = [
      ['confirmed', 'Confirmed structural findings', (item) => item && item.category === 'structural' && item.status === 'complete'],
      ['suggestions', 'Suggestions', (item) => item && item.category === 'suggestion'],
      ['unverifiable', 'Unverifiable checks', (item) => item && (item.category === 'unverifiable' ||
        (item.category === 'structural' && item.status !== 'complete'))],
      ['parse', 'Parser diagnostics', (item) => item && item.category === 'parse'],
    ]
    for (const [_key, title, include] of categories) {
      lines.push('', '## ' + title, '')
      for (const item of currentFindings) if (include(item)) lines.push('- ' + escape(JSON.stringify(item)))
    }
    lines.push('', '## Sources', '', escape(JSON.stringify(report.sources)),
      '', '## Statement evidence', '')
    for (const item of report.statements || []) lines.push('- ' + escape(JSON.stringify(item)))
    lines.push('', '## Limits', '', escape(report.limitations),
      '', 'Truncated: ' + report.truncated, '', 'Omitted: ' + escape(JSON.stringify(omitted)))
    return lines.join('\n')
  }
  function output() {
    retainEvidenceClosure()
    refreshGroups()
    report.truncated = Object.values(omitted).some((value) => value > 0)
    if (report.truncated) report.reportCompleteness = 'partial'
    return format === 'json' ? JSON.stringify(report, null, 2) : markdown()
  }
  let text = output()
  // Remove complete records, never slice a JSON document. Explicit limits on
  // copied arrays make the retry loop finite regardless of input size.
  const lists = [
    ['statements', report.statements], ['diagnostics', findings], ['explanations', report.explanations],
  ]
  for (const [name, list] of lists) {
    if (!Array.isArray(list)) continue
    while (bytes(text) > maxBytes && list.length) {
      const remove = Math.max(1, Math.ceil(list.length / 2))
      list.splice(list.length - remove, remove)
      omitted[name] += remove
      refreshGroups()
      text = output()
    }
  }
  if (bytes(text) > maxBytes && report.overview) { report.overview = null; omitted.values++; text = output() }
  if (bytes(text) > maxBytes) return { ok: false, text: '', reason: 'report-metadata-budget', omitted, truncated: true }
  return { ok: true, text, mime: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
    omitted, truncated: report.truncated, byteLength: bytes(text) }
}
