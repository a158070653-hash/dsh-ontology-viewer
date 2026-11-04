// Build the prebuilt storefront tarball attached to a GitHub Release.
//
// The release asset must have a VERSION-FREE name so that
//   https://github.com/<owner>/<repo>/releases/latest/download/dsh-ontology-viewer.tgz
// keeps working after the next release (a versioned name would 404 silently).
//
// Usage (from the package root): node scripts/pack-release.mjs
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSET = 'dsh-ontology-viewer.tgz'

for (const name of readdirSync(root)) {
  if (name === ASSET || /^dsh-ontology-viewer-\d[^/]*\.tgz$/.test(name)) rmSync(path.join(root, name), { force: true })
}

execSync('npm pack --pack-destination .', { cwd: root, stdio: 'inherit' })

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const packed = path.join(root, `dsh-ontology-viewer-${version}.tgz`)
const asset = path.join(root, ASSET)
renameSync(packed, asset)

const size = statSync(asset).size
console.log(`\nbuilt ${ASSET} (${(size / 1024).toFixed(1)} KiB, version ${version})`)
console.log('attach it to the release with a version-free asset name:')
console.log(`  gh release upload v${version} ${ASSET} --clobber`)
console.log('users then install it with:')
console.log(`  dsh plugin --profile <profile> add https://github.com/a158070653-hash/dsh-ontology-viewer/releases/latest/download/${ASSET}`)
