/**
 * Dependency-free RDF reader used by the ontology viewer.
 *
 * Supported serializations: Turtle/N3/TriG (graphs ignored), N-Triples/N-Quads
 * (graph term ignored), RDF/XML and a practical JSON-LD 1.1 subset.
 *
 * The module is deliberately plain ECMAScript: no imports, no DOM APIs, no
 * Node globals and no decoding helpers.  The build script concatenates this
 * file with the other Client modules inside one closure, so every internal
 * helper is prefixed with `ontoRdf`/`OntoRdf` to avoid collisions.
 *
 * Every parser returns the same plain-object shape and never throws:
 *   { format, prefixes, base, triples, stats, warnings, errors }
 */

const ONTO_RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const ONTO_RDF_TYPE = ONTO_RDF_NS + 'type'
const ONTO_RDF_FIRST = ONTO_RDF_NS + 'first'
const ONTO_RDF_REST = ONTO_RDF_NS + 'rest'
const ONTO_RDF_NIL = ONTO_RDF_NS + 'nil'
const ONTO_RDF_LANG_STRING = ONTO_RDF_NS + 'langString'
const ONTO_RDF_XML_LITERAL = ONTO_RDF_NS + 'XMLLiteral'
const ONTO_RDF_JSON = ONTO_RDF_NS + 'JSON'
const ONTO_XSD_NS = 'http://www.w3.org/2001/XMLSchema#'
const ONTO_XSD_STRING = ONTO_XSD_NS + 'string'
const ONTO_XSD_INTEGER = ONTO_XSD_NS + 'integer'
const ONTO_XSD_DECIMAL = ONTO_XSD_NS + 'decimal'
const ONTO_XSD_DOUBLE = ONTO_XSD_NS + 'double'
const ONTO_XSD_BOOLEAN = ONTO_XSD_NS + 'boolean'
const ONTO_XML_NS = 'http://www.w3.org/XML/1998/namespace'
const ONTO_DEFAULT_MAX_TRIPLES = 100000
const ONTO_DEFAULT_MAX_LITERAL_LENGTH = 16384
const ONTO_DEFAULT_MAX_DEPTH = 256
const ONTO_DEFAULT_MAX_DIAGNOSTICS = 200
const ONTO_DIAGNOSTIC_SAMPLE_LIMIT = 3

/* ------------------------------------------------------------------ */
/* Small generic helpers                                              */
/* ------------------------------------------------------------------ */

function ontoRdfHas(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function ontoRdfNormalizeText(text) {
  if (typeof text !== 'string') return ''
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function ontoRdfIsWhitespace(character) {
  return character === ' ' || character === '\t' || character === '\r' || character === '\n'
}

function ontoRdfBuildLineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

function ontoRdfLineAt(starts, index) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= index) low = middle
    else high = middle - 1
  }
  return low + 1
}

function ontoRdfFormatDiagnostic(message, line) {
  if (typeof line === 'number' && isFinite(line) && line >= 1) {
    return message + ' (line ' + Math.floor(line) + ')'
  }
  return message
}

function ontoRdfMaxTriples(value) {
  if (value === undefined || value === null) return ONTO_DEFAULT_MAX_TRIPLES
  const number = typeof value === 'number' ? value : Number(value)
  if (!isFinite(number) || number < 0) return ONTO_DEFAULT_MAX_TRIPLES
  return Math.floor(number)
}

function ontoRdfLimit(value, fallback) {
  if (value === undefined || value === null) return fallback
  const number = typeof value === 'number' ? value : Number(value)
  if (!isFinite(number) || number < 0) return fallback
  return Math.floor(number)
}

function ontoRdfIsAbsoluteIri(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function ontoRdfNormalizeIri(value, base, builder, line) {
  if (typeof value !== 'string' || value === '') return value
  if (value.slice(0, 2) === '_:') return value
  if (ontoRdfIsAbsoluteIri(value)) return value
  if (base) return resolveIri(base, value)
  if (builder) {
    builder.diagnose(
      'base-unavailable',
      'warning',
      'relative IRI "' + value + '" could not be resolved (no base)',
      line,
    )
  }
  return value
}

function ontoRdfFileExtension(fileName) {
  if (typeof fileName !== 'string') return ''
  let name = fileName.trim()
  if (!name) return ''
  const hash = name.indexOf('#')
  if (hash >= 0) name = name.slice(0, hash)
  const query = name.indexOf('?')
  if (query >= 0) name = name.slice(0, query)
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const leaf = slash < 0 ? name : name.slice(slash + 1)
  const dot = leaf.lastIndexOf('.')
  if (dot < 0 || dot === leaf.length - 1) return ''
  return leaf.slice(dot + 1).toLowerCase()
}

function ontoRdfEncodeFilePath(path) {
  return path
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
}

/* ------------------------------------------------------------------ */
/* Resource address mapping (display name is never an identity)        */
/* ------------------------------------------------------------------ */

const ONTO_WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

function ontoRdfStripFragment(value) {
  const hash = value.indexOf('#')
  return hash < 0 ? value : value.slice(0, hash)
}

/**
 * Map a real resource address to an RDF base IRI, or null when it cannot be
 * mapped reliably. `resourceAddress` is not guaranteed to be a file URI: the
 * host may hand us an http(s) URL, a custom-scheme address, or a plain file
 * path from a different integration. A display file name is a relative path
 * and is therefore never mapped.
 */
function ontoRdfMapResourceAddress(address) {
  if (typeof address !== 'string') return null
  const value = address.trim()
  if (value === '') return null
  if (ONTO_WINDOWS_DRIVE_PATH.test(value)) {
    return 'file:///' + ontoRdfEncodeFilePath(value.replace(/\\/g, '/'))
  }
  if (value.slice(0, 2) === '\\\\') {
    return 'file://' + ontoRdfEncodeFilePath(value.replace(/\\/g, '/'))
  }
  if (value.charAt(0) === '/') {
    return 'file://' + ontoRdfEncodeFilePath(value)
  }
  if (!ontoRdfIsAbsoluteIri(value)) return null
  const parts = ontoRdfParseIri(value)
  const scheme = typeof parts.scheme === 'string' ? parts.scheme.toLowerCase() : ''
  if (scheme === 'http' || scheme === 'https' || scheme === 'file') {
    return ontoRdfStripFragment(value)
  }
  // Custom schemes are used verbatim only when they form an absolute
  // hierarchical URI; otherwise we refuse to guess and report no base.
  if (parts.authority !== undefined || parts.path.charAt(0) === '/') {
    return ontoRdfStripFragment(value)
  }
  return null
}

/**
 * Initial base for one parse: document declarations may override it later.
 * @returns {{ base: string, source: 'document'|'resource'|'none' }}
 */
function ontoRdfInitialBase(options) {
  const opts = options || {}
  if (opts.resourceAddress !== undefined && opts.resourceAddress !== null) {
    const mapped = ontoRdfMapResourceAddress(opts.resourceAddress)
    if (mapped) return { base: mapped, source: 'resource' }
    return { base: '', source: 'none' }
  }
  // Legacy compatibility for library callers that passed a real path as
  // `fileName`: only address-like values still contribute a base. A bare
  // display name MUST NOT fabricate a `file:///` identity.
  const legacy = ontoRdfMapResourceAddress(opts.fileName)
  if (legacy) return { base: legacy, source: 'resource' }
  return { base: '', source: 'none' }
}

/* ------------------------------------------------------------------ */
/* RDF document builder                                               */
/* ------------------------------------------------------------------ */

class OntoRdfBuilder {
  constructor(format, text, options) {
    const opts = options || {}
    this.format = format
    this.text = typeof text === 'string' ? text : ''
    this.maxTriples = ontoRdfMaxTriples(opts.maxTriples)
    this.maxLiteralLength = ontoRdfLimit(opts.maxLiteralLength, ONTO_DEFAULT_MAX_LITERAL_LENGTH)
    this.maxDepth = ontoRdfLimit(opts.maxDepth, ONTO_DEFAULT_MAX_DEPTH)
    this.maxDiagnostics = ontoRdfLimit(opts.maxDiagnostics, ONTO_DEFAULT_MAX_DIAGNOSTICS)
    this.triples = []
    this.prefixes = {}
    this.base = ''
    this.baseSource = 'none'
    this.warnings = []
    this.errors = []
    this.diagnostics = []
    this.diagnosticIndex = Object.create(null)
    this.rawMessageCount = 0
    this.suppressedMessages = 0
    this.suppressedSamples = []
    this.truncated = false
    this.blankCounter = 0
    this.usedBlankLabels = Object.create(null)
    this.lineIndex = null
    if (typeof text !== 'string') this.error('input is not a string')
  }

  lineAt(index) {
    if (this.lineIndex === null) this.lineIndex = ontoRdfBuildLineIndex(this.text)
    return ontoRdfLineAt(this.lineIndex, index)
  }

  /** Append one raw message, honouring the retained-message cap. */
  pushRaw(severity, message, line) {
    const text = ontoRdfFormatDiagnostic(message, line)
    if (this.rawMessageCount >= this.maxDiagnostics) {
      this.suppressedMessages++
      if (this.suppressedSamples.length < ONTO_DIAGNOSTIC_SAMPLE_LIMIT) {
        this.suppressedSamples.push(text)
      }
      return
    }
    this.rawMessageCount++
    if (severity === 'error') this.errors.push(text)
    else this.warnings.push(text)
  }

  warn(message, line) {
    this.pushRaw('warning', message, line)
  }

  error(message, line) {
    this.pushRaw('error', message, line)
  }

  /**
   * Record one classified diagnostic and its raw message. Aggregates by code:
   * `count` accumulates every occurrence while `sample` keeps at most three.
   */
  diagnose(code, severity, message, line) {
    const level = severity === 'error' ? 'error' : 'warning'
    const text = ontoRdfFormatDiagnostic(message, line)
    let entry = this.diagnosticIndex[code]
    if (!entry) {
      entry = { code: code, severity: level, message: message, count: 0, sample: [] }
      this.diagnosticIndex[code] = entry
      this.diagnostics.push(entry)
    }
    entry.count++
    if (entry.sample.length < ONTO_DIAGNOSTIC_SAMPLE_LIMIT) entry.sample.push(text)
    this.pushRaw(level, message, line)
    return entry
  }

  add(subject, predicate, object, objectKind, datatype, language) {
    if (this.triples.length >= this.maxTriples) {
      if (!this.truncated) {
        this.truncated = true
        this.diagnose(
          'triple-limit',
          'warning',
          'triple limit of ' + this.maxTriples + ' reached; remaining triples were skipped',
        )
      }
      return false
    }
    let term = object
    let literalTruncated = false
    if ((objectKind || 'iri') === 'literal' && typeof term === 'string' &&
      term.length > this.maxLiteralLength) {
      literalTruncated = true
      this.diagnose(
        'literal-limit',
        'warning',
        'literal value of ' + term.length + ' characters was truncated to ' +
          this.maxLiteralLength + ' characters',
      )
      term = term.slice(0, this.maxLiteralLength)
    }
    const triple = { s: subject, p: predicate, o: term, oKind: objectKind || 'iri' }
    if (literalTruncated) triple.literalTruncated = true
    if (datatype !== undefined) triple.dt = datatype
    if (language !== undefined) triple.lang = language
    this.triples.push(triple)
    return true
  }

  freshBlank() {
    let candidate = '_:b' + this.blankCounter
    while (this.usedBlankLabels[candidate] === true) {
      this.blankCounter++
      candidate = '_:b' + this.blankCounter
    }
    this.blankCounter++
    this.usedBlankLabels[candidate] = true
    return candidate
  }

  useBlank(label) {
    const id = label.slice(0, 2) === '_:' ? label : '_:' + label
    this.usedBlankLabels[id] = true
    return id
  }

  finish() {
    const subjects = new Set()
    const predicates = new Set()
    const objects = new Set()
    for (let i = 0; i < this.triples.length; i++) {
      const triple = this.triples[i]
      subjects.add(triple.s)
      predicates.add(triple.p)
      objects.add(triple.o)
    }
    if (this.suppressedMessages > 0) {
      const message = this.suppressedMessages + ' diagnostic message' +
        (this.suppressedMessages === 1 ? '' : 's') +
        ' were suppressed after the limit of ' + this.maxDiagnostics
      this.diagnostics.push({
        code: 'diagnostics-truncated',
        severity: 'warning',
        message: message,
        count: this.suppressedMessages,
        sample: this.suppressedSamples.slice(),
      })
    }
    return {
      format: this.format,
      prefixes: this.prefixes,
      base: this.base || '',
      baseSource: this.baseSource || 'none',
      triples: this.triples,
      stats: {
        tripleCount: this.triples.length,
        subjectCount: subjects.size,
        predicateCount: predicates.size,
        objectCount: objects.size,
        truncated: this.truncated,
        truncation: this.truncated
          ? { reason: 'triple-limit', limit: this.maxTriples, kept: this.triples.length }
          : null,
      },
      diagnostics: this.diagnostics,
      warnings: this.warnings,
      errors: this.errors,
    }
  }
}

/* ------------------------------------------------------------------ */
/* IRI reference resolution (RFC 3986 section 5.2, string math only)   */
/* ------------------------------------------------------------------ */

const ONTO_IRI_PATTERN = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$/

function ontoRdfParseIri(value) {
  const match = ONTO_IRI_PATTERN.exec(value)
  if (!match) {
    return { scheme: undefined, authority: undefined, path: value, query: undefined, fragment: undefined }
  }
  return {
    scheme: match[1],
    authority: match[2],
    path: match[3] === undefined ? '' : match[3],
    query: match[4],
    fragment: match[5],
  }
}

function ontoRdfDropLastSegment(output) {
  const slash = output.lastIndexOf('/')
  return slash < 0 ? '' : output.slice(0, slash)
}

function ontoRdfRemoveDotSegments(path) {
  let input = path
  let output = ''
  while (input.length > 0) {
    if (input.slice(0, 3) === '../') {
      input = input.slice(3)
    } else if (input.slice(0, 2) === './') {
      input = input.slice(2)
    } else if (input.slice(0, 3) === '/./') {
      input = '/' + input.slice(3)
    } else if (input === '/.') {
      input = '/'
    } else if (input.slice(0, 4) === '/../') {
      input = '/' + input.slice(4)
      output = ontoRdfDropLastSegment(output)
    } else if (input === '/..') {
      input = '/'
      output = ontoRdfDropLastSegment(output)
    } else if (input === '.' || input === '..') {
      input = ''
    } else {
      const end = input.charAt(0) === '/' ? input.indexOf('/', 1) : input.indexOf('/')
      if (end < 0) {
        output += input
        input = ''
      } else {
        output += input.slice(0, end)
        input = input.slice(end)
      }
    }
  }
  return output
}

function ontoRdfMergePath(baseParts, referencePath) {
  if (baseParts.authority !== undefined && baseParts.path === '') return '/' + referencePath
  const slash = baseParts.path.lastIndexOf('/')
  return slash < 0 ? referencePath : baseParts.path.slice(0, slash + 1) + referencePath
}

function ontoRdfBuildIri(parts) {
  let result = ''
  if (parts.scheme !== undefined) result += parts.scheme + ':'
  if (parts.authority !== undefined) result += '//' + parts.authority
  result += parts.path
  if (parts.query !== undefined) result += '?' + parts.query
  if (parts.fragment !== undefined) result += '#' + parts.fragment
  return result
}

/** Resolve a relative IRI reference against an absolute base IRI. */
export function resolveIri(base, reference) {
  const baseText = typeof base === 'string' ? base : ''
  const referenceText = typeof reference === 'string' ? reference : ''
  if (baseText === '') return referenceText
  const ref = ontoRdfParseIri(referenceText)
  const baseParts = ontoRdfParseIri(baseText)
  if (ref.scheme !== undefined) {
    return ontoRdfBuildIri({
      scheme: ref.scheme,
      authority: ref.authority,
      path: ontoRdfRemoveDotSegments(ref.path),
      query: ref.query,
      fragment: ref.fragment,
    })
  }
  if (ref.authority !== undefined) {
    return ontoRdfBuildIri({
      scheme: baseParts.scheme,
      authority: ref.authority,
      path: ontoRdfRemoveDotSegments(ref.path),
      query: ref.query,
      fragment: ref.fragment,
    })
  }
  if (ref.path === '') {
    return ontoRdfBuildIri({
      scheme: baseParts.scheme,
      authority: baseParts.authority,
      path: baseParts.path,
      query: ref.query !== undefined ? ref.query : baseParts.query,
      fragment: ref.fragment,
    })
  }
  const path = ref.path.charAt(0) === '/'
    ? ontoRdfRemoveDotSegments(ref.path)
    : ontoRdfRemoveDotSegments(ontoRdfMergePath(baseParts, ref.path))
  return ontoRdfBuildIri({
    scheme: baseParts.scheme,
    authority: baseParts.authority,
    path: path,
    query: ref.query,
    fragment: ref.fragment,
  })
}

/** Expand 'foaf:Person' with a prefix map, or return null. */
export function expandPrefixedName(name, prefixes) {
  if (typeof name !== 'string' || !prefixes || typeof prefixes !== 'object') return null
  const colon = name.indexOf(':')
  if (colon < 0) return null
  const prefix = name.slice(0, colon)
  if (!ontoRdfHas(prefixes, prefix)) return null
  const namespace = prefixes[prefix]
  if (typeof namespace !== 'string' || namespace === '') return null
  return namespace + name.slice(colon + 1)
}

/* ------------------------------------------------------------------ */
/* Escape decoding                                                    */
/* ------------------------------------------------------------------ */

function ontoRdfDecodeUnicode(raw, marker, line, builder) {
  const size = marker === 'u' ? 4 : 8
  const hex = raw.slice(0, size)
  if (hex.length !== size || !/^[0-9A-Fa-f]+$/.test(hex)) {
    builder.warn('invalid unicode escape "\\' + marker + hex + '"', line)
    return null
  }
  const code = parseInt(hex, 16)
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    builder.warn('invalid code point in unicode escape', line)
    return { value: '\uFFFD', used: size }
  }
  return { value: String.fromCodePoint(code), used: size }
}

