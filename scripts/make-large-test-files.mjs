import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'examples')
const mib = 1024 * 1024
const header = Buffer.from(
  '# dsh-ontology-viewer generated size-boundary fixture\n' +
  '@prefix ex: <http://example.org/test/> .\n' +
  'ex:subject ex:label "',
  'ascii',
)
const suffix = Buffer.from('" .\n', 'ascii')

await mkdir(outputDir, { recursive: true })
for (const [name, size] of [
  ['near-5MiB.ttl', 5 * mib],
  ['over-5MiB.ttl', 5 * mib + 1],
  ['near-12MiB.ttl', 12 * mib],
  ['over-12MiB.ttl', 12 * mib + 1],
]) {
  const fillerSize = size - header.length - suffix.length
  const body = Buffer.alloc(fillerSize, 0x78)
  const content = Buffer.concat([header, body, suffix], size)
  const target = path.join(outputDir, name)
  await writeFile(target, content)
  const actual = (await stat(target)).size
  if (actual !== size) throw new Error(`${name}: expected ${size} bytes, wrote ${actual}`)
  console.log(`${target}: ${actual} bytes`)
}
