#!/usr/bin/env node
/**
 * Build the single browser Client module from the ES-module sources in `src/`.
 *
 * DSH serves one plain-JS file per Client module (`dsh.client` -> `./client`),
 * and the browser module table only resolves packages such as `react`, not
 * relative imports. So the sources stay normal ES modules -- Node tests import
 * them directly -- and this script concatenates them inside the lazy factory
 * after stripping their `import`/`export` syntax.
 *
 * The background-compute worker is embedded the same way: `WORKER_MODULES`
 * (parser + graph model + worker entry point) are transformed with the same
 * rules, wrapped in an IIFE and embedded as a `const ONTOLOGY_WORKER_SOURCE`
 * string immediately before the `src/ontology-job.js` block inside the
 * factory. The plugin then creates a classic Blob Worker from that string, so
 * no second runtime resource file (and no extra request) is needed. The
 * embedded source is generated deterministically from the same files, which is
 * what makes `--check` cover it.
 *
 * Usage: node build/build.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ID = 'dsh-ontology-viewer'
const OUTPUT = path.join(root, 'client.js')

/**
 * Concatenation order; every module must be self-contained (no relative
 * imports). `const` initialization order matters: a module must come before
 * the modules that reference it. `src/ontology-job.js` must stay directly
 * after the graph/workspace modules because the build embeds the worker source
 * right before it.
 */
const MODULES = [
  'src/rdf-parse.js',
  'src/ontology-identity.js',
  'src/ontology-workspace-files.js',
  'src/ontology-workspace-registry.js',
  'src/ontology-view-state.js',
  'src/ontology-file-queue.js',
  'src/graph-model.js',
  'src/ontology-workspace.js',
  'src/ontology-views.js',
  'src/graph-export.js',
  'src/ontology-job.js',
  'src/graph-view-style.js',
  'src/graph-view-controls.js',
  'src/graph-view-details.js',
  'src/graph-view.js',
  'src/graph-view-multiview.js',
  'src/graph-view-workspace.js',
  'src/main.js',
]

/**
 * Sources of the embedded worker script, in closure order. `src/worker-entry.js`
 * is never part of the main factory; it only exists in this list.
 */
const WORKER_MODULES = [
  'src/rdf-parse.js',
  'src/ontology-identity.js',
  'src/graph-model.js',
  'src/ontology-workspace.js',
  'src/ontology-views.js',
  'src/worker-entry.js',
]

const importLine = /^\s*import\s[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm
const bareImportLine = /^\s*import\s*['"][^'"]+['"]\s*;?\s*$/gm
const exportDefault = /^export\s+default\s+/gm
const exportPrefix = /^export\s+/gm

/** Strip ES-module syntax and reject the constructs a closure cannot support. */
export function transform(name, source) {
  if (/\bexport\s+default\b/.test(source)) throw new Error(`${name}: use named exports only`)
  if (/^\s*import\s/m.test(source)) throw new Error(`${name}: relative/package imports are not allowed in a concatenated Client module`)
  const code = source
    .replace(/\r\n?/g, '\n')
    .replace(exportDefault, '')
    .replace(exportPrefix, '')
  if (/^\s*export\b/m.test(code)) throw new Error(`${name}: unsupported export syntax (use "export function/const/class")`)
  return code.trim()
}

/** Read + transform one source module. */
function readTransformed(baseDir, relative) {
  const source = readFileSync(path.join(baseDir, relative), 'utf8')
  return transform(relative, source)
}

/** Indent a module body to live one level inside the module factory. */
function indentBlock(code) {
  return code
    .split('\n')
    .map((line) => (line.length ? `\t\t${line}` : ''))
    .join('\n')
}

/**
 * Deterministically generate the embedded worker script.
 *
 * The worker is a classic script, not a module: everything is concatenated in
 * one IIFE (`self.onmessage` is the entry point) and `parseOntology`,
 * `buildGraph`, `layoutGraph` stay ordinary identifiers in that closure.
 */
export function buildWorkerSource(baseDir = root) {
  const sources = WORKER_MODULES.map((relative) => {
    const code = readTransformed(baseDir, relative)
    return `// ==== ${relative} ====\n${code}`
  }).join('\n\n')
  return '(function () {\n\'use strict\';\n' + sources + '\n})();'
}

/**
 * Assemble the complete `client.js` text without writing it.
 *
 * Kept as an exported pure builder so the build logic can be exercised from a
 * scratch harness without touching the generated artifact.
 */
export function buildBundle(options = {}) {
  const baseDir = options.root ? path.resolve(options.root) : root
  const modules = Array.isArray(options.modules) ? options.modules : MODULES
  const workerSource = buildWorkerSource(baseDir)

  const parts = modules.map((relative) => {
    const code = readTransformed(baseDir, relative)
    const block = `\t\t// ==== ${relative} ====\n${indentBlock(code)}`
    if (relative === 'src/ontology-job.js') {
      return `\t\t// ==== embedded worker source (generated from ${WORKER_MODULES.join(', ')}) ====\n` +
        `\t\tconst ONTOLOGY_WORKER_SOURCE = ${JSON.stringify(workerSource)};\n\n` +
        block
    }
    return block
  })

  return `/**
 * dsh-ontology-viewer -- Client module (generated by build/build.mjs, do not edit).
 *
 * Registers the ontology graph renderer into DSH's right-sidebar document
 * preview (ctx.documentPreviews) and, when dsh-better-sidebar is installed,
 * a file viewer + file icon for ontology files (ctx.betterSidebar).
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory(require) {
    const React = require('react');
    const h = React.createElement;

${parts.join('\n\n')}

    return {
      name: ${JSON.stringify(PACKAGE_ID)},
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
`
}

/** True when this file was started as a script (`node build/build.mjs`). */
function invokedDirectly() {
  try {
    if (!process.argv[1]) return false
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

// Execute only as a script: importing the module (e.g. from a scratch harness)
// must not read or write `client.js`.
if (invokedDirectly()) {
  const bundle = buildBundle()
  const checkOnly = process.argv.includes('--check')
  if (checkOnly) {
    const current = readFileSync(OUTPUT, 'utf8')
    if (current !== bundle) {
      console.error('client.js is out of date; run: node build/build.mjs')
      process.exit(1)
    }
    console.log(`client.js is up to date (${bundle.length} bytes)`)
  } else {
    writeFileSync(OUTPUT, bundle)
    console.log(`wrote ${path.relative(root, OUTPUT)} (${bundle.length} bytes)`)
  }
}
