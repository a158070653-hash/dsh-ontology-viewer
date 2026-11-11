/**
 * Node tests for the optional Host workspace-files adapter (option A).
 *
 * The real service is exercised only in the live DSH page; these tests pin the
 * defensive normalization and the fallback contract with fake remotes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  WORKSPACE_FILES_LIMITS,
  workspaceFilesApi,
  workspaceFilesTarget,
  normalizeWorkspaceList,
  decodeWorkspaceBytes,
  listWorkspaceDirectory,
  readWorkspaceSource,
} from '../src/ontology-workspace-files.js'

import { parseDshResourceAddress } from '../src/rdf-parse.js'

function fakeApi(overrides) {
  const calls = []
  const api = {
    calls,
    list: async (sessionId, path, signal) => {
      calls.push(['list', sessionId, path, signal])
      return overrides && overrides.list ? overrides.list(sessionId, path, signal) : []
    },
    stat: async (sessionId, path, signal) => {
      calls.push(['stat', sessionId, path, signal])
      return overrides && overrides.stat ? overrides.stat(sessionId, path, signal) : { version: 'v1' }
    },
    readBytes: async (sessionId, path, options, signal) => {
      calls.push(['readBytes', sessionId, path, options, signal])
      return overrides && overrides.readBytes
        ? overrides.readBytes(sessionId, path, options, signal)
        : { bytes: new TextEncoder().encode('@prefix ex: <http://e/> .'), offset: 0, eof: true, version: 'v1' }
    },
  }
  return api
}

test('workspace-files: capability detection accepts ctx.remote and ctx.get("remote")', () => {
  const api = fakeApi()
  assert.ok(workspaceFilesApi({ remote: { workspaceFiles: api } }))
  assert.ok(workspaceFilesApi({ get: (name) => (name === 'remote' ? { workspaceFiles: api } : null) }))
  assert.equal(workspaceFilesApi({}), null)
  assert.equal(workspaceFilesApi(null), null)
  assert.equal(workspaceFilesApi({ remote: { workspaceFiles: { list() {} } } }), null, 'readBytes is required')
})

test('workspace-files: a Cordis guard that throws on service access degrades to null', () => {
  const guarded = {}
  Object.defineProperty(guarded, 'remote', {
    get() {
      throw new Error('cannot get property "remote" without inject')
    },
  })
  assert.doesNotThrow(() => workspaceFilesApi(guarded))
  assert.equal(workspaceFilesApi(guarded), null)
  // ctx.get may also refuse; the probe must not escape either.
  const refused = { get() { throw new Error('not injected') } }
  assert.equal(workspaceFilesApi(refused), null)
  // A reflect facade that throws must be skipped as well.
  const reflectBroken = { reflect: { get() { throw new Error('broken') } } }
  assert.equal(workspaceFilesApi(reflectBroken), null)
})

test('workspace-files: DSH routes yield the authorizing session and path', () => {
  const target = workspaceFilesTarget('dsh-resource://file/session/session-1/examples/pizza.ttl', parseDshResourceAddress)
  assert.deepEqual(target, { sessionId: 'session-1', path: 'examples/pizza.ttl' })
  assert.equal(workspaceFilesTarget('file:///D:/x.ttl', parseDshResourceAddress), null)
  assert.equal(workspaceFilesTarget('dsh-resource://file/session//x.ttl', parseDshResourceAddress), null)
  assert.equal(workspaceFilesTarget('', parseDshResourceAddress), null)
})

test('workspace-files: list results are normalized, sorted and truncated', () => {
  const normalized = normalizeWorkspaceList({
    entries: [
      { name: 'z.ttl', size: '12' },
      { name: 'dir', kind: 'directory' },
      { path: 'a/b/people.nt', size: 34 },
      { nonsense: true },
    ],
  })
  assert.deepEqual(normalized.entries.map((entry) => entry.name), ['dir', 'people.nt', 'z.ttl'])
  assert.equal(normalized.entries[0].isDirectory, true)
  assert.equal(normalized.entries[2].size, 12)
  assert.equal(normalizeWorkspaceList(null).entries.length, 0)
  assert.equal(normalizeWorkspaceList({ entries: [], truncated: true }).truncated, true)
})

test('workspace-files: readBytes must be complete and inside budget', () => {
  const ok = decodeWorkspaceBytes({
    bytes: new TextEncoder().encode('hello'),
    offset: 0,
    eof: true,
    version: 'v1',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.text, 'hello')
  assert.equal(decodeWorkspaceBytes({ bytes: new Uint8Array([104]), offset: 1, eof: true }).reason, 'partial-read')
  assert.equal(decodeWorkspaceBytes({ bytes: new Uint8Array([104]), offset: 0, eof: false }).reason, 'partial-read')
  assert.equal(decodeWorkspaceBytes({ bytes: null }).reason, 'no-bytes')
  assert.equal(decodeWorkspaceBytes({ error: 'denied' }).reason, 'denied')
  const big = new Uint8Array(WORKSPACE_FILES_LIMITS.maxReadBytes + 1)
  assert.equal(decodeWorkspaceBytes({ bytes: big, offset: 0, eof: true }).reason, 'too-large')
})

test('workspace-files: list and read surface authorization failures as reasons', async () => {
  const api = fakeApi({
    list: () => {
      throw new Error('session not authorized')
    },
    stat: () => ({ error: 'not found' }),
  })
  const listed = await listWorkspaceDirectory(api, 's1', '.', undefined)
  assert.equal(listed.ok, false)
  assert.equal(listed.reason, 'session not authorized')
  const read = await readWorkspaceSource(api, 's1', 'examples/pizza.ttl', undefined)
  assert.equal(read.ok, false)
  assert.equal(read.reason, 'not found')
  assert.equal((await listWorkspaceDirectory(null, 's1', '.')).reason, 'unavailable')
})

test('workspace-files: a version change is retried once and then reported', async () => {
  let version = 'v1'
  const api = fakeApi({
    stat: async () => ({ version, absolutePath: 'D:/w/examples/pizza.ttl' }),
    readBytes: async () => ({ bytes: new TextEncoder().encode('x'), offset: 0, eof: true, version }),
  })
  version = 'v2'
  const read = await readWorkspaceSource(api, 's1', 'examples/pizza.ttl')
  assert.equal(read.ok, true, 'the retry sees the new version and succeeds')
  assert.equal(read.absolutePath, 'D:/w/examples/pizza.ttl')

  let reads = 0
  const api2 = fakeApi({
    stat: async () => ({ version: 'v1' }),
    readBytes: async () => {
      reads += 1
      return { bytes: new TextEncoder().encode('x'), offset: 0, eof: true, version: reads === 1 ? 'v2' : 'v3' }
    },
  })
  const changed = await readWorkspaceSource(api2, 's1', 'examples/pizza.ttl')
  assert.equal(changed.ok, false)
  assert.equal(changed.reason, 'changed-during-read')
})