function ontoRdfDecodeEscapes(raw, line, builder) {
  let output = ''
  let i = 0
  while (i < raw.length) {
    const character = raw.charAt(i)
    if (character !== '\\') {
      output += character
      i++
      continue
    }
    const marker = raw.charAt(i + 1)
    if (marker === '') {
      builder.warn('trailing backslash in literal', line)
      break
    }
    if (marker === 't') {
      output += '\t'
      i += 2
    } else if (marker === 'b') {
      output += '\b'
      i += 2
    } else if (marker === 'n') {
      output += '\n'
      i += 2
    } else if (marker === 'r') {
      output += '\r'
      i += 2
    } else if (marker === 'f') {
      output += '\f'
      i += 2
    } else if (marker === '"') {
      output += '"'
      i += 2
    } else if (marker === "'") {
      output += "'"
      i += 2
    } else if (marker === '\\') {
      output += '\\'
      i += 2
    } else if (marker === 'u' || marker === 'U') {
      const decoded = ontoRdfDecodeUnicode(raw.slice(i + 2), marker, line, builder)
      if (decoded === null) {
        output += marker
        i += 2
      } else {
        output += decoded.value
        i += 2 + decoded.used
      }
    } else {
      builder.warn('unknown escape sequence "\\' + marker + '"', line)
      output += marker
      i += 2
    }
  }
  return output
}

function ontoRdfDecodeIriEscapes(raw, line, builder) {
  let output = ''
  let i = 0
  while (i < raw.length) {
    const character = raw.charAt(i)
    if (character !== '\\') {
      output += character
      i++
      continue
    }
    const marker = raw.charAt(i + 1)
    if (marker === 'u' || marker === 'U') {
      const decoded = ontoRdfDecodeUnicode(raw.slice(i + 2), marker, line, builder)
      if (decoded === null) {
        output += marker
        i += 2
      } else {
        output += decoded.value
        i += 2 + decoded.used
      }
      continue
    }
    if (marker === '') {
      builder.warn('trailing backslash in IRI', line)
      break
    }
    builder.warn('invalid escape sequence "\\' + marker + '" in IRI', line)
    output += marker
    i += 2
  }
  return output
}

/* ------------------------------------------------------------------ */
/* Turtle / N3 / TriG                                                 */
/* ------------------------------------------------------------------ */

const ONTO_TURTLE_NUMBER = /[+-]?(?:(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))[eE][+-]?\d+|(?:\d*\.\d+)|(?:\d+))/y

function ontoRdfTurtleBoundary(character) {
  return character === undefined ||
    character === ' ' || character === '\t' || character === '\r' || character === '\n' ||
    character === ';' || character === ',' || character === '.' || character === '(' ||
    character === ')' || character === '[' || character === ']' || character === '{' ||
    character === '}' || character === '<' || character === '>' || character === '"' ||
    character === "'" || character === '#' || character === '^'
}

class OntoTurtleParser {
  constructor(text, options) {
    const opts = options || {}
    this.builder = new OntoRdfBuilder('turtle', ontoRdfNormalizeText(text), opts)
    this.source = this.builder.text
    this.length = this.source.length
    this.pos = 0
    const initial = ontoRdfInitialBase(opts)
    this.base = initial.base
    this.builder.base = initial.base
    this.builder.baseSource = initial.source
    this.depth = 0
    this.prefixes = this.builder.prefixes
    if (opts.prefixes && typeof opts.prefixes === 'object') {
      const keys = Object.keys(opts.prefixes)
      for (let i = 0; i < keys.length; i++) {
        const value = opts.prefixes[keys[i]]
        if (typeof value === 'string') this.prefixes[keys[i]] = value
      }
    }
  }

  parse() {
    try {
      this.parseDocument()
    } catch (error) {
      if (!error || !error.ontoRdfFatal) {
        this.builder.error(
          'parser failed: ' + (error && error.message ? error.message : String(error)),
          this.builder.lineAt(this.pos),
        )
      }
    }
    return this.builder.finish()
  }

  /* ---------------------------- scanner ---------------------------- */

  peek(offset) {
    return this.source[this.pos + (offset || 0)]
  }

  atEnd() {
    return this.pos >= this.length
  }

  lineAt(index) {
    return this.builder.lineAt(index)
  }

  fatal(message, index) {
    this.builder.error(message, this.lineAt(index === undefined ? this.pos : index))
    const error = new Error(message)
    error.ontoRdfFatal = true
    throw error
  }

  skipWhitespace() {
    while (this.pos < this.length) {
      const character = this.source[this.pos]
      if (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
        this.pos++
        continue
      }
      if (character === '#') {
        const newline = this.source.indexOf('\n', this.pos)
        this.pos = newline < 0 ? this.length : newline + 1
        continue
      }
      break
    }
  }

  isNameDelimiter(character) {
    return character === undefined ||
      character === ' ' || character === '\t' || character === '\r' || character === '\n' ||
      character === ';' || character === ',' || character === '(' || character === ')' ||
      character === '[' || character === ']' || character === '<' || character === '>' ||
      character === '"' || character === "'" || character === '#' || character === '{' ||
      character === '}' || character === '^'
  }

  matchWord(word) {
    const end = this.pos + word.length
    if (this.source.slice(this.pos, end) !== word) return false
    return ontoRdfTurtleBoundary(this.source[end])
  }

  readWord() {
    let end = this.pos
    while (end < this.length && /[A-Za-z]/.test(this.source[end])) end++
    return this.source.slice(this.pos, end)
  }

  isDirectiveBoundary(index) {
    const character = this.source[index]
    return character === undefined || character === ' ' || character === '\t' ||
      character === '\r' || character === '\n' || character === '<'
  }

  /* --------------------------- directives -------------------------- */

  tryDirective() {
    const start = this.pos
    if (this.peek() === '@') {
      if (this.source.slice(start, start + 7).toLowerCase() === '@prefix' && this.isDirectiveBoundary(start + 7)) {
        this.parsePrefixDirective(7, true)
        return true
      }
      if (this.source.slice(start, start + 5).toLowerCase() === '@base' && this.isDirectiveBoundary(start + 5)) {
        this.parseBaseDirective(5, true)
        return true
      }
      return false
    }
    const word = this.readWord()
    const lower = word.toLowerCase()
    if (lower === 'prefix' && this.isDirectiveBoundary(start + word.length)) {
      this.parsePrefixDirective(word.length, false)
      return true
    }
    if (lower === 'base' && this.isDirectiveBoundary(start + word.length)) {
      this.parseBaseDirective(word.length, false)
      return true
    }
    return false
  }

