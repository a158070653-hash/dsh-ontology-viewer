/** Page-local sharing of bounded parsed sources, keyed by real session/workspace. */
const MAX_FILES = 16
const MAX_BYTES = 24 * 1024 * 1024
const MAX_OCCURRENCES = 120000
const DEFAULT_WORKSPACE_ID = 'explicit'

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validRegistry(value) {
  return value && value.sessions instanceof Map && Number.isSafeInteger(value.nextOwnerId)
}

function copyFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(copyFrozen))
  if (value && typeof value === 'object') {
    const copy = {}
    for (const key of Object.keys(value)) copy[key] = copyFrozen(value[key])
    return Object.freeze(copy)
  }
  return value
}

function snapshot(source, ownerId) {
  if (!source || !validId(source.sourceId) || !source.parsed ||
    !Array.isArray(source.parsed.triples) || !Number.isSafeInteger(source.byteSize) ||
    source.byteSize < 0 || (source.revision !== undefined &&
      (!Number.isSafeInteger(source.revision) || source.revision < 0))) return null
  const parsed = source.parsed
  if (!parsed.triples.every((triple) => triple && typeof triple === 'object')) return null
  return copyFrozen({
    ownerId,
    sourceId: source.sourceId,
    sharedId: JSON.stringify([ownerId, source.sourceId]),
    revision: source.revision,
    origin: source.origin,
    displayName: source.displayName,
    format: source.format,
    navigationAddress: source.navigationAddress,
    absolutePath: source.absolutePath,
    rdfBase: source.rdfBase,
    status: source.status,
    byteSize: source.byteSize,
    occurrenceCount: parsed.triples.length,
    parsed: {
      format: parsed.format,
      prefixes: parsed.prefixes && typeof parsed.prefixes === 'object'
        ? { ...parsed.prefixes } : {},
      base: parsed.base,
      baseSource: parsed.baseSource,
      triples: parsed.triples.map((triple) => ({
        s: triple.s, p: triple.p, o: triple.o, oKind: triple.oKind,
        dt: triple.dt, lang: triple.lang, literalTruncated: triple.literalTruncated,
        graph: triple.graph && typeof triple.graph === 'object'
          ? { ...triple.graph } : triple.graph,
        location: triple.location,
      })),
      stats: parsed.stats && typeof parsed.stats === 'object' ? { ...parsed.stats } : {},
      diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics.slice() : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors.slice() : [],
    },
  })
}

function allSources(entry, ownerId, replacement) {
  const result = []
  for (const [id, sources] of entry.owners) {
    result.push(...(id === ownerId ? replacement : sources.values()))
  }
  return result
}

function notify(entry) {
  const current = allSources(entry)
  for (const listener of entry.listeners) {
    try { listener(current.slice()) } catch (_) { /* isolate subscribers */ }
  }
}

export function createSessionRegistry() {
  return { sessions: new Map(), nextOwnerId: 1 }
}

/** Missing session identity is not a shared session: the caller stays panel-local. */
export function registryAcquire(registry, sessionId, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (!validRegistry(registry) || !validId(sessionId) || !validId(workspaceId)) return null
  let workspaces = registry.sessions.get(sessionId)
  if (!workspaces) {
    workspaces = new Map()
    registry.sessions.set(sessionId, workspaces)
  }
  let entry = workspaces.get(workspaceId)
  if (!entry) {
    entry = { active: true, owners: new Map(), listeners: new Set() }
    workspaces.set(workspaceId, entry)
  }
  const ownerId = String(registry.nextOwnerId++)
  entry.owners.set(ownerId, new Map())
  let released = false
  let objects = new WeakMap()
  const subscriptions = new Set()
  const live = () => !released && entry.active
  const noop = () => {}

  function commit(next) {
    if (!live()) return { ok: false, reason: 'released' }
    const current = entry.owners.get(ownerId)
    const sources = allSources(entry, ownerId, next.values())
    if (sources.length > MAX_FILES) return { ok: false, reason: 'file-limit' }
    let bytes = 0
    let occurrences = 0
    for (const source of sources) {
      bytes += source.byteSize
      occurrences += source.occurrenceCount
      if (bytes > MAX_BYTES) return { ok: false, reason: 'byte-budget' }
      if (occurrences > MAX_OCCURRENCES) return { ok: false, reason: 'occurrence-budget' }
    }
    const changed = current.size !== next.size ||
      [...next].some(([id, value]) => current.get(id) !== value)
    if (changed) {
      entry.owners.set(ownerId, next)
      notify(entry)
    }
    return { ok: true, changed, sources: allSources(entry).slice() }
  }

  function retain(source, previous) {
    // A version identifies an unchanged parsed snapshot; otherwise object identity does.
    if (previous && source && typeof source === 'object' &&
      source.byteSize === previous.byteSize &&
      source.parsed && Array.isArray(source.parsed.triples) &&
      source.parsed.triples.length === previous.occurrenceCount &&
      (objects.get(source) === previous ||
        (source.revision !== undefined && previous.revision === source.revision))) {
      return previous
    }
    const record = snapshot(source, ownerId)
    if (record) objects.set(source, record)
    return record
  }

  return {
    sessionId,
    workspaceId,
    ownerId,
    publish(source) {
      if (!live()) return { ok: false, reason: 'released' }
      const next = new Map(entry.owners.get(ownerId))
      const record = retain(source, next.get(source && source.sourceId))
      if (!record) return { ok: false, reason: 'invalid-source' }
      next.set(record.sourceId, record)
      const result = commit(next)
      return result.ok ? { ...result, source: record } : result
    },
    replaceSources(sources) {
      if (!live()) return { ok: false, reason: 'released' }
      if (!Array.isArray(sources)) return { ok: false, reason: 'invalid-source' }
      const previous = entry.owners.get(ownerId)
      const next = new Map()
      for (const source of sources) {
        const record = retain(source, previous.get(source && source.sourceId))
        if (!record || next.has(record.sourceId)) return { ok: false, reason: 'invalid-source' }
        next.set(record.sourceId, record)
      }
      return commit(next)
    },
    remove(sourceId) {
      if (!live()) return { ok: false, reason: 'released' }
      if (!validId(sourceId)) return { ok: false, reason: 'invalid-source' }
      const next = new Map(entry.owners.get(ownerId))
      next.delete(sourceId)
      return commit(next)
    },
    list() { return live() ? allSources(entry).slice() : [] },
    subscribe(listener) {
      if (!live() || typeof listener !== 'function') return noop
      const callback = (sources) => listener(sources)
      entry.listeners.add(callback)
      subscriptions.add(callback)
      try { callback(allSources(entry).slice()) } catch (_) { /* isolate subscriber */ }
      return () => {
        subscriptions.delete(callback)
        entry.listeners.delete(callback)
      }
    },
    release() {
      if (!live()) { released = true; return }
      released = true
      objects = new WeakMap()
      for (const listener of subscriptions) entry.listeners.delete(listener)
      subscriptions.clear()
      entry.owners.delete(ownerId)
      if (entry.owners.size === 0) {
        entry.active = false
        entry.listeners.clear()
        workspaces.delete(workspaceId)
        if (workspaces.size === 0) registry.sessions.delete(sessionId)
      } else {
        notify(entry)
      }
    },
  }
}

/** Invalidate all outstanding handles, subscriptions and parsed references. */
export function registryClear(registry) {
  if (!validRegistry(registry)) return
  for (const workspaces of registry.sessions.values()) {
    for (const entry of workspaces.values()) {
      entry.active = false
      entry.owners.clear()
      entry.listeners.clear()
    }
    workspaces.clear()
  }
  registry.sessions.clear()
}
