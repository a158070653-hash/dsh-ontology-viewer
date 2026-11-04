// Verify that every translation key the graph view asks for exists in both
// dictionaries registered by src/main.js.
// Usage (from the plugin package root): node scripts/check-i18n.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const view = readFileSync(path.join(root, 'src/graph-view.js'), 'utf8')
const main = readFileSync(path.join(root, 'src/main.js'), 'utf8')

const staticKeys = new Set(
  [...view.matchAll(/tr\('([a-zA-Z0-9_.]+)'/g)]
    .map((match) => match[1])
    // Dynamic patterns such as tr('viewer.' + statKey) yield the bare prefix.
    .filter((key) => !key.endsWith('.')),
)
for (const kind of ['class', 'property', 'individual', 'blank', 'external']) staticKeys.add('viewer.kind.' + kind)
for (const stat of ['nodes', 'edges', 'triples']) staticKeys.add('viewer.' + stat)
for (const field of ['outEdges', 'inEdges', 'degree']) staticKeys.add('viewer.' + field)

const zhBlock = main.slice(main.indexOf('const ZH = {'), main.indexOf('const EN = {'))
const enBlock = main.slice(main.indexOf('const EN = {'), main.indexOf('/**\n * Translate'))
const keysOf = (block) => new Set([...block.matchAll(/'([a-zA-Z0-9_.]+)':/g)].map((match) => match[1]))
const zhKeys = keysOf(zhBlock)
const enKeys = keysOf(enBlock)

const missingZh = [...staticKeys].filter((key) => !zhKeys.has(key))
const missingEn = [...staticKeys].filter((key) => !enKeys.has(key))
console.log('view keys:', staticKeys.size, '| ZH entries:', zhKeys.size, '| EN entries:', enKeys.size)
console.log('missing in ZH:', missingZh.length ? missingZh : 'none')
console.log('missing in EN:', missingEn.length ? missingEn : 'none')
if (missingZh.length || missingEn.length) process.exitCode = 1