  parsePrefixDirective(keywordLength, requireDot) {
    const start = this.pos
    this.pos += keywordLength
    this.skipWhitespace()
    const prefix = this.readPrefixLabel()
    this.skipWhitespace()
    if (this.peek() !== '<') this.fatal('expected an IRI after the prefix name', this.pos)
    const iri = this.readIriReference()
    this.declarePrefix(prefix, iri, start)
    this.skipWhitespace()
    if (requireDot) {
      if (this.peek() !== '.') this.fatal("expected '.' after @prefix", this.pos)
      this.pos++
    } else if (this.peek() === '.') {
      this.pos++
    }
  }

  parseBaseDirective(keywordLength, requireDot) {
    const start = this.pos
    this.pos += keywordLength
    this.skipWhitespace()
    if (this.peek() !== '<') this.fatal('expected an IRI after @base', this.pos)
    const iri = this.readIriReference()
    this.setBase(iri, start)
    this.skipWhitespace()
    if (requireDot) {
      if (this.peek() !== '.') this.fatal("expected '.' after @base", this.pos)
      this.pos++
    } else if (this.peek() === '.') {
      this.pos++
    }
  }

  readPrefixLabel() {
    const start = this.pos
    let prefix = ''
    while (!this.atEnd()) {
      const character = this.peek()
      if (character === ':') {
        this.pos++
        return prefix
      }
      if (this.isNameDelimiter(character) || character === '\\') break
      prefix += character
      this.pos++
    }
    this.fatal('expected ":" after the prefix name', start)
    return ''
  }

  declarePrefix(prefix, iri, index) {
    let value = iri
    if (!ontoRdfIsAbsoluteIri(value)) {
      if (this.base) value = resolveIri(this.base, value)
      else {
        this.builder.diagnose(
          'base-unavailable',
          'warning',
          'prefix IRI "' + iri + '" is relative and no base is available',
          this.lineAt(index),
        )
      }
    }
    this.prefixes[prefix] = value
  }

  setBase(iri, index) {
    let value = iri
    if (!ontoRdfIsAbsoluteIri(value)) {
      if (this.base) {
        value = resolveIri(this.base, value)
      } else {
        this.builder.diagnose(
          'base-unavailable',
          'warning',
          '@base "' + iri + '" is relative and no base is available',
          this.lineAt(index),
        )
        return
      }
    }
    this.base = value
    this.builder.base = value
    if (value !== '') this.builder.baseSource = 'document'
  }

  /** Record that a TriG graph label was recognised and ignored. */
  noteNamedGraph(label, index) {
    const name = typeof label === 'string' && label !== '' ? label : 'anonymous graph'
    this.builder.diagnose(
      'named-graph-ignored',
      'warning',
      'named graph "' + name + '" was ignored; its triples were kept in the default graph',
      this.lineAt(index),
    )
  }

  /** Skip one balanced bracket construct without recursing (depth-limit escape). */
  skipBalanced(openCharacter, closeCharacter) {
    if (this.peek() !== openCharacter) return
    this.pos++
    let depth = 1
    while (this.pos < this.length) {
      const character = this.peek()
      if (character === '\\') {
        this.pos += 2
        continue
      }
      if (character === '#') {
        const newline = this.source.indexOf('\n', this.pos)
        this.pos = newline < 0 ? this.length : newline + 1
        continue
      }
      if (character === '"' || character === "'") {
        const quote = character
        const long = this.peek(1) === quote && this.peek(2) === quote
        this.pos += long ? 3 : 1
        while (this.pos < this.length) {
          if (this.source[this.pos] === '\\') {
            this.pos += 2
            continue
          }
          if (long) {
            if (this.source[this.pos] === quote && this.source[this.pos + 1] === quote &&
              this.source[this.pos + 2] === quote) {
              this.pos += 3
              break
            }
          } else if (this.source[this.pos] === quote) {
            this.pos++
            break
          }
          this.pos++
        }
        continue
      }
      if (character === openCharacter) {
        depth++
      } else if (character === closeCharacter) {
        depth--
        this.pos++
        if (depth === 0) return
        continue
      }
      this.pos++
    }
  }

  noteNestingLimit(index) {
    this.builder.diagnose(
      'nesting-limit',
      'error',
      'nesting depth limit of ' + this.builder.maxDepth +
        ' reached; the nested branch was skipped',
      this.lineAt(index),
    )
  }

  /* ---------------------------- tokens ----------------------------- */

  readIriReference() {
    const start = this.pos
    if (this.peek() !== '<') this.fatal('expected an IRI reference', start)
    this.pos++
    let raw = ''
    while (this.pos < this.length) {
      const character = this.source[this.pos]
      if (character === '>') {
        this.pos++
        return ontoRdfDecodeIriEscapes(raw, this.lineAt(start), this.builder)
      }
      if (character === '\n' || character === '\r') this.fatal('newline inside an IRI reference', start)
      raw += character
      this.pos++
    }
    this.fatal('unterminated IRI reference', start)
    return ''
  }

  readNameToken() {
    const start = this.pos
    let value = ''
    while (!this.atEnd()) {
      const character = this.peek()
      if (character === '\\') {
        const marker = this.peek(1)
        if (marker === 'u' || marker === 'U') {
          const size = marker === 'u' ? 4 : 8
          const hex = this.source.slice(this.pos + 2, this.pos + 2 + size)
          if (hex.length === size && /^[0-9A-Fa-f]+$/.test(hex)) {
            const code = parseInt(hex, 16)
            if (code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) value += String.fromCodePoint(code)
            this.pos += 2 + size
            continue
          }
        }
        if (marker === undefined) {
          this.pos++
          break
        }
        value += marker
        this.pos += 2
        continue
      }
      if (this.isNameDelimiter(character)) break
      value += character
      this.pos++
    }
    while (value.charAt(value.length - 1) === '.' && this.pos > start &&
      this.source[this.pos - 1] === '.' && this.source[this.pos - 2] !== '\\') {
      value = value.slice(0, -1)
      this.pos--
    }
    return { value: value, start: start }
  }

