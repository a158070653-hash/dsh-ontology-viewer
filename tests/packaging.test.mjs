/**
 * Packaging invariants that the product promises and tests must guard:
 * zero runtime dependencies, no network APIs in the shipped sources, and every
 * source module wired into the single-file build.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

test('the plugin declares no runtime or peer dependencies', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies || {}, {})
  assert.deepEqual(pkg.peerDependencies || {}, {})
  assert.deepEqual(pkg.optionalDependencies || {}, {})
})

test('shipped sources never call a network API', () => {
  const dir = path.join(root, 'src')
  const offenders = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(path.join(dir, name), 'utf8')
    for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/]) {
      if (pattern.test(text)) offenders.push(name + ':' + String(pattern))
    }
  }
  assert.deepEqual(offenders, [])
})

test('every source module is listed in the single-file build order', () => {
  const build = readFileSync(path.join(root, 'build', 'build.mjs'), 'utf8')
  const listed = new Set(Array.from(build.matchAll(/'src\/([a-z0-9-]+\.js)'/g), (match) => match[1]))
  const sources = readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js')).sort()
  const missing = sources.filter((name) => !listed.has(name))
  assert.deepEqual(missing, [], 'a source file exists but is not concatenated into client.js')
})

test('the built client is one closed module with no leftover import syntax', () => {
  const client = readFileSync(path.join(root, 'client.js'), 'utf8')
  assert.equal(/^\s*import\s/m.test(client), false)
  assert.equal(/^\s*export\s/m.test(client), false)
  assert.ok(client.includes('__ModuleLoader__'))
})
