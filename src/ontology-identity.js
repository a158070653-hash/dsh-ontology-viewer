/**
 * Entity identity for merged multi-file RDF data.
 *
 * The viewer merges statements from several sources into one node-link model.
 * Absolute RDF IRIs identify themselves; blank nodes, unresolved relative
 * IRIs and unknown graph contexts are scoped to the source document, so the
 * same label in two files never becomes the same entity.
 *
 * Internal keys use a marker character that a valid RDF IRI cannot contain
 * (U+0000), and every part is length-prefixed. A user IRI can therefore never
 * collide with an internal key, and blank labels containing separators cannot
 * shift key boundaries.
 *
 * Plain ECMAScript: this module is concatenated into the Client bundle and the
 * embedded Worker (see build/build.mjs), and imported directly by Node tests.
 */

const ONTO_IDENTITY_MARKER = '\u0000'

/** Length-prefix one key part so separators inside values are unambiguous. */
function ontoIdentityPart(value) {
  const text = typeof value === 'string' ? value : String(value)
  return text.length + ':' + text
}

/** Build one internal, collision-resistant key from its parts. */
function ontoIdentityKey(kind, parts) {
  let key = ONTO_IDENTITY_MARKER + kind + ONTO_IDENTITY_MARKER
  for (let index = 0; index < parts.length; index++) {
    key += ontoIdentityPart(parts[index])
  }
  return key
}

/** True when a key is a workspace-internal identity rather than an RDF IRI. */
export function isInternalEntityKey(value) {
  if (typeof value !== 'string') return false
  if (value.charAt(0) === ONTO_IDENTITY_MARKER) return true
  return value.slice(0, 2) === '_:' && value.charAt(2) === ONTO_IDENTITY_MARKER
}

/** Split an internal key back into `{ kind, parts }`, or null for real IRIs. */
export function describeInternalEntityKey(value) {
  if (!isInternalEntityKey(value)) return null
  const body = value.charAt(0) === ONTO_IDENTITY_MARKER ? value.slice(1) : value.slice(3)
  const marker = body.indexOf(ONTO_IDENTITY_MARKER)
  if (marker < 0) return null
  const kind = body.slice(0, marker)
  const rest = body.slice(marker + 1)
  const parts = []
  let index = 0
  while (index < rest.length) {
    const colon = rest.indexOf(':', index)
    if (colon < 0) return null
    const length = Number(rest.slice(index, colon))
    if (!Number.isInteger(length) || length < 0) return null
    const start = colon + 1
    parts.push(rest.slice(start, start + length))
    index = start + length
  }
  return { kind: kind, parts: parts }
}

/**
 * Identity of one blank node inside a source document. The `_:` prefix keeps
 * the graph model's blank-node classification working on the scoped id; the
 * marker after it still makes the key impossible to forge with an RDF IRI.
 */
export function blankEntityKey(sourceId, label) {
  return '_:' + ontoIdentityKey('blank', [sourceId, label])
}

/** Identity of one unresolved relative IRI inside a source document. */
export function relativeEntityKey(sourceId, raw) {
  return ontoIdentityKey('relative', [sourceId, raw])
}

/** Stable identity of one statement (source + ordinal). */
export function statementIdFor(sourceId, ordinal) {
  return ontoIdentityKey('statement', [sourceId, String(ordinal)])
}

/**
 * Identity of the graph context of one statement. Default graphs share one
 * identity; IRI graphs identify themselves; blank and unknown contexts stay
 * scoped to their source document.
 */
export function graphIdentityFor(sourceId, graph) {
  if (!graph || graph.kind === 'default') return 'default'
  if (graph.kind === 'iri' && typeof graph.value === 'string' && graph.value !== '') {
    return 'iri\t' + graph.value
  }
  if (graph.kind === 'blank') return blankEntityKey(sourceId, graph.value || '')
  return 'unknown\t' + sourceId
}

/**
 * Entity identity of one RDF term string. An absolute IRI keeps its own
 * identity; a blank node or a relative IRI is scoped to the source.
 */
export function entityKeyForTerm(term, sourceId) {
  const value = typeof term === 'string' ? term : ''
  if (value.slice(0, 2) === '_:') return blankEntityKey(sourceId, value)
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return value
  return relativeEntityKey(sourceId, value)
}