  readBlankNode(token, start) {
    const label = token.slice(2)
    if (!label) this.fatal('empty blank node label', start)
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(label)) {
      this.builder.warn('blank node label "' + label + '" may not be valid', this.lineAt(start))
    }
    return this.builder.useBlank(label)
  }

  expandNameToken(token) {
    const value = token.value
    const colon = value.indexOf(':')
    if (colon < 0) return null
    const prefix = value.slice(0, colon)
    const local = value.slice(colon + 1)
    const namespace = ontoRdfHas(this.prefixes, prefix) ? this.prefixes[prefix] : undefined
    if (typeof namespace !== 'string') this.fatal('undefined prefix "' + prefix + ':": "' + value + '"', token.start)
    return ontoRdfNormalizeIri(namespace + local, this.base, this.builder, this.lineAt(token.start))
  }

  readStringRaw() {
    const quote = this.peek()
    const start = this.pos
    const long = this.peek(1) === quote && this.peek(2) === quote
    this.pos += long ? 3 : 1
    let raw = ''
    while (this.pos < this.length) {
      const character = this.source[this.pos]
      if (long) {
        if (character === quote && this.source[this.pos + 1] === quote && this.source[this.pos + 2] === quote) {
          this.pos += 3
          return raw
        }
      } else if (character === quote) {
        this.pos++
        return raw
      }
      if (character === '\\') {
        raw += character
        this.pos++
        if (this.pos < this.length) {
          raw += this.source[this.pos]
          this.pos++
        }
        continue
      }
      if (!long && (character === '\n' || character === '\r')) {
        this.fatal('newline inside a short string literal', start)
      }
      raw += character
      this.pos++
    }
    this.fatal('unterminated string literal', start)
    return ''
  }

  parseStringLiteral() {
    const start = this.pos
    const raw = this.readStringRaw()
    const value = ontoRdfDecodeEscapes(raw, this.lineAt(start), this.builder)
    let language
    let datatype
    if (this.peek() === '@') {
      this.pos++
      const tagStart = this.pos
      while (!this.atEnd() && /[A-Za-z0-9-]/.test(this.peek())) this.pos++
      const tag = this.source.slice(tagStart, this.pos)
      if (!tag) {
        this.builder.warn('empty language tag', this.lineAt(tagStart))
      } else {
        language = tag.toLowerCase()
        if (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(tag)) {
          this.builder.warn('invalid language tag "' + tag + '"', this.lineAt(tagStart))
        }
      }
    } else if (this.peek() === '^' && this.peek(1) === '^') {
      this.pos += 2
      this.skipWhitespace()
      const datatypeStart = this.pos
      if (this.peek() === '<') {
        datatype = ontoRdfNormalizeIri(this.readIriReference(), this.base, this.builder, this.lineAt(datatypeStart))
      } else {
        const token = this.readNameToken()
        datatype = this.expandNameToken(token)
        if (!datatype) this.fatal('expected a datatype IRI', datatypeStart)
      }
    }
    return { term: value, kind: 'literal', dt: datatype, lang: language }
  }

  readNumber() {
    const start = this.pos
    ONTO_TURTLE_NUMBER.lastIndex = this.pos
    const match = ONTO_TURTLE_NUMBER.exec(this.source)
    if (!match) this.fatal('invalid numeric literal', start)
    const raw = match[0]
    const end = start + raw.length
    if (!ontoRdfTurtleBoundary(this.source[end])) {
      this.fatal('invalid numeric literal "' + raw + '"', start)
    }
    this.pos = end
    let datatype = ONTO_XSD_INTEGER
    if (raw.indexOf('e') >= 0 || raw.indexOf('E') >= 0) datatype = ONTO_XSD_DOUBLE
    else if (raw.indexOf('.') >= 0) datatype = ONTO_XSD_DECIMAL
    return { term: raw, kind: 'literal', dt: datatype }
  }

  /* --------------------------- grammar ----------------------------- */

  parseDocument() {
    this.skipWhitespace()
    while (!this.atEnd()) {
      if (this.builder.truncated) break
      const character = this.peek()
      if (character === '{' || character === '}') {
        this.pos++
        this.skipWhitespace()
        continue
      }
      if (this.tryDirective()) {
        this.skipWhitespace()
        continue
      }
      if (this.tryGraphHeader()) {
        this.skipWhitespace()
        continue
      }
      this.parseTriples()
      if (this.builder.truncated) break
      this.skipWhitespace()
      if (this.atEnd()) break
      if (this.peek() === '.') {
        this.pos++
        this.skipWhitespace()
        continue
      }
      if (this.peek() === '}') {
        this.pos++
        this.skipWhitespace()
        continue
      }
      this.fatal("expected '.' after the triples", this.pos)
    }
  }

  tryGraphHeader() {
    const save = this.pos
    if (this.peek() === '<') {
      const end = this.findIriEnd(save)
      if (end < 0) return false
      this.pos = end + 1
      this.skipWhitespace()
      if (this.peek() === '{') {
        this.noteNamedGraph(this.source.slice(save, end + 1), save)
        this.pos++
        return true
      }
      this.pos = save
      return false
    }
    if (this.peek() === '_' && this.peek(1) === ':') {
      this.pos += 2
      const labelStart = save
      while (!this.atEnd() && !this.isNameDelimiter(this.peek())) this.pos++
      this.skipWhitespace()
      if (this.peek() === '{') {
        this.noteNamedGraph(this.source.slice(labelStart, this.pos).trim(), save)
        this.pos++
        return true
      }
      this.pos = save
      return false
    }
    const word = this.readWord()
    if (word.toLowerCase() === 'graph' && ontoRdfIsWhitespace(this.source[this.pos + word.length])) {
      this.pos += word.length
      this.skipWhitespace()
      let label = ''
      if (this.peek() === '<') {
        const labelStart = this.pos
        const end = this.findIriEnd(labelStart)
        if (end < 0) {
          this.pos = save
          return false
        }
        this.readIriReference()
        label = this.source.slice(labelStart, end + 1)
      } else if (this.peek() === '_' && this.peek(1) === ':') {
        const labelStart = this.pos
        this.pos += 2
        while (!this.atEnd() && !this.isNameDelimiter(this.peek())) this.pos++
        label = this.source.slice(labelStart, this.pos)
      } else {
        const labelToken = this.readNameToken()
        if (!labelToken.value) {
          this.pos = save
          return false
        }
        label = labelToken.value
      }
      this.skipWhitespace()
      if (this.peek() === '{') {
        this.noteNamedGraph(label, save)
        this.pos++
        return true
      }
      this.pos = save
      return false
    }
    const token = this.readNameToken()
    this.skipWhitespace()
    if (token.value && this.peek() === '{') {
      this.noteNamedGraph(token.value, save)
      this.pos++
      return true
    }
    this.pos = save
    return false
  }

  findIriEnd(start) {
    let index = start + 1
    while (index < this.length) {
      const character = this.source[index]
      if (character === '\\') {
        index += 2
        continue
      }
      if (character === '>') return index
      if (character === '\n' || character === '\r') return -1
      index++
    }
    return -1
  }

  parseTriples() {
    const subject = this.parseSubject()
    this.skipWhitespace()
    if (this.peek() === '{') {
      this.pos++
      return
    }
    if (this.peek() === '.') {
      if (!subject.propertyList) this.fatal('expected a predicate and object', this.pos)
      return
    }
    const found = this.parsePredicateObjectList(subject.term)
    if (!found && !subject.propertyList) this.fatal('expected a predicate and object', this.pos)
  }

  parseSubject() {
    this.skipWhitespace()
    const start = this.pos
    const character = this.peek()
    if (character === undefined) this.fatal('unexpected end of input, expected a subject', start)
    if (character === '<') {
      return {
        term: ontoRdfNormalizeIri(this.readIriReference(), this.base, this.builder, this.lineAt(start)),
        propertyList: false,
      }
    }
    if (character === '[') {
      return { term: this.parseBlankNodePropertyList(), propertyList: true }
    }
    if (character === '(') {
      const head = this.parseCollection()
      return { term: head, propertyList: false }
    }
    if (character === '_' && this.peek(1) === ':') {
      const token = this.readNameToken()
      return { term: this.readBlankNode(token.value, start), propertyList: false }
    }
    const token = this.readNameToken()
    const iri = this.expandNameToken(token)
    if (!iri) this.fatal('invalid subject "' + token.value + '"', start)
    return { term: iri, propertyList: false }
  }

  parsePredicate() {
    this.skipWhitespace()
    const start = this.pos
    if (this.matchWord('a')) {
      this.pos++
      return ONTO_RDF_TYPE
    }
    if (this.peek() === '<') {
      return ontoRdfNormalizeIri(this.readIriReference(), this.base, this.builder, this.lineAt(start))
    }
    const token = this.readNameToken()
    const iri = this.expandNameToken(token)
    if (!iri) this.fatal('expected a predicate', start)
    return iri
  }

  parseObject() {
    this.skipWhitespace()
    const start = this.pos
    const character = this.peek()
    if (character === undefined) this.fatal('unexpected end of input, expected an object', start)
    if (character === '<') {
      return {
        term: ontoRdfNormalizeIri(this.readIriReference(), this.base, this.builder, this.lineAt(start)),
        kind: 'iri',
      }
    }
    if (character === '[') {
      return { term: this.parseBlankNodePropertyList(), kind: 'blank' }
    }
    if (character === '(') {
      const head = this.parseCollection()
      return { term: head, kind: head === ONTO_RDF_NIL ? 'iri' : 'blank' }
    }
    if (character === '_' && this.peek(1) === ':') {
      const token = this.readNameToken()
      return { term: this.readBlankNode(token.value, start), kind: 'blank' }
    }
    if (character === '"' || character === "'") return this.parseStringLiteral()
    if (character === '+' || character === '-' || character === '.' ||
      (character >= '0' && character <= '9')) {
      if (character === '.' && !(this.peek(1) >= '0' && this.peek(1) <= '9')) {
        this.fatal('unexpected "." where an object was expected', start)
      }
      return this.readNumber()
    }
    if (this.matchWord('true')) {
      this.pos += 4
      return { term: 'true', kind: 'literal', dt: ONTO_XSD_BOOLEAN }
    }
    if (this.matchWord('false')) {
      this.pos += 5
      return { term: 'false', kind: 'literal', dt: ONTO_XSD_BOOLEAN }
    }
    const token = this.readNameToken()
    const iri = this.expandNameToken(token)
    if (!iri) this.fatal('expected an object at "' + token.value + '"', start)
    return { term: iri, kind: 'iri' }
  }

  parsePredicateObjectList(subject) {
    let found = false
    while (true) {
      if (this.builder.truncated) break
      this.skipWhitespace()
      if (this.atEnd()) break
      const character = this.peek()
      if (character === '.' || character === ']' || character === ')' ||
        character === '}' || character === '{') break
      if (character === ';') {
        this.pos++
        continue
      }
      const predicate = this.parsePredicate()
      this.parseObjectList(subject, predicate)
      found = true
      this.skipWhitespace()
      if (this.peek() !== ';') break
      this.pos++
    }
    return found
  }

  parseObjectList(subject, predicate) {
    while (true) {
      const object = this.parseObject()
      const added = this.builder.add(subject, predicate, object.term, object.kind, object.dt, object.lang)
      this.skipWhitespace()
      if (!added || this.peek() !== ',') break
      this.pos++
      this.skipWhitespace()
    }
  }

  parseBlankNodePropertyList() {
    const start = this.pos
    if (this.depth >= this.builder.maxDepth) {
      this.noteNestingLimit(start)
      this.skipBalanced('[', ']')
      return this.builder.freshBlank()
    }
    this.depth++
    try {
      this.pos++
      const node = this.builder.freshBlank()
      this.skipWhitespace()
      if (this.peek() === ']') {
        this.pos++
        return node
      }
      this.parsePredicateObjectList(node)
      if (this.builder.truncated) return node
      this.skipWhitespace()
      if (this.peek() !== ']') this.fatal("expected ']' to close the blank node property list", this.pos)
      this.pos++
      return node
    } finally {
      this.depth--
    }
  }

  parseCollection() {
    const start = this.pos
    if (this.depth >= this.builder.maxDepth) {
      this.noteNestingLimit(start)
      this.skipBalanced('(', ')')
      return ONTO_RDF_NIL
    }
    this.depth++
    try {
      this.pos++
      this.skipWhitespace()
      if (this.peek() === ')') {
        this.pos++
        return ONTO_RDF_NIL
      }
      const head = this.builder.freshBlank()
      let current = head
      while (true) {
        const item = this.parseObject()
        const added = this.builder.add(current, ONTO_RDF_FIRST, item.term, item.kind, item.dt, item.lang)
        if (!added) return head
        this.skipWhitespace()
        if (this.peek() === ')') {
          this.pos++
          this.builder.add(current, ONTO_RDF_REST, ONTO_RDF_NIL, 'iri')
          break
        }
        if (this.peek() === undefined) this.fatal('unterminated RDF collection', start)
        const next = this.builder.freshBlank()
        this.builder.add(current, ONTO_RDF_REST, next, 'blank')
        current = next
      }
      return head
    } finally {
      this.depth--
    }
  }
}

/* ------------------------------------------------------------------ */
/* N-Triples / N-Quads                                                */
/* ------------------------------------------------------------------ */

class OntoNTriplesParser {
  constructor(text, options) {
    const opts = options || {}
    this.builder = new OntoRdfBuilder('ntriples', ontoRdfNormalizeText(text), opts)
    this.source = this.builder.text
    const initial = ontoRdfInitialBase(opts)
    this.base = initial.base
    this.builder.base = initial.base
    this.builder.baseSource = initial.source
  }

