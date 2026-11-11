// Verify that every translation key the plugin UI asks for exists in both
// dictionaries registered by src/main.js.
// Usage (from the plugin package root): node scripts/check-i18n.mjs
//
// Scans every UI module that renders text (`src/graph-view*.js` and
// `src/main.js`), plus the dynamic key families the view builds at runtime.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = readFileSync(path.join(root, 'src/main.js'), 'utf8')

const uiFiles = readdirSync(path.join(root, 'src'))
  .filter((name) => /^graph-view.*\.js$/.test(name) || name === 'main.js')
  .map((name) => ({ name, source: readFileSync(path.join(root, 'src', name), 'utf8') }))

const staticKeys = new Set()
for (const file of uiFiles) {
  // Static lookups: tr('key'), t('key'), and t('key', fallback).
  for (const match of file.source.matchAll(/\b(?:tr|t)\('([a-zA-Z0-9_.]+)'/g)) {
    const key = match[1]
    // Dynamic patterns such as tr('viewer.' + kind) yield the bare prefix.
    if (!key.endsWith('.')) staticKeys.add(key)
  }
}

// Dynamic families built at runtime with string concatenation.
for (const kind of ['class', 'property', 'individual', 'blank', 'external']) staticKeys.add('viewer.kind.' + kind)
for (const stat of ['nodes', 'edges', 'triples']) staticKeys.add('viewer.' + stat)
for (const field of ['outEdges', 'inEdges', 'degree']) staticKeys.add('viewer.' + field)
for (const direction of ['both', 'out', 'in']) staticKeys.add('viewer.direction.' + direction)
for (const group of ['type', 'literals', 'out', 'in']) staticKeys.add('viewer.group.' + group)
for (const status of ['ready', 'partial', 'empty', 'error', 'rejected']) {
  staticKeys.add('source.status.' + status)
}
for (const origin of ['host', 'browser']) staticKeys.add('source.origin.' + origin)
for (const graphKind of ['default', 'iri', 'blank', 'unknown']) {
  staticKeys.add('provenance.graph.' + graphKind)
}
for (const code of [
  'base-unavailable',
  'named-graph-ignored',
  'jsonld-remote-context-skipped',
  'jsonld-node-reverse-ignored',
  'jsonld-included-nest-ignored',
  'jsonld-value-object-dropped',
  'jsonld-graph-sibling-ignored',
  'jsonld-container-unsupported',
  'jsonld-reverse-term-forward',
  'rdfxml-reification-ignored',
  'rdfxml-parsetype-unsupported',
  'rdfxml-multiple-objects',
  'nesting-limit',
  'literal-limit',
  'triple-limit',
  'diagnostics-truncated',
]) staticKeys.add('diag.' + code)

const zhBlock = main.slice(main.indexOf('const ZH = {'), main.indexOf('const EN = {'))
const enBlock = main.slice(main.indexOf('const EN = {'), main.indexOf('/**\n * Translate'))
const keysOf = (block) => new Set([...block.matchAll(/'([a-zA-Z0-9_.-]+)':/g)].map((match) => match[1]))
const zhKeys = keysOf(zhBlock)
const enKeys = keysOf(enBlock)

const missingZh = [...staticKeys].filter((key) => !zhKeys.has(key))
const missingEn = [...staticKeys].filter((key) => !enKeys.has(key))
const zhOnly = [...zhKeys].filter((key) => !enKeys.has(key))
const enOnly = [...enKeys].filter((key) => !zhKeys.has(key))

console.log('scanned files:', uiFiles.map((file) => file.name).join(', '))
console.log('view keys:', staticKeys.size, '| ZH entries:', zhKeys.size, '| EN entries:', enKeys.size)
console.log('missing in ZH:', missingZh.length ? missingZh : 'none')
console.log('missing in EN:', missingEn.length ? missingEn : 'none')
console.log('only in ZH:', zhOnly.length ? zhOnly : 'none')
console.log('only in EN:', enOnly.length ? enOnly : 'none')
if (missingZh.length || missingEn.length || zhOnly.length || enOnly.length) process.exitCode = 1
