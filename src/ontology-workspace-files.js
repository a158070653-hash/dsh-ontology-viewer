/**
 * Optional Host "workspace files" adapter (option A).
 *
 * The Host service `remote.workspaceFiles` is optional and its wire results are
 * not part of this plugin's contract, so every entry point is defensive: the
 * capability is detected rather than assumed, list results are normalized, and
 * any failure returns a structured reason instead of throwing. Callers must keep
 * the local-file path (option B) working when this adapter is unavailable.
 */

export const WORKSPACE_FILES_LIMITS = {
  maxEntries: 400,
  maxReadBytes: 24 * 1024 * 1024,
}

function workspaceFilesIsObject(value) {
  return value !== null && typeof value === 'object'
}

/** Read one property without letting a Cordis service guard escape. */
function workspaceFilesRead(object, key) {
  try {
    return workspaceFilesIsObject(object) ? object[key] : undefined
  } catch (error) {
    // A Cordis context without `inject` throws on service access by design.
    return undefined
  }
}

/**
 * Pull a usable `{ list, stat, readBytes }` facade out of a Cordis context.
 *
 * Every read is guarded: this module is used during render, so a blocked or
 * throwing service lookup must degrade to "unavailable" instead of breaking the
 * panel. Without an `inject` declaration the Host may refuse `remote`
 * access, and that refusal is the expected fallback signal (option B).
 */
export function workspaceFilesApi(ctx) {
  try {
    if (!workspaceFilesIsObject(ctx)) return null
    const candidates = []
    const direct = workspaceFilesRead(ctx, 'remote')
    if (direct) candidates.push(direct)
    if (typeof ctx.get === 'function') {
      try {
        const remote = ctx.get('remote')
        if (remote) candidates.push(remote)
      } catch (error) {
        // ignore: service not injected
      }
    }
    const reflect = workspaceFilesRead(ctx, 'reflect')
    if (reflect && typeof reflect.get === 'function') {
      try {
        const remote = reflect.get('remote')
        if (remote) candidates.push(remote)
      } catch (error) {
        // ignore: service not injected
      }
    }
    for (const remote of candidates) {
      const api = workspaceFilesRead(remote, 'workspaceFiles')
      if (!workspaceFilesIsObject(api) || typeof api.list !== 'function' || typeof api.readBytes !== 'function') continue
      return {
        list: api.list.bind(api),
        stat: typeof api.stat === 'function' ? api.stat.bind(api) : null,
        readBytes: api.readBytes.bind(api),
      }
    }
  } catch (error) {
    return null
  }
  return null
}

/** Split a DSH route into the session + path the Host service expects. */
export function workspaceFilesTarget(address, addressParser) {
  if (typeof address !== 'string' || address === '') return null
  const parser = typeof addressParser === 'function'
    ? addressParser
    : (typeof parseDshResourceAddress === 'function' ? parseDshResourceAddress : null)
  if (!parser) return null
  const parsed = parser(address)
  if (!parsed || typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null
  if (typeof parsed.path !== 'string' || !parsed.path) return null
  return { sessionId: parsed.sessionId, path: parsed.path }
}

/** Normalize one list() result into sorted `{ name, path, isDirectory, size }`. */
export function normalizeWorkspaceList(result) {
  const raw = Array.isArray(result)
    ? result
    : (workspaceFilesIsObject(result) && Array.isArray(result.entries) ? result.entries : [])
  const entries = []
  for (const item of raw) {
    if (!workspaceFilesIsObject(item)) continue
    const name = typeof item.name === 'string' && item.name
      ? item.name
      : (typeof item.path === 'string' ? item.path.split('/').filter(Boolean).pop() : '')
    if (!name) continue
    const path = typeof item.path === 'string' && item.path ? item.path : name
    const isDirectory = item.isDirectory === true || item.kind === 'directory' || item.type === 'directory'
    entries.push({ name: name, path: path, isDirectory: isDirectory, size: Number(item.size) || 0 })
    if (entries.length >= WORKSPACE_FILES_LIMITS.maxEntries) break
  }
  entries.sort(function (a, b) {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  const truncated = raw.length > entries.length || (workspaceFilesIsObject(result) && result.truncated === true)
  return { entries: entries, truncated: truncated }
}

/** Decode a readBytes() result; only a complete, in-budget payload passes. */
export function decodeWorkspaceBytes(result) {
  if (!workspaceFilesIsObject(result)) return { ok: false, reason: 'read-failed' }
  if (result.error) return { ok: false, reason: String(result.error) }
  let bytes = null
  if (result.bytes instanceof Uint8Array) bytes = result.bytes
  else if (result.bytes instanceof ArrayBuffer) bytes = new Uint8Array(result.bytes)
  if (!bytes) return { ok: false, reason: 'no-bytes' }
  if (bytes.byteLength > WORKSPACE_FILES_LIMITS.maxReadBytes) return { ok: false, reason: 'too-large' }
  if (Number(result.offset) > 0 || result.eof === false) return { ok: false, reason: 'partial-read' }
  let text = ''
  try {
    text = new TextDecoder('utf-8').decode(bytes)
  } catch (error) {
    return { ok: false, reason: 'decode-failed' }
  }
  return { ok: true, text: text, byteSize: bytes.byteLength, version: result.version }
}

/** List one directory; returns `{ok, entries, truncated}` or `{ok:false, reason}`. */
export async function listWorkspaceDirectory(api, sessionId, directory, signal) {
  if (!api || typeof api.list !== 'function') return { ok: false, reason: 'unavailable' }
  try {
    const result = await api.list(sessionId, directory, signal)
    const normalized = normalizeWorkspaceList(result)
    return { ok: true, entries: normalized.entries, truncated: normalized.truncated }
  } catch (error) {
    return { ok: false, reason: error && error.message ? String(error.message) : 'list-failed' }
  }
}

/**
 * Read one Host file with the design contract: stat → readBytes(eof) → stat
 * again; a version change is retried once and then reported, never hidden.
 */
export async function readWorkspaceSource(api, sessionId, path, signal) {
  if (!api || typeof api.readBytes !== 'function') return { ok: false, reason: 'unavailable' }
  let before = null
  if (typeof api.stat === 'function') {
    try {
      const stat = await api.stat(sessionId, path, signal)
      if (workspaceFilesIsObject(stat)) before = stat
      if (workspaceFilesIsObject(stat) && stat.error) return { ok: false, reason: String(stat.error) }
    } catch (error) {
      return { ok: false, reason: error && error.message ? String(error.message) : 'stat-failed' }
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let read = null
    try {
      read = await api.readBytes(sessionId, path, {}, signal)
    } catch (error) {
      return { ok: false, reason: error && error.message ? String(error.message) : 'read-failed' }
    }
    const decoded = decodeWorkspaceBytes(read)
    if (!decoded.ok) return decoded
    let after = before
    if (typeof api.stat === 'function') {
      try {
        after = await api.stat(sessionId, path, signal)
        if (after && after.error) return { ok: false, reason: String(after.error) }
      } catch (error) {
        return { ok: false, reason: error && error.message ? String(error.message) : 'stat-failed' }
      }
    }
    const versions = [before && before.version, decoded.version, after && after.version]
      .filter(value => value !== undefined && value !== null).map(String)
    if (new Set(versions).size <= 1) {
      return Object.assign({ ok: true }, decoded, {
        absolutePath: after && typeof after.absolutePath === 'string' ? after.absolutePath
          : (before && typeof before.absolutePath === 'string' ? before.absolutePath : ''),
      })
    }
    before = after
  }
  return { ok: false, reason: 'changed-during-read' }
}