  parse() {
    const lines = this.source.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (this.builder.truncated) break
      let line = lines[i]
      if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1)
      const trimmed = line.trim()
      if (!trimmed || trimmed.charAt(0) === '#') continue
      this.parseLine(trimmed, i + 1)
    }
    return this.builder.finish()
  }

  parseLine(line, lineNumber) {
    const length = line.length
    let pos = 0
    const builder = this.builder
    const base = this.base
    const self = this

    const fail = (message) => {
      builder.error(message, lineNumber)
      const error = new Error(message)
      error.ontoRdfFatal = true
      throw error
    }

    const skip = () => {
      while (pos < length && (line[pos] === ' ' || line[pos] === '\t')) pos++
    }

    const readIri = () => {
      if (line[pos] !== '<') fail('expected an IRI reference')
      pos++
      let raw = ''
      while (pos < length) {
        const character = line[pos]
        if (character === '\\') {
          raw += character
          pos++
          if (pos < length) {
            raw += line[pos]
            pos++
          }
          continue
        }
        if (character === '>') {
          pos++
          return ontoRdfNormalizeIri(ontoRdfDecodeIriEscapes(raw, lineNumber, builder), base, builder, lineNumber)
        }
        raw += character
        pos++
      }
      fail('unterminated IRI reference')
      return ''
    }

    const readBlank = () => {
      const pattern = /_:([A-Za-z0-9_][A-Za-z0-9_.-]*)/y
      pattern.lastIndex = pos
      const match = pattern.exec(line)
      if (!match) fail('expected a blank node label')
      pos = pattern.lastIndex
      return builder.useBlank(match[1])
    }

    const readLiteral = () => {
      if (line[pos] !== '"') fail('expected a literal')
      pos++
      let raw = ''
      let closed = false
      while (pos < length) {
        const character = line[pos]
        if (character === '\\') {
          raw += character
          pos++
          if (pos < length) {
            raw += line[pos]
            pos++
          }
          continue
        }
        if (character === '"') {
          pos++
          closed = true
          break
        }
        raw += character
        pos++
      }
      if (!closed) fail('unterminated string literal')
      let language
      let datatype
      if (line[pos] === '@') {
        pos++
        const tagStart = pos
        while (pos < length && /[A-Za-z0-9-]/.test(line[pos])) pos++
        const tag = line.slice(tagStart, pos)
        if (!tag) builder.warn('empty language tag', lineNumber)
        else language = tag.toLowerCase()
      } else if (line[pos] === '^' && line[pos + 1] === '^') {
        pos += 2
        datatype = readIri()
      }
      return {
        term: ontoRdfDecodeEscapes(raw, lineNumber, builder),
        kind: 'literal',
        dt: datatype,
        lang: language,
      }
    }

    try {
      skip()
      let subject
      if (line[pos] === '<') subject = readIri()
      else if (line[pos] === '_' && line[pos + 1] === ':') subject = readBlank()
      else fail('expected a subject IRI or blank node')

      skip()
      if (line[pos] !== '<') fail('expected a predicate IRI')
      const predicate = readIri()

      skip()
      let object
      if (line[pos] === '<') object = { term: readIri(), kind: 'iri' }
      else if (line[pos] === '_' && line[pos + 1] === ':') object = { term: readBlank(), kind: 'blank' }
      else if (line[pos] === '"') object = readLiteral()
      else fail('expected an object')

      skip()
      let graphLabel
      if (line[pos] === '<' || (line[pos] === '_' && line[pos + 1] === ':')) {
        if (line[pos] === '<') graphLabel = readIri()
        else graphLabel = readBlank()
        skip()
      }

      if (line[pos] !== '.') fail("expected '.' at the end of the statement")
      pos++
      skip()
      if (pos < length && line[pos] !== '#') {
        builder.warn('extra content after the statement was ignored', lineNumber)
      }

      if (graphLabel !== undefined) {
        builder.diagnose(
          'named-graph-ignored',
          'warning',
          'graph term "' + graphLabel + '" was ignored; N-Quads datasets are not supported',
          lineNumber,
        )
      }
      builder.add(subject, predicate, object.term, object.kind, object.dt, object.lang)
    } catch (error) {
      if (error && error.ontoRdfFatal) return
      builder.error(
        'failed to parse line: ' + (error && error.message ? error.message : String(error)),
        lineNumber,
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* RDF/XML                                                            */
/* ------------------------------------------------------------------ */

function ontoRdfDecodeXmlEntity(body, builder, line) {
  if (body === 'amp') return '&'
  if (body === 'lt') return '<'
  if (body === 'gt') return '>'
  if (body === 'quot') return '"'
  if (body === 'apos') return "'"
  if (body.charAt(0) === '#') {
    let code
    if (body.charAt(1) === 'x' || body.charAt(1) === 'X') code = parseInt(body.slice(2), 16)
    else code = parseInt(body.slice(1), 10)
    if (!isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      builder.warn('invalid XML character reference &' + body + ';', line)
      return '\uFFFD'
    }
    return String.fromCodePoint(code)
  }
  if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(body)) {
    builder.warn('unknown XML entity &' + body + ';', line)
  }
  return null
}

function ontoRdfDecodeXmlEntities(raw, builder, line) {
  let output = ''
  let index = 0
  while (index < raw.length) {
    const amp = raw.indexOf('&', index)
    if (amp < 0) {
      output += raw.slice(index)
      break
    }
    output += raw.slice(index, amp)
    const semi = raw.indexOf(';', amp + 1)
    if (semi < 0) {
      output += raw.slice(amp)
      break
    }
    const body = raw.slice(amp + 1, semi)
    const decoded = ontoRdfDecodeXmlEntity(body, builder, line)
    output += decoded === null ? raw.slice(amp, semi + 1) : decoded
    index = semi + 1
  }
  return output
}

function ontoRdfXmlSplitName(qname) {
  const colon = qname.indexOf(':')
  if (colon < 0) return { prefix: '', local: qname }
  return { prefix: qname.slice(0, colon), local: qname.slice(colon + 1) }
}

class OntoRdfXmlParser {
  constructor(text, options) {
    const opts = options || {}
    this.builder = new OntoRdfBuilder('rdfxml', ontoRdfNormalizeText(text), opts)
    this.source = this.builder.text
    const initial = ontoRdfInitialBase(opts)
    this.initialBase = initial.base
    this.initialBaseSource = initial.source
    this.builder.base = initial.base
    this.builder.baseSource = initial.source
    this.depth = 0
    this.warnedReification = false
    this.warnedMultipleObjectsSubjects = Object.create(null)
  }

  /** Resolve xmlns declarations iteratively so deep XML cannot overflow the stack. */
  resolveNamespaces(root) {
    const stack = [{ element: root, inherited: {}, depth: 0 }]
    while (stack.length > 0) {
      const frame = stack.pop()
      const element = frame.element
      const namespaces = Object.assign({}, frame.inherited)
      const keys = Object.keys(element.attrs)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (key === 'xmlns') {
          if (element.attrs[key]) namespaces[''] = element.attrs[key]
          else delete namespaces['']
        } else if (key.slice(0, 6) === 'xmlns:') {
          const prefix = key.slice(6)
          if (element.attrs[key]) namespaces[prefix] = element.attrs[key]
          else delete namespaces[prefix]
        }
      }
      element.namespaces = namespaces
      if (frame.depth >= this.builder.maxDepth) continue
      for (let i = element.children.length - 1; i >= 0; i--) {
        stack.push({ element: element.children[i], inherited: namespaces, depth: frame.depth + 1 })
      }
    }
  }

  parse() {
    try {
      const root = this.tokenize()
      if (!root) {
        if (this.builder.errors.length === 0) this.builder.error('no root element found')
      } else {
        this.mapDocument(root)
      }
    } catch (error) {
      this.builder.error(
        'XML parser failed: ' + (error && error.message ? error.message : String(error)),
      )
    }
    return this.builder.finish()
  }

  /* ------------------------- XML tokenizer ------------------------- */

  tokenize() {
    const source = this.source
    const length = source.length
    const builder = this.builder
    const root = {
      qname: '#document',
      attrs: {},
      children: [],
      text: '',
      namespaces: {},
      line: 1,
      openEnd: 0,
      closeStart: -1,
    }
    const stack = [root]
    let pos = 0

    const current = () => stack[stack.length - 1]

    const skipSpace = () => {
      while (pos < length && ontoRdfIsWhitespace(source[pos])) pos++
    }

    const appendText = (value) => {
      if (!value) return
      const element = current()
      if (element === root) {
        if (value.trim() !== '') builder.warn('text outside the document element was ignored', builder.lineAt(pos))
        return
      }
      element.text += value
    }

    const skipDeclaration = () => {
      let index = pos + 2
      let brackets = 0
      let quote = ''
      while (index < length) {
        const character = source[index]
        if (quote) {
          if (character === quote) quote = ''
          index++
          continue
        }
        if (character === '"' || character === "'") {
          quote = character
          index++
          continue
        }
        if (character === '[') brackets++
        else if (character === ']' && brackets > 0) brackets--
        else if (character === '>' && brackets === 0) {
          pos = index + 1
          return
        }
        index++
      }
      builder.error('unterminated markup declaration', builder.lineAt(pos))
      pos = length
    }

    const closeTag = () => {
      const start = pos
      pos += 2
      skipSpace()
      const nameStart = pos
      while (pos < length && !ontoRdfIsWhitespace(source[pos]) && source[pos] !== '>') pos++
      const qname = source.slice(nameStart, pos)
      skipSpace()
      if (source[pos] !== '>') {
        builder.error('expected ">" in closing tag </' + qname + '>', builder.lineAt(start))
        const next = source.indexOf('>', pos)
        pos = next < 0 ? length : next + 1
      } else {
        pos++
      }
      if (stack.length <= 1) {
        builder.error('unexpected closing tag </' + qname + '>', builder.lineAt(start))
        return
      }
      const element = stack.pop()
      if (element.qname !== qname) {
        builder.error(
          'mismatched closing tag </' + qname + '> for <' + element.qname + '>',
          builder.lineAt(start),
        )
      }
      element.closeStart = start
    }

    const openTag = () => {
      const start = pos
      pos++
      const nameStart = pos
      while (pos < length && !ontoRdfIsWhitespace(source[pos]) && source[pos] !== '>' && source[pos] !== '/') pos++
      const qname = source.slice(nameStart, pos)
      if (!qname) {
        builder.error('invalid element name', builder.lineAt(start))
        const next = source.indexOf('>', pos)
        pos = next < 0 ? length : next + 1
        return
      }
      const attrs = {}
      let selfClosing = false
      while (true) {
        skipSpace()
        if (pos >= length) {
          builder.error('unterminated start tag <' + qname + '>', builder.lineAt(start))
          return
        }
        if (source[pos] === '>') {
          pos++
          break
        }
        if (source[pos] === '/' && source[pos + 1] === '>') {
          pos += 2
          selfClosing = true
          break
        }
        const attrStart = pos
        while (pos < length && !ontoRdfIsWhitespace(source[pos]) && source[pos] !== '=' &&
          source[pos] !== '>' && source[pos] !== '/') pos++
        const attrName = source.slice(attrStart, pos)
        if (!attrName) {
          builder.error('invalid attribute in <' + qname + '>', builder.lineAt(pos))
          pos++
          continue
        }
        skipSpace()
        if (source[pos] !== '=') {
          builder.error('expected "=" after attribute "' + attrName + '"', builder.lineAt(attrStart))
          const next = source.indexOf('>', pos)
          pos = next < 0 ? length : next + 1
          return
        }
        pos++
        skipSpace()
        const quote = source[pos]
        if (quote !== '"' && quote !== "'") {
          builder.error('expected a quoted attribute value for "' + attrName + '"', builder.lineAt(pos))
          const next = source.indexOf('>', pos)
          pos = next < 0 ? length : next + 1
          return
        }
        pos++
        const valueStart = pos
        while (pos < length && source[pos] !== quote) pos++
        const rawValue = source.slice(valueStart, pos)
        if (pos >= length) {
          builder.error('unterminated attribute value for "' + attrName + '"', builder.lineAt(valueStart))
        } else {
          pos++
        }
        if (ontoRdfHas(attrs, attrName)) {
          builder.warn('duplicate attribute "' + attrName + '"', builder.lineAt(attrStart))
        }
        attrs[attrName] = ontoRdfDecodeXmlEntities(rawValue, builder, builder.lineAt(valueStart))
      }
      const element = {
        qname: qname,
        attrs: attrs,
        children: [],
        text: '',
        namespaces: {},
        line: builder.lineAt(start),
        openEnd: pos,
        closeStart: selfClosing ? pos : -1,
      }
      if (current() === root) {
        if (root.children.length > 0) builder.error('multiple root elements are not allowed', element.line)
      }
      current().children.push(element)
      if (!selfClosing) stack.push(element)
    }

    while (pos < length) {
      const lessThan = source.indexOf('<', pos)
      if (lessThan < 0) {
        appendText(ontoRdfDecodeXmlEntities(source.slice(pos), builder, builder.lineAt(pos)))
        pos = length
        break
      }
      if (lessThan > pos) {
        appendText(ontoRdfDecodeXmlEntities(source.slice(pos, lessThan), builder, builder.lineAt(pos)))
      }
      pos = lessThan
      if (source.slice(pos, pos + 4) === '<!--') {
        const end = source.indexOf('-->', pos + 4)
        if (end < 0) {
          builder.error('unterminated XML comment', builder.lineAt(pos))
          pos = length
        } else {
          pos = end + 3
        }
      } else if (source.slice(pos, pos + 9) === '<![CDATA[') {
        const end = source.indexOf(']]>', pos + 9)
        if (end < 0) {
          builder.error('unterminated CDATA section', builder.lineAt(pos))
          appendText(source.slice(pos + 9))
          pos = length
        } else {
          appendText(source.slice(pos + 9, end))
          pos = end + 3
        }
      } else if (source.slice(pos, pos + 2) === '<?') {
        const end = source.indexOf('?>', pos + 2)
        if (end < 0) {
          builder.error('unterminated processing instruction', builder.lineAt(pos))
          pos = length
        } else {
          pos = end + 2
        }
      } else if (source.slice(pos, pos + 2) === '<!') {
        skipDeclaration()
      } else if (source.slice(pos, pos + 2) === '</') {
        closeTag()
      } else {
        openTag()
      }
    }

    while (stack.length > 1) {
      const element = stack.pop()
      element.closeStart = length
      builder.error('unclosed element <' + element.qname + '>', element.line)
    }

    return root.children[0] || null
  }

  /* --------------------------- mapping ---------------------------- */

  elementIri(element) {
    const parts = ontoRdfXmlSplitName(element.qname)
    if (parts.prefix === '') {
      const namespace = element.namespaces['']
      return namespace ? namespace + parts.local : null
    }
    if (parts.prefix === 'xml') return ONTO_XML_NS + parts.local
    const namespace = element.namespaces[parts.prefix]
    return namespace ? namespace + parts.local : null
  }

  attributeIri(element, qname) {
    const parts = ontoRdfXmlSplitName(qname)
    if (parts.prefix === '') return null
    if (parts.prefix === 'xml') return ONTO_XML_NS + parts.local
    const namespace = element.namespaces[parts.prefix]
    return namespace ? namespace + parts.local : null
  }

  getAttribute(element, iri) {
    const keys = Object.keys(element.attrs)
    for (let i = 0; i < keys.length; i++) {
      if (this.attributeIri(element, keys[i]) === iri) return element.attrs[keys[i]]
    }
    return undefined
  }

  isSyntaxAttribute(iri) {
    return iri === ONTO_RDF_NS + 'about' ||
      iri === ONTO_RDF_NS + 'ID' ||
      iri === ONTO_RDF_NS + 'nodeID' ||
      iri === ONTO_RDF_NS + 'resource' ||
      iri === ONTO_RDF_NS + 'datatype' ||
      iri === ONTO_RDF_NS + 'parseType' ||
      iri === ONTO_RDF_NS + 'li'
  }

  propertyAttributes(element) {
    const result = []
    const keys = Object.keys(element.attrs)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (key === 'xmlns' || key.slice(0, 6) === 'xmlns:') continue
      const iri = this.attributeIri(element, key)
      if (!iri) continue
      if (iri.indexOf(ONTO_XML_NS) === 0) continue
      if (this.isSyntaxAttribute(iri)) continue
      result.push({ iri: iri, value: element.attrs[key] })
    }
    return result
  }

  contextFor(element, parent) {
    let base = parent.base || ''
    let baseSource = parent.baseSource || 'none'
    const xmlBase = this.getAttribute(element, ONTO_XML_NS + 'base')
    if (xmlBase !== undefined) {
      if (xmlBase === '') {
        // XML Base: an empty value keeps the base URI of the enclosing scope.
        base = parent.base || ''
      } else if (ontoRdfIsAbsoluteIri(xmlBase)) {
        base = xmlBase
        baseSource = 'document'
      } else if (base) {
        base = resolveIri(base, xmlBase)
        baseSource = 'document'
      } else {
        this.builder.diagnose(
          'base-unavailable',
          'warning',
          'relative xml:base "' + xmlBase + '" has no base to resolve against',
          element.line,
        )
        base = ''
      }
    }
    let language = parent.language
    const xmlLang = this.getAttribute(element, ONTO_XML_NS + 'lang')
    if (xmlLang !== undefined) language = xmlLang === '' ? undefined : xmlLang.toLowerCase()
    return { base: base, language: language, baseSource: baseSource }
  }

  resolveTerm(value, base, line) {
    return ontoRdfNormalizeIri(value, base, this.builder, line)
  }

  resolveId(value, base, line) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) {
      this.builder.warn('rdf:ID "' + value + '" is not a valid XML name', line)
    }
    if (!base) {
      this.builder.diagnose(
        'base-unavailable',
        'warning',
        'rdf:ID "' + value + '" cannot be resolved without a base IRI',
        line,
      )
      return '#' + value
    }
    return resolveIri(base, '#' + value)
  }

  collectXmlPrefixes(root) {
    const stack = [root]
    while (stack.length > 0) {
      const element = stack.pop()
      const keys = Object.keys(element.attrs)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (key.slice(0, 6) !== 'xmlns:') continue
        const prefix = key.slice(6)
        const iri = element.attrs[key]
        if (prefix && iri) this.builder.prefixes[prefix] = iri
      }
      for (let i = element.children.length - 1; i >= 0; i--) {
        stack.push(element.children[i])
      }
    }
  }

  mapDocument(root) {
    this.resolveNamespaces(root)
    this.collectXmlPrefixes(root)
    const iri = this.elementIri(root)
    if (!iri) {
      this.builder.error('cannot resolve the root element name <' + root.qname + '>', root.line)
      return
    }
    const context = this.contextFor(root, {
      base: this.initialBase,
      language: undefined,
      baseSource: this.initialBaseSource,
    })
    if (iri === ONTO_RDF_NS + 'RDF') {
      this.builder.base = context.base || ''
      this.builder.baseSource = context.baseSource || 'none'
      for (let i = 0; i < root.children.length; i++) {
        if (this.builder.truncated) break
        this.mapNodeElement(root.children[i], context)
      }
    } else {
      this.builder.base = context.base || ''
      this.builder.baseSource = context.baseSource || 'none'
      this.mapNodeElement(root, context)
    }
  }

  mapNodeElement(element, parentContext) {
    if (this.builder.truncated) return null
    const context = this.contextFor(element, parentContext)
    if (this.depth >= this.builder.maxDepth) {
      this.noteXmlNestingLimit(element)
      return null
    }
    this.depth++
    try {
      return this.mapNodeElementBody(element, context)
    } finally {
      this.depth--
    }
  }

  noteXmlNestingLimit(element) {
    this.builder.diagnose(
      'nesting-limit',
      'error',
      'XML nesting depth limit of ' + this.builder.maxDepth +
        ' reached; the nested branch was skipped',
      element.line,
    )
  }

  mapNodeElementBody(element, context) {
    const nameIri = this.elementIri(element)
    if (!nameIri) {
      this.builder.error('cannot resolve the element name <' + element.qname + '>', element.line)
      return null
    }
    if (nameIri === ONTO_RDF_NS + 'RDF') {
      this.builder.base = context.base || ''
      this.builder.baseSource = context.baseSource || 'none'
      for (let i = 0; i < element.children.length; i++) {
        if (this.builder.truncated) break
        this.mapNodeElement(element.children[i], context)
      }
      return null
    }

    const about = this.getAttribute(element, ONTO_RDF_NS + 'about')
    const id = this.getAttribute(element, ONTO_RDF_NS + 'ID')
    const nodeId = this.getAttribute(element, ONTO_RDF_NS + 'nodeID')
    let subject
    if (about !== undefined) {
      subject = this.resolveTerm(about, context.base, element.line)
    } else if (id !== undefined) {
      subject = this.resolveId(id, context.base, element.line)
    } else if (nodeId !== undefined) {
      subject = this.builder.useBlank(nodeId)
    } else {
      subject = this.builder.freshBlank()
    }

    if (nameIri !== ONTO_RDF_NS + 'Description') {
      this.builder.add(subject, ONTO_RDF_TYPE, nameIri, 'iri')
    }

    this.addAttributeTriples(element, subject, context)
    this.mapChildProperties(element, subject, context)
    return subject
  }

  addAttributeTriples(element, subject, context) {
    const attributes = this.propertyAttributes(element)
    for (let i = 0; i < attributes.length; i++) {
      const attribute = attributes[i]
      if (attribute.iri === ONTO_RDF_TYPE) {
        this.builder.add(
          subject,
          ONTO_RDF_TYPE,
          this.resolveTerm(attribute.value, context.base, element.line),
          'iri',
        )
      } else {
        this.builder.add(subject, attribute.iri, attribute.value, 'literal', undefined, context.language)
      }
    }
  }

  mapChildProperties(element, subject, context) {
    let liIndex = 0
    for (let i = 0; i < element.children.length; i++) {
      if (this.builder.truncated) break
      const child = element.children[i]
      let predicate = this.elementIri(child)
      if (!predicate) {
        this.builder.error('cannot resolve the property element <' + child.qname + '>', child.line)
        continue
      }
      if (predicate === ONTO_RDF_NS + 'li') {
        liIndex++
        predicate = ONTO_RDF_NS + '_' + liIndex
      }
      this.mapPropertyElement(child, subject, predicate, context)
    }
  }

  mapPropertyElement(element, subject, predicate, parentContext) {
    if (this.builder.truncated) return
    const context = this.contextFor(element, parentContext)
    if (this.depth >= this.builder.maxDepth) {
      this.noteXmlNestingLimit(element)
      return
    }
    this.depth++
    try {
      this.mapPropertyElementBody(element, subject, predicate, context)
    } finally {
      this.depth--
    }
  }

  mapPropertyElementBody(element, subject, predicate, context) {
    const parseType = this.getAttribute(element, ONTO_RDF_NS + 'parseType')
    const resource = this.getAttribute(element, ONTO_RDF_NS + 'resource')
    const nodeId = this.getAttribute(element, ONTO_RDF_NS + 'nodeID')
    const datatype = this.getAttribute(element, ONTO_RDF_NS + 'datatype')
    const id = this.getAttribute(element, ONTO_RDF_NS + 'ID')

    if (id !== undefined && !this.warnedReification) {
      this.warnedReification = true
      this.builder.diagnose(
        'rdfxml-reification-ignored',
        'warning',
        'rdf:ID reification is not implemented; the statement itself was kept',
        element.line,
      )
    }

    if (parseType === 'Resource') {
      const blank = this.builder.freshBlank()
      this.builder.add(subject, predicate, blank, 'blank')
      this.addAttributeTriples(element, blank, context)
      this.mapChildProperties(element, blank, context)
      return
    }

    if (parseType === 'Collection') {
      const head = this.mapCollection(element.children, context)
      this.builder.add(subject, predicate, head, head === ONTO_RDF_NIL ? 'iri' : 'blank')
      return
    }

    if (parseType === 'Literal') {
      const raw = element.closeStart >= 0 ? this.source.slice(element.openEnd, element.closeStart) : ''
      this.builder.add(subject, predicate, raw, 'literal', ONTO_RDF_XML_LITERAL)
      return
    }

    if (parseType !== undefined && parseType !== '') {
      this.builder.diagnose(
        'rdfxml-parsetype-unsupported',
        'warning',
        'unsupported rdf:parseType="' + parseType + '"; treated as a plain property',
        element.line,
      )
    }

    if (resource !== undefined) {
      if (element.children.length > 0) {
        this.builder.warn('rdf:resource with nested elements is not valid; nested elements were ignored', element.line)
      }
      this.builder.add(subject, predicate, this.resolveTerm(resource, context.base, element.line), 'iri')
      return
    }

    if (nodeId !== undefined) {
      this.builder.add(subject, predicate, this.builder.useBlank(nodeId), 'blank')
      return
    }

    if (element.children.length > 0) {
      const childSubject = this.mapNodeElement(element.children[0], context)
      if (childSubject) {
        this.builder.add(
          subject,
          predicate,
          childSubject,
          childSubject.slice(0, 2) === '_:' ? 'blank' : 'iri',
        )
      }
      if (element.children.length > 1 && this.warnedMultipleObjectsSubjects[subject] !== true) {
        this.warnedMultipleObjectsSubjects[subject] = true
        this.builder.diagnose(
          'rdfxml-multiple-objects',
          'warning',
          'property element <' + element.qname + '> has multiple objects; only the first was used',
          element.line,
        )
      }
      return
    }

    let value = element.text
    const attributes = this.propertyAttributes(element)
    if (value === '' && attributes.length > 0) {
      const blank = this.builder.freshBlank()
      this.builder.add(subject, predicate, blank, 'blank')
      for (let i = 0; i < attributes.length; i++) {
        this.builder.add(
          blank,
          attributes[i].iri,
          attributes[i].value,
          'literal',
          undefined,
          context.language,
        )
      }
      return
    }

    if (datatype !== undefined) {
      this.builder.add(
        subject,
        predicate,
        value,
        'literal',
        this.resolveTerm(datatype, context.base, element.line),
      )
    } else {
      this.builder.add(subject, predicate, value, 'literal', undefined, context.language)
    }
  }

  mapCollection(children, context) {
    if (children.length === 0) return ONTO_RDF_NIL
    const head = this.builder.freshBlank()
    const items = []
    for (let i = 0; i < children.length; i++) {
      if (this.builder.truncated) break
      const item = this.mapNodeElement(children[i], context)
      if (item) items.push(item)
    }
    if (items.length === 0) return ONTO_RDF_NIL
    let current = head
    for (let i = 0; i < items.length; i++) {
      this.builder.add(
        current,
        ONTO_RDF_FIRST,
        items[i],
        items[i].slice(0, 2) === '_:' ? 'blank' : 'iri',
      )
      if (i < items.length - 1) {
        const next = this.builder.freshBlank()
        this.builder.add(current, ONTO_RDF_REST, next, 'blank')
        current = next
      } else {
        this.builder.add(current, ONTO_RDF_REST, ONTO_RDF_NIL, 'iri')
      }
    }
    return head
  }
}

/* ------------------------------------------------------------------ */
/* JSON-LD (practical subset)                                         */
/* ------------------------------------------------------------------ */

class OntoJsonLdParser {
  constructor(text, options) {
    const opts = options || {}
    this.builder = new OntoRdfBuilder('jsonld', ontoRdfNormalizeText(text), opts)
    this.source = this.builder.text
    const initial = ontoRdfInitialBase(opts)
    this.initialBase = initial.base
    this.initialBaseSource = initial.source
    this.builder.base = initial.base
    this.builder.baseSource = initial.source
    this.depth = 0
    this.warnedContainers = Object.create(null)
    this.appliedContextNodes = new WeakSet()
  }

  parse() {
    let data
    try {
      data = JSON.parse(this.source)
    } catch (error) {
      this.builder.error('invalid JSON: ' + (error && error.message ? error.message : String(error)))
      return this.builder.finish()
    }
    try {
      const context = this.newContext(this.initialBase, this.initialBaseSource)
      this.processTop(data, context)
    } catch (error) {
      this.builder.error(
        'JSON-LD parser failed: ' + (error && error.message ? error.message : String(error)),
      )
    }
    return this.builder.finish()
  }

  newContext(base, baseSource) {
    return {
      terms: Object.create(null),
      vocab: '',
      base: base || '',
      baseSource: baseSource || 'none',
      language: '',
    }
  }

  withContext(context, raw) {
    const next = {
      terms: Object.assign(Object.create(null), context.terms),
      vocab: context.vocab,
      base: context.base,
      baseSource: context.baseSource,
      language: context.language,
    }
    this.applyContext(next, raw)
    return next
  }

  applyContext(context, raw) {
    if (raw === null) {
      context.terms = Object.create(null)
      context.vocab = ''
      context.language = ''
      context.base = this.initialBase
      context.baseSource = this.initialBaseSource
      this.syncPrefixes(context)
      return
    }
    const items = Array.isArray(raw) ? raw : [raw]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (typeof item === 'string') {
        this.builder.diagnose(
          'jsonld-remote-context-skipped',
          'warning',
          'remote @context "' + item + '" was not fetched and was skipped',
        )
        continue
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        this.builder.warn('unsupported @context entry was skipped')
        continue
      }
      if (ontoRdfHas(item, '@base')) {
        const base = item['@base']
        if (base === null) {
          context.base = ''
          context.baseSource = 'none'
        } else if (typeof base === 'string') {
          if (ontoRdfIsAbsoluteIri(base)) {
            context.base = base
            context.baseSource = 'document'
          } else if (context.base) {
            context.base = resolveIri(context.base, base)
            context.baseSource = 'document'
          } else {
            this.builder.diagnose(
              'base-unavailable',
              'warning',
              'relative @base "' + base + '" has no base to resolve against',
            )
            context.base = ''
            context.baseSource = 'none'
          }
        }
      }
      if (ontoRdfHas(item, '@vocab')) {
        const vocab = item['@vocab']
        if (vocab === null) context.vocab = ''
        else if (typeof vocab === 'string') {
          context.vocab = this.expandIri(vocab, context, { vocab: false, document: true }) || ''
        }
      }
      if (ontoRdfHas(item, '@language')) {
        const language = item['@language']
        context.language = typeof language === 'string' ? language.toLowerCase() : ''
      }
      const keys = Object.keys(item)
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]
        if (key === '@base' || key === '@vocab' || key === '@language' || key === '@version') continue
        if (key.charAt(0) === '@') {
          if (key !== '@context') this.builder.warn('unsupported context keyword "' + key + '" was skipped')
          continue
        }
        this.defineTerm(context, key, item[key])
      }
    }
    this.syncPrefixes(context)
  }

  syncPrefixes(context) {
    const terms = Object.keys(context.terms)
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]
      const definition = context.terms[term]
      if (!definition) continue
      const id = definition.id
      if (typeof id !== 'string' || id === '' || id.charAt(0) === '@') continue
      if (definition.prefix || /[/#]$/.test(id)) this.builder.prefixes[term] = id
    }
  }

  defineTerm(context, term, value) {
    if (term.indexOf(':') >= 0) {
      this.builder.warn('term "' + term + '" contains a colon and was ignored')
      return
    }
    if (value === null) {
      context.terms[term] = { id: null, type: null, language: undefined, container: null, prefix: false }
      return
    }
    if (typeof value === 'string') {
      const id = this.expandIri(value, context, { vocab: true, document: true })
      context.terms[term] = {
        id: id,
        type: null,
        language: undefined,
        container: null,
        prefix: typeof id === 'string' && /[/#]$/.test(id),
      }
      return
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.builder.warn('unsupported definition for term "' + term + '" was skipped')
      return
    }
    const definition = {
      id: null,
      type: null,
      language: undefined,
      container: null,
      prefix: false,
    }
    if (ontoRdfHas(value, '@reverse')) {
      definition.id = this.expandIri(value['@reverse'], context, { vocab: true, document: true })
      this.builder.diagnose(
        'jsonld-reverse-term-forward',
        'warning',
        '@reverse term definitions are treated as forward properties',
      )
    } else if (ontoRdfHas(value, '@id')) {
      const id = value['@id']
      if (id === null) definition.id = null
      else if (typeof id === 'string') {
        definition.id = this.expandIri(id, context, { vocab: true, document: true })
      }
    } else {
      definition.id = this.expandIri(term, context, { vocab: true, document: false })
    }
    if (ontoRdfHas(value, '@type')) {
      const type = value['@type']
      if (typeof type === 'string') {
        if (type === '@id' || type === '@vocab' || type === '@json') definition.type = type
        else definition.type = this.expandIri(type, context, { vocab: true, document: true })
      }
    }
    if (ontoRdfHas(value, '@language')) {
      const language = value['@language']
      definition.language = typeof language === 'string' ? language.toLowerCase() : null
    }
    if (ontoRdfHas(value, '@container')) {
      const container = value['@container']
      definition.container = Array.isArray(container) ? container.slice() : container
      this.noteContainer(container, term)
    }
    if (ontoRdfHas(value, '@prefix')) definition.prefix = value['@prefix'] === true
    if (ontoRdfHas(value, '@context')) this.builder.warn('nested @context in term "' + term + '" was skipped')
    if (typeof definition.id === 'string' && /[/#]$/.test(definition.id)) definition.prefix = true
    context.terms[term] = definition
  }

  noteContainer(container, term) {
    const list = Array.isArray(container) ? container : [container]
    for (let i = 0; i < list.length; i++) {
      const name = list[i]
      if (name === '@set' || name === '@list' || name === '@language' || name === '@index') continue
      const key = term + '|' + name
      if (this.warnedContainers[key]) continue
      this.warnedContainers[key] = true
      this.builder.diagnose(
        'jsonld-container-unsupported',
        'warning',
        '@container "' + name + '" on term "' + term + '" is not supported',
      )
    }
  }

  expandIri(value, context, options) {
    if (typeof value !== 'string') return null
    if (value === '') return options.document ? context.base : null
    if (value.charAt(0) === '@') return value
    if (value.slice(0, 2) === '_:') return value
    if (ontoRdfHas(context.terms, value)) {
      const definition = context.terms[value]
      return definition && typeof definition.id === 'string' ? definition.id : null
    }
    const colon = value.indexOf(':')
    if (colon > 0) {
      const prefix = value.slice(0, colon)
      const suffix = value.slice(colon + 1)
      if (ontoRdfHas(context.terms, prefix)) {
        const definition = context.terms[prefix]
        if (definition && typeof definition.id === 'string') return definition.id + suffix
      }
      return value
    }
    if (options.vocab && context.vocab) return context.vocab + value
    if (options.document && context.base) return resolveIri(context.base, value)
    return null
  }

  normalizeIri(value, context) {
    if (typeof value !== 'string' || value === '') return value
    if (value.slice(0, 2) === '_:') {
      this.builder.useBlank(value)
      return value
    }
    if (ontoRdfIsAbsoluteIri(value)) return value
    if (context.base) return resolveIri(context.base, value)
    this.builder.diagnose(
      'base-unavailable',
      'warning',
      'relative IRI "' + value + '" could not be resolved (no base)',
    )
    return value
  }

  literalLanguage(definition, context) {
    if (definition && definition.language !== undefined) {
      return definition.language === null ? undefined : definition.language
    }
    return context.language || undefined
  }

  processTop(data, context) {
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        if (this.builder.truncated) break
        this.processNode(data[i], context)
      }
      return
    }
    if (data === null || typeof data !== 'object') {
      this.builder.error('JSON-LD document must be an object or an array')
      return
    }
    let local = context
    if (ontoRdfHas(data, '@context')) {
      local = this.withContext(context, data['@context'])
      this.appliedContextNodes.add(data)
    }
    this.builder.base = local.base || ''
    this.builder.baseSource = local.baseSource || 'none'
    // processNode handles a top-level @graph object, including its sibling keys.
    this.processNode(data, local)
  }

  processNode(node, inheritedContext) {
    if (Array.isArray(node)) {
      if (this.depth >= this.builder.maxDepth) {
        this.noteJsonLdNestingLimit()
        return null
      }
      this.depth++
      try {
        for (let i = 0; i < node.length; i++) {
          if (this.builder.truncated) break
          this.processNode(node[i], inheritedContext)
        }
      } finally {
        this.depth--
      }
      return null
    }
    if (node === null || typeof node !== 'object') return null
    let context = inheritedContext
    if (ontoRdfHas(node, '@context') && !this.appliedContextNodes.has(node)) {
      context = this.withContext(inheritedContext, node['@context'])
      this.appliedContextNodes.add(node)
    }
    if (ontoRdfHas(node, '@value') || ontoRdfHas(node, '@list') || ontoRdfHas(node, '@set')) {
      this.builder.diagnose(
        'jsonld-value-object-dropped',
        'warning',
        'value object used where a node was expected was ignored',
      )
      return null
    }
    if (this.depth >= this.builder.maxDepth) {
      this.noteJsonLdNestingLimit()
      return null
    }
    this.depth++
    try {
      return this.processNodeBody(node, context)
    } finally {
      this.depth--
    }
  }

  noteJsonLdNestingLimit() {
    this.builder.diagnose(
      'nesting-limit',
      'error',
      'JSON-LD nesting depth limit of ' + this.builder.maxDepth +
        ' reached; the nested branch was skipped',
    )
  }

  processNodeBody(node, context) {
    const graphWithoutId = ontoRdfHas(node, '@graph') && !ontoRdfHas(node, '@id')
    if (graphWithoutId) {
      const graph = node['@graph']
      const items = Array.isArray(graph) ? graph : [graph]
      for (let i = 0; i < items.length; i++) {
        if (this.builder.truncated) break
        this.processNode(items[i], context)
      }
    }

    let subject
    if (ontoRdfHas(node, '@id')) {
      const id = node['@id']
      if (typeof id !== 'string') {
        this.builder.warn('non-string @id was replaced by a blank node')
        subject = this.builder.freshBlank()
      } else {
        const expanded = this.expandIri(id, context, { vocab: false, document: true })
        subject = this.normalizeIri(expanded || id, context)
        if (typeof subject === 'string' && subject.charAt(0) === '@') {
          this.builder.warn('keyword "' + subject + '" cannot be used as @id')
          subject = this.builder.freshBlank()
        }
      }
    } else {
      subject = this.builder.freshBlank()
    }

    if (ontoRdfHas(node, '@type')) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
      for (let i = 0; i < types.length; i++) {
        if (this.builder.truncated) break
        const type = types[i]
        if (typeof type !== 'string') continue
        const expanded = this.expandIri(type, context, { vocab: true, document: true })
        if (!expanded || expanded.charAt(0) === '@') {
          this.builder.warn('could not expand @type "' + type + '"')
          continue
        }
        const iri = this.normalizeIri(expanded, context)
        this.builder.add(subject, ONTO_RDF_TYPE, iri, iri.slice(0, 2) === '_:' ? 'blank' : 'iri')
      }
    }

    const keys = Object.keys(node)
    for (let i = 0; i < keys.length; i++) {
      if (this.builder.truncated) break
      const key = keys[i]
      if (key === '@context' || key === '@id' || key === '@type' || key === '@index') continue
      if (key === '@graph') {
        if (graphWithoutId) continue
        const graph = node[key]
        const items = Array.isArray(graph) ? graph : [graph]
        for (let g = 0; g < items.length; g++) {
          if (this.builder.truncated) break
          this.processNode(items[g], context)
        }
        continue
      }
      if (key === '@reverse') {
        this.builder.diagnose(
          'jsonld-node-reverse-ignored',
          'warning',
          '@reverse is not supported and was skipped',
        )
        continue
      }
      if (key === '@included' || key === '@nest') {
        this.builder.diagnose(
          'jsonld-included-nest-ignored',
          'warning',
          '"' + key + '" is not supported and was skipped',
        )
        continue
      }
      if (key === '@value' || key === '@list' || key === '@set' || key === '@language') continue

      const definition = ontoRdfHas(context.terms, key) ? context.terms[key] : null
      const predicate = this.expandIri(key, context, { vocab: true, document: false })
      if (!predicate || predicate.charAt(0) === '@') {
        this.builder.warn('term "' + key + '" has no IRI mapping and was skipped')
        continue
      }
      this.addValue(subject, predicate, node[key], context, definition)
    }
    return subject
  }

  addValue(subject, predicate, value, context, definition) {
    if (this.builder.truncated) return
    if (value === null || value === undefined) return
    const container = definition ? definition.container : null
    const containers = Array.isArray(container) ? container : (container ? [container] : [])

    // A term-level `@container: "@list"` must become an RDF list, so this has to
    // be decided before arrays are flattened into separate triples.
    if (containers.indexOf('@list') !== -1) {
      const items = Array.isArray(value) ? value : [value]
      const head = this.buildList(items, context, definition)
      this.builder.add(subject, predicate, head, this.kindOf(head))
      return
    }

    if (Array.isArray(value)) {
      if (this.depth >= this.builder.maxDepth) {
        this.noteJsonLdNestingLimit()
        return
      }
      this.depth++
      try {
        for (let i = 0; i < value.length; i++) {
          if (this.builder.truncated) break
          this.addValue(subject, predicate, value[i], context, definition)
        }
      } finally {
        this.depth--
      }
      return
    }

    if (containers.indexOf('@language') !== -1 && value && typeof value === 'object' && !Array.isArray(value) &&
      !ontoRdfHas(value, '@value') && !ontoRdfHas(value, '@id')) {
      const languages = Object.keys(value)
      for (let i = 0; i < languages.length; i++) {
        const language = languages[i] === '@none' ? undefined : languages[i].toLowerCase()
        const entries = Array.isArray(value[languages[i]]) ? value[languages[i]] : [value[languages[i]]]
        for (let e = 0; e < entries.length; e++) {
          const entry = entries[e]
          if (entry === null || entry === undefined || typeof entry === 'object') continue
          this.builder.add(subject, predicate, String(entry), 'literal', undefined, language)
        }
      }
      return
    }

    if (containers.indexOf('@index') !== -1 && value && typeof value === 'object' && !Array.isArray(value) &&
      !ontoRdfHas(value, '@value') && !ontoRdfHas(value, '@id')) {
      const indexes = Object.keys(value)
      for (let i = 0; i < indexes.length; i++) {
        this.addValue(subject, predicate, value[indexes[i]], context, definition)
      }
      return
    }

    if (value && typeof value === 'object') {
      if (ontoRdfHas(value, '@list')) {
        const head = this.buildList(value['@list'], context, definition)
        this.builder.add(subject, predicate, head, this.kindOf(head))
        return
      }
      if (ontoRdfHas(value, '@set')) {
        this.addValue(subject, predicate, value['@set'], context, definition)
        return
      }
      if (ontoRdfHas(value, '@value')) {
        const descriptor = this.literalDescriptor(value, context, definition)
        if (descriptor) {
          this.builder.add(subject, predicate, descriptor.term, 'literal', descriptor.dt, descriptor.lang)
        }
        return
      }
      const child = this.processNode(value, context)
      if (child) this.builder.add(subject, predicate, child, this.kindOf(child))
      return
    }

    if (definition && (definition.type === '@id' || definition.type === '@vocab') && typeof value === 'string') {
      const expanded = this.expandIri(value, context, {
        vocab: definition.type === '@vocab',
        document: definition.type === '@id',
      })
      const iri = this.normalizeIri(expanded || value, context)
      this.builder.add(subject, predicate, iri, this.kindOf(iri))
      return
    }

    if (definition && definition.type && definition.type !== '@id' && definition.type !== '@json' &&
      definition.type !== '@vocab') {
      this.builder.add(subject, predicate, this.primitiveLexical(value), 'literal', definition.type)
      return
    }

    if (typeof value === 'string') {
      this.builder.add(
        subject,
        predicate,
        value,
        'literal',
        undefined,
        this.literalLanguage(definition, context),
      )
      return
    }
    if (typeof value === 'boolean') {
      this.builder.add(subject, predicate, value ? 'true' : 'false', 'literal', ONTO_XSD_BOOLEAN)
      return
    }
    if (typeof value === 'number') {
      this.builder.add(
        subject,
        predicate,
        String(value),
        'literal',
        Number.isInteger(value) ? ONTO_XSD_INTEGER : ONTO_XSD_DOUBLE,
      )
    }
  }

  primitiveLexical(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (value === null || value === undefined) return ''
    return String(value)
  }

  literalDescriptor(valueObject, context, definition) {
    const raw = valueObject['@value']
    if (raw === null || raw === undefined) return null
    let language
    let datatype
    if (ontoRdfHas(valueObject, '@type')) {
      const type = valueObject['@type']
      if (typeof type === 'string') {
        if (type === '@json') {
          return { term: JSON.stringify(raw), dt: ONTO_RDF_JSON, lang: undefined }
        }
        const expanded = this.expandIri(type, context, { vocab: true, document: true })
        datatype = this.normalizeIri(expanded || type, context)
      }
    } else if (ontoRdfHas(valueObject, '@language')) {
      const explicit = valueObject['@language']
      if (typeof explicit === 'string') language = explicit.toLowerCase()
    } else if (typeof raw === 'string') {
      language = this.literalLanguage(definition, context)
    } else if (definition && definition.type && definition.type !== '@id' &&
      definition.type !== '@json' && definition.type !== '@vocab') {
      datatype = definition.type
    }

    let term
    if (typeof raw === 'string') {
      term = raw
    } else if (typeof raw === 'number') {
      term = String(raw)
      if (!datatype) datatype = Number.isInteger(raw) ? ONTO_XSD_INTEGER : ONTO_XSD_DOUBLE
    } else if (typeof raw === 'boolean') {
      term = raw ? 'true' : 'false'
      if (!datatype) datatype = ONTO_XSD_BOOLEAN
    } else {
      term = JSON.stringify(raw)
      if (!datatype) datatype = ONTO_RDF_JSON
    }
    return { term: term, dt: datatype, lang: language }
  }

  buildList(items, context, definition) {
    if (!Array.isArray(items) || items.length === 0) return ONTO_RDF_NIL
    if (this.depth >= this.builder.maxDepth) {
      this.noteJsonLdNestingLimit()
      return ONTO_RDF_NIL
    }
    this.depth++
    try {
      const head = this.builder.freshBlank()
      let current = head
      for (let i = 0; i < items.length; i++) {
        if (this.builder.truncated) break
        const descriptor = this.itemDescriptor(items[i], context, definition)
        if (descriptor) {
          this.builder.add(current, ONTO_RDF_FIRST, descriptor.term, descriptor.kind, descriptor.dt, descriptor.lang)
        }
        if (i < items.length - 1) {
          const next = this.builder.freshBlank()
          this.builder.add(current, ONTO_RDF_REST, next, 'blank')
          current = next
        } else {
          this.builder.add(current, ONTO_RDF_REST, ONTO_RDF_NIL, 'iri')
        }
      }
      return head
    } finally {
      this.depth--
    }
  }

  itemDescriptor(item, context, definition) {
    if (item === null || item === undefined) return null
    if (typeof item === 'object') {
      if (ontoRdfHas(item, '@value')) {
        const descriptor = this.literalDescriptor(item, context, definition)
        return descriptor ? { term: descriptor.term, kind: 'literal', dt: descriptor.dt, lang: descriptor.lang } : null
      }
      if (ontoRdfHas(item, '@list')) {
        const head = this.buildList(item['@list'], context, definition)
        return { term: head, kind: this.kindOf(head) }
      }
      const child = this.processNode(item, context)
      return child ? { term: child, kind: this.kindOf(child) } : null
    }
    if (typeof item === 'string') {
      return { term: item, kind: 'literal', lang: this.literalLanguage(definition, context) }
    }
    if (typeof item === 'boolean') {
      return { term: item ? 'true' : 'false', kind: 'literal', dt: ONTO_XSD_BOOLEAN }
    }
    if (typeof item === 'number') {
      return {
        term: String(item),
        kind: 'literal',
        dt: Number.isInteger(item) ? ONTO_XSD_INTEGER : ONTO_XSD_DOUBLE,
      }
    }
    return null
  }

  kindOf(term) {
    return typeof term === 'string' && term.slice(0, 2) === '_:' ? 'blank' : 'iri'
  }
}

/* ------------------------------------------------------------------ */
/* Public parsers                                                     */
/* ------------------------------------------------------------------ */

/** Parse Turtle (also used for N3 and TriG, whose graph labels are ignored). */
export function parseTurtle(text, options) {
  return new OntoTurtleParser(text, options).parse()
}

/** Parse N-Triples (N-Quads graph terms are ignored). */
export function parseNTriples(text, options) {
  return new OntoNTriplesParser(text, options).parse()
}

/** Parse RDF/XML. */
export function parseRdfXml(text, options) {
  return new OntoRdfXmlParser(text, options).parse()
}

/** Parse a JSON-LD document (practical 1.1 expansion subset). */
export function parseJsonLd(text, options) {
  return new OntoJsonLdParser(text, options).parse()
}

/** Detect the RDF serialization from a file name and/or the document text. */
export function detectFormat(text, fileName) {
  const source = ontoRdfNormalizeText(text)
  const extension = ontoRdfFileExtension(fileName)
  if (extension === 'ttl' || extension === 'turtle' || extension === 'n3' || extension === 'trig') return 'turtle'
  if (extension === 'nt' || extension === 'nq') return 'ntriples'
  if (extension === 'jsonld') return 'jsonld'
  if (extension === 'rdf' || extension === 'owl' || extension === 'xml') return 'rdfxml'

  const start = ontoRdfSkipLeadingSpace(source)
  const first = source.charAt(start)
  if (first === '{' || first === '[') return 'jsonld'
  const head = source.slice(start, start + 4096).toLowerCase()
  if (head.slice(0, 5) === '<?xml' || head.indexOf('<rdf:') >= 0) return 'rdfxml'
  if (/<rdf:RDF/i.test(source)) return 'rdfxml'
  if (source.indexOf('@prefix') >= 0) return 'turtle'
  if (/(^|[\r\n])\s*(?:PREFIX|BASE)\s/i.test(source)) return 'turtle'
  if (extension === 'ttl' || extension === 'turtle') return 'turtle'
  return 'ntriples'
}

function ontoRdfSkipLeadingSpace(source) {
  let index = 0
  if (source.charCodeAt(0) === 0xfeff) index = 1
  while (index < source.length && ontoRdfIsWhitespace(source.charAt(index))) index++
  return index
}

function ontoRdfNormalizeFormat(value) {
  if (typeof value !== 'string') return null
  const format = value.trim().toLowerCase()
  if (format === 'ttl' || format === 'turtle' || format === 'n3' || format === 'trig') return 'turtle'
  if (format === 'nt' || format === 'ntriples' || format === 'n-triples' ||
    format === 'nq' || format === 'nquads' || format === 'n-quads') return 'ntriples'
  if (format === 'rdf' || format === 'rdfxml' || format === 'rdf/xml' ||
    format === 'xml' || format === 'owl') return 'rdfxml'
  if (format === 'jsonld' || format === 'json-ld' || format === 'json') return 'jsonld'
  return null
}

function ontoRdfEmptyDocument(format, text, options) {
  return new OntoRdfBuilder(format, text, options).finish()
}

/**
 * Parse any supported serialization. Never throws.
 * options: {
 *   fileName?: string,          // display name, used for format detection only
 *   resourceAddress?: string,   // real resource address, used for the base IRI
 *   format?: string,
 *   maxTriples?: number,
 *   maxLiteralLength?: number,
 *   maxDepth?: number,
 *   maxDiagnostics?: number
 * }
 */
export function parseOntology(text, options) {
  const opts = options || {}
  if (typeof text !== 'string') {
    const result = ontoRdfEmptyDocument('unknown', '', opts)
    result.errors.push('input is not a string')
    return result
  }
  const parserOptions = {
    fileName: opts.fileName,
    resourceAddress: opts.resourceAddress,
    maxTriples: opts.maxTriples,
    maxLiteralLength: opts.maxLiteralLength,
    maxDepth: opts.maxDepth,
    maxDiagnostics: opts.maxDiagnostics,
  }
  let format
  const declared = typeof opts.format === 'string' && opts.format.trim() !== ''
  if (declared) {
    format = ontoRdfNormalizeFormat(opts.format)
    if (!format) {
      const result = ontoRdfEmptyDocument('unknown', text, parserOptions)
      result.errors.push('unsupported RDF format: ' + opts.format)
      return result
    }
  } else {
    format = detectFormat(text, opts.fileName)
  }
  try {
    if (format === 'turtle') return parseTurtle(text, parserOptions)
    if (format === 'ntriples') return parseNTriples(text, parserOptions)
    if (format === 'rdfxml') return parseRdfXml(text, parserOptions)
    if (format === 'jsonld') return parseJsonLd(text, parserOptions)
  } catch (error) {
    const result = ontoRdfEmptyDocument('unknown', text, parserOptions)
    result.errors.push(
      'parser crashed: ' + (error && error.message ? error.message : String(error)),
    )
    return result
  }
  const result = ontoRdfEmptyDocument('unknown', text, parserOptions)
  result.errors.push('unsupported RDF format: ' + String(format))
  return result
}
