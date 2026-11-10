import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  detectFormat,
  parseOntology,
  parseTurtle,
  parseNTriples,
  parseRdfXml,
  parseJsonLd,
  resolveIri,
  expandPrefixedName,
} from '../src/rdf-parse.js'

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const FOAF = 'http://xmlns.com/foaf/0.1/'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const EX = 'http://example.org/'

function fixture(name) {
  return readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8')
}

function byPredicate(doc, predicate) {
  return doc.triples.filter((triple) => triple.p === predicate)
}

function bySubjectAndPredicate(doc, subject, predicate) {
  return doc.triples.filter((triple) => triple.s === subject && triple.p === predicate)
}

function assertDocumentShape(doc) {
  assert.deepEqual(
    Object.keys(doc).sort(),
    ['base', 'baseSource', 'diagnostics', 'errors', 'format', 'prefixes', 'stats', 'triples', 'warnings'],
  )
  assert.ok(Array.isArray(doc.triples))
  assert.ok(Array.isArray(doc.warnings))
  assert.ok(Array.isArray(doc.errors))
  assert.ok(Array.isArray(doc.diagnostics))
  assert.equal(typeof doc.prefixes, 'object')
  assert.equal(typeof doc.base, 'string')
  assert.equal(typeof doc.baseSource, 'string')
  assert.ok(['document', 'resource', 'none'].includes(doc.baseSource))
  assert.equal(doc.stats.tripleCount, doc.triples.length)
  assert.equal(typeof doc.stats.truncated, 'boolean')
  assert.ok(doc.stats.truncation === null || typeof doc.stats.truncation === 'object')
  for (const diagnostic of doc.diagnostics) {
    assert.equal(typeof diagnostic.code, 'string')
    assert.ok(diagnostic.severity === 'warning' || diagnostic.severity === 'error')
    assert.equal(typeof diagnostic.message, 'string')
    assert.equal(typeof diagnostic.count, 'number')
    assert.ok(diagnostic.count >= 1)
    assert.ok(Array.isArray(diagnostic.sample))
    assert.ok(diagnostic.sample.length <= 3)
  }
}

function diagnosticsWithCode(doc, code) {
  return doc.diagnostics.find((diagnostic) => diagnostic.code === code)
}

const RDF_FIRST = RDF + 'first'
const RDF_REST = RDF + 'rest'
const RDF_NIL = RDF + 'nil'

test('turtle: prefixes, lists, literals, blank nodes and collections', () => {
  const doc = parseTurtle(fixture('sample.ttl'), { fileName: 'sample.ttl' })
  assertDocumentShape(doc)
  assert.equal(doc.format, 'turtle')
  assert.equal(doc.triples.length, 18)
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.base, EX)
  assert.equal(doc.prefixes.ex, EX)
  assert.equal(doc.prefixes.foaf, FOAF)
  assert.equal(doc.prefixes.xsd, XSD)
  assert.deepEqual(doc.stats, {
    tripleCount: 18,
    subjectCount: 5,
    predicateCount: 13,
    objectCount: 18,
    truncated: false,
    truncation: null,
  })

  const type = doc.triples.find((triple) => triple.p === RDF + 'type')
  assert.deepEqual(type, {
    s: EX + 'alice',
    p: RDF + 'type',
    o: FOAF + 'Person',
    oKind: 'iri',
  })

  const names = bySubjectAndPredicate(doc, EX + 'alice', FOAF + 'name')
  assert.equal(names.length, 2)
  const languageName = names.find((triple) => triple.lang === 'en-gb')
  assert.equal(languageName.o, 'Alice Liddell')
  assert.equal(languageName.oKind, 'literal')
  assert.equal(languageName.dt, undefined)

  const age = doc.triples.find((triple) => triple.p === EX + 'age')
  assert.equal(age.o, '30')
  assert.equal(age.dt, XSD + 'integer')

  const ratio = doc.triples.find((triple) => triple.p === EX + 'ratio')
  assert.equal(ratio.dt, XSD + 'double')

  const bobName = doc.triples.find(
    (triple) => triple.p === FOAF + 'name' && triple.s.startsWith('_:') && triple.o === 'Bob',
  )
  assert.ok(bobName, 'blank node property list should produce a blank subject')

  const address = doc.triples.find((triple) => triple.p === EX + 'address')
  assert.equal(address.oKind, 'blank')
  assert.ok(address.s === EX + 'alice')
  assert.ok(
    doc.triples.some(
      (triple) => triple.s === address.o && triple.p === EX + 'city' && triple.o === 'Oxford',
    ),
    'blank node property list should carry its nested properties',
  )

  assert.ok(doc.triples.some((triple) => triple.p === RDF + 'first' && triple.o === 'Al'))
  assert.ok(doc.triples.some((triple) => triple.p === RDF + 'rest' && triple.o === RDF + 'nil'))
})

test('turtle: SPARQL directives, single quotes, long strings and default prefix', () => {
  const doc = parseTurtle(
    "PREFIX ex: <http://e/>\n" +
      "BASE <http://e/>\n" +
      "ex:a ex:p 'one' , \"two\" , '''three\nlines''' , \"\"\"quad\"\"\" ;\n" +
      '  ex:q false ;\n' +
      '  ex:r -1, +2.5, .5, 3e2 .',
  )
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 9)
  assert.ok(doc.triples.some((triple) => triple.o === 'three\nlines'))
  assert.ok(doc.triples.some((triple) => triple.o === 'quad'))
  assert.ok(doc.triples.some((triple) => triple.o === 'false' && triple.dt === XSD + 'boolean'))
  assert.ok(doc.triples.some((triple) => triple.o === '-1' && triple.dt === XSD + 'integer'))
  assert.ok(doc.triples.some((triple) => triple.o === '+2.5' && triple.dt === XSD + 'decimal'))
  assert.ok(doc.triples.some((triple) => triple.o === '.5' && triple.dt === XSD + 'decimal'))
  assert.ok(doc.triples.some((triple) => triple.o === '3e2' && triple.dt === XSD + 'double'))

  const defaultPrefix = parseTurtle('@prefix : <http://e/> .\n:a :p :b .')
  assert.equal(defaultPrefix.triples[0].s, 'http://e/a')
  assert.equal(defaultPrefix.triples[0].o, 'http://e/b')

  const prefixed = parseTurtle('ex:a ex:p ex:b .', { prefixes: { ex: EX } })
  assert.equal(prefixed.triples.length, 1)
  assert.equal(prefixed.prefixes.ex, EX)
})

test('ntriples: exact count, unicode escape, blank node and datatype', () => {
  const doc = parseNTriples(fixture('sample.nt'))
  assertDocumentShape(doc)
  assert.equal(doc.format, 'ntriples')
  assert.equal(doc.triples.length, 5)
  assert.deepEqual(doc.errors, [])

  const nick = byPredicate(doc, FOAF + 'nick')[0]
  assert.equal(nick.o, 'café')
  assert.equal(nick.lang, 'fr')
  assert.equal(nick.oKind, 'literal')

  const blank = doc.triples.find((triple) => triple.s === '_:b0')
  assert.equal(blank.p, FOAF + 'knows')
  assert.equal(blank.o, EX + 'bob')
  assert.equal(blank.oKind, 'iri')

  const age = byPredicate(doc, FOAF + 'age')[0]
  assert.equal(age.o, '42')
  assert.equal(age.dt, XSD + 'integer')

  const note = byPredicate(doc, EX + 'note')[0]
  assert.equal(note.o, 'line1\nline2\ttabbed')
})

test('ntriples: N-Quads graph term is ignored', () => {
  const doc = parseNTriples('<http://e/s> <http://e/p> <http://e/o> <http://e/g> .\n')
  assert.equal(doc.triples.length, 1)
  assert.deepEqual(doc.triples[0], {
    s: 'http://e/s',
    p: 'http://e/p',
    o: 'http://e/o',
    oKind: 'iri',
  })
  const diagnostic = diagnosticsWithCode(doc, 'named-graph-ignored')
  assert.ok(diagnostic, 'N-Quads graph terms must be reported')
  assert.equal(diagnostic.count, 1)
  assert.equal(diagnostic.sample.length, 1)
  assert.match(diagnostic.sample[0], /http:\/\/e\/g/)

  const plain = parseNTriples('<http://e/s> <http://e/p> <http://e/o> .\n')
  assert.equal(diagnosticsWithCode(plain, 'named-graph-ignored'), undefined)
})

test('rdfxml: typed node, nested property, resource, collection and xml:lang', () => {
  const doc = parseRdfXml(fixture('sample.rdf'))
  assertDocumentShape(doc)
  assert.equal(doc.format, 'rdfxml')
  assert.equal(doc.triples.length, 13)
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.base, EX)
  assert.equal(doc.prefixes.foaf, FOAF)
  assert.equal(doc.prefixes.ex, EX)

  const type = doc.triples.find((triple) => triple.p === RDF + 'type')
  assert.deepEqual(type, {
    s: EX + 'alice',
    p: RDF + 'type',
    o: FOAF + 'Person',
    oKind: 'iri',
  })

  const name = byPredicate(doc, FOAF + 'name')[0]
  assert.equal(name.o, 'Alice')
  assert.equal(name.lang, 'en')

  const age = byPredicate(doc, EX + 'age')[0]
  assert.equal(age.o, '30')
  assert.equal(age.dt, XSD + 'integer')

  const knows = byPredicate(doc, EX + 'knows')[0]
  assert.equal(knows.o, EX + 'bob')
  assert.equal(knows.oKind, 'iri')

  const address = byPredicate(doc, EX + 'address')[0]
  assert.equal(address.oKind, 'blank')
  assert.ok(
    doc.triples.some(
      (triple) => triple.s === address.o && triple.p === EX + 'city' && triple.o === 'Oxford',
    ),
  )

  const first = doc.triples.find((triple) => triple.p === RDF + 'first')
  assert.ok(first, 'parseType="Collection" should emit rdf:first')
  assert.ok(doc.triples.some((triple) => triple.p === RDF + 'rest' && triple.o === RDF + 'nil'))

  const labels = byPredicate(doc, EX + 'label')
  assert.equal(labels.length, 2)
})

test('jsonld: context prefixes, @graph, nested node, @value language and @type', () => {
  const doc = parseJsonLd(fixture('sample.jsonld'))
  assertDocumentShape(doc)
  assert.equal(doc.format, 'jsonld')
  assert.equal(doc.triples.length, 10)
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.base, EX)
  assert.equal(doc.prefixes.foaf, FOAF)

  const type = doc.triples.find((triple) => triple.p === RDF + 'type')
  assert.deepEqual(type, {
    s: EX + 'alice',
    p: RDF + 'type',
    o: FOAF + 'Person',
    oKind: 'iri',
  })

  const name = bySubjectAndPredicate(doc, EX + 'alice', FOAF + 'name')[0]
  assert.equal(name.o, 'Alice')
  assert.equal(name.lang, 'en')

  const age = bySubjectAndPredicate(doc, EX + 'alice', FOAF + 'age')[0]
  assert.equal(age.o, '30')
  assert.equal(age.dt, XSD + 'integer')

  const knows = bySubjectAndPredicate(doc, EX + 'alice', FOAF + 'knows')[0]
  assert.equal(knows.o, EX + 'bob')
  assert.equal(knows.oKind, 'iri')

  const bio = bySubjectAndPredicate(doc, EX + 'alice', EX + 'vocab#bio')[0]
  assert.equal(bio.o, 'Bonjour')
  assert.equal(bio.lang, 'fr')

  const address = bySubjectAndPredicate(doc, EX + 'alice', EX + 'vocab#address')[0]
  assert.equal(address.oKind, 'blank')
  assert.ok(
    doc.triples.some(
      (triple) =>
        triple.s === address.o && triple.p === EX + 'vocab#city' && triple.o === 'Oxford',
    ),
  )

  const bobName = bySubjectAndPredicate(doc, EX + 'bob', FOAF + 'name')[0]
  assert.equal(bobName.o, 'Bob')
})

test('detectFormat: explicit extensions win over content', () => {
  assert.equal(detectFormat('', 'sample.ttl'), 'turtle')
  assert.equal(detectFormat('', 'sample.turtle'), 'turtle')
  assert.equal(detectFormat('', 'sample.n3'), 'turtle')
  assert.equal(detectFormat('', 'sample.trig'), 'turtle')
  assert.equal(detectFormat('', 'sample.nt'), 'ntriples')
  assert.equal(detectFormat('', 'sample.nq'), 'ntriples')
  assert.equal(detectFormat('', 'sample.jsonld'), 'jsonld')
  assert.equal(detectFormat('', 'sample.rdf'), 'rdfxml')
  assert.equal(detectFormat('', 'sample.owl'), 'rdfxml')
  assert.equal(detectFormat('', 'sample.xml'), 'rdfxml')
  assert.equal(detectFormat('', 'SAMPLE.TTL'), 'turtle')
  assert.equal(detectFormat('<http://e/s> <http://e/p> <http://e/o> .', 'x.owl'), 'rdfxml')
  assert.equal(detectFormat('@prefix ex: <http://e/> .', 'x.nt'), 'ntriples')
})

test('detectFormat: content sniffing', () => {
  assert.equal(detectFormat('{ "@context": {} }'), 'jsonld')
  assert.equal(detectFormat('  [ { "@id": "http://e/s" } ]'), 'jsonld')
  assert.equal(detectFormat('<?xml version="1.0"?><rdf:RDF/>'), 'rdfxml')
  assert.equal(detectFormat('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>'), 'rdfxml')
  assert.equal(detectFormat('@prefix ex: <http://e/> .'), 'turtle')
  assert.equal(detectFormat('PREFIX ex: <http://e/>'), 'turtle')
  assert.equal(detectFormat('<http://e/s> <http://e/p> <http://e/o> .'), 'ntriples')
  assert.equal(detectFormat(''), 'ntriples')
})

test('turtle: explicit datatypes, unicode escapes and escaped local names', () => {
  const doc = parseTurtle(
    '@prefix ex: <http://example.org/> .\n' +
      '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n' +
      'ex:caf\\u00E9 ex:p "7"^^xsd:integer ;\n' +
      '  ex:q <http://example.org/a\\u00E9> ;\n' +
      '  ex:r ex:c\\.d .\n',
  )
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 3)
  const typed = doc.triples.find((triple) => triple.p === EX + 'p')
  assert.equal(typed.s, EX + 'café')
  assert.equal(typed.o, '7')
  assert.equal(typed.dt, XSD + 'integer')
  assert.equal(doc.triples.find((triple) => triple.p === EX + 'q').o, EX + 'aé')
  assert.equal(doc.triples.find((triple) => triple.p === EX + 'r').o, EX + 'c.d')
})

test('rdfxml: CDATA, parseType Literal, nodeID and rdf:li', () => {
  const doc = parseRdfXml(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
      'xmlns:ex="http://example.org/">' +
      '<rdf:Description rdf:about="http://example.org/s">' +
      '<ex:raw rdf:parseType="Literal"><b>hi</b></ex:raw>' +
      '<ex:cdata><![CDATA[a & b]]></ex:cdata>' +
      '<ex:other rdf:nodeID="n1"/>' +
      '<rdf:li>one</rdf:li><rdf:li>two</rdf:li>' +
      '</rdf:Description></rdf:RDF>',
  )
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 5)
  const raw = doc.triples.find((triple) => triple.p === EX + 'raw')
  assert.equal(raw.o, '<b>hi</b>')
  assert.equal(raw.dt, RDF + 'XMLLiteral')
  assert.equal(doc.triples.find((triple) => triple.p === EX + 'cdata').o, 'a & b')
  assert.equal(doc.triples.find((triple) => triple.p === EX + 'other').o, '_:n1')
  assert.equal(doc.triples.find((triple) => triple.p === RDF + '_1').o, 'one')
  assert.equal(doc.triples.find((triple) => triple.p === RDF + '_2').o, 'two')
})

test('jsonld: @list expansion and skipped remote context warning', () => {
  const list = parseJsonLd(
    '{"@context":{"@base":"http://e/","ex":"http://e/"},"@id":"s","ex:p":{"@list":["a","b"]}}',
  )
  assert.deepEqual(list.errors, [])
  assert.equal(list.triples.length, 5)
  assert.ok(list.triples.some((triple) => triple.p === RDF + 'first' && triple.o === 'a'))
  assert.ok(list.triples.some((triple) => triple.p === RDF + 'rest' && triple.o === RDF + 'nil'))

  const remote = parseJsonLd('{"@context":"http://remote.example/ctx","@id":"http://e/s"}')
  assert.equal(remote.triples.length, 0)
  assert.ok(remote.warnings.some((warning) => /remote @context/.test(warning)))
})

test('malformed input never throws and preserves partial triples', () => {
  let doc
  assert.doesNotThrow(() => {
    doc = parseTurtle(
      '@prefix ex: <http://example.org/> .\nex:a ex:b ex:c .\nex:d ex:e "oops',
    )
  })
  assert.equal(doc.triples.length, 1)
  assert.ok(doc.errors.length > 0)
  assert.match(doc.errors[0], /line/)

  assert.doesNotThrow(() => {
    doc = parseRdfXml(
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
        'xmlns:ex="http://example.org/"><rdf:Description rdf:about="http://example.org/x">' +
        '<ex:p>unclosed',
    )
  })
  assert.ok(doc.errors.length > 0)
  assert.ok(doc.triples.length >= 1, 'partial triples from the open elements are kept')

  assert.doesNotThrow(() => {
    doc = parseJsonLd('{invalid')
  })
  assert.equal(doc.triples.length, 0)
  assert.ok(doc.errors.length > 0)
  assert.match(doc.errors[0], /JSON/i)

  assert.doesNotThrow(() => {
    doc = parseOntology('{invalid', { format: 'jsonld' })
  })
  assert.ok(doc.errors.length > 0)

  assert.doesNotThrow(() => parseOntology(null))
  const nullDoc = parseOntology(null)
  assert.equal(nullDoc.format, 'unknown')
  assert.ok(nullDoc.errors.length > 0)
})

test('resolveIri resolves relative, fragment and absolute references', () => {
  assert.equal(resolveIri('http://example.org/a/b', 'c'), 'http://example.org/a/c')
  assert.equal(resolveIri('http://example.org/a/b', '../c'), 'http://example.org/c')
  assert.equal(resolveIri('http://example.org/a/b', '#frag'), 'http://example.org/a/b#frag')
  assert.equal(resolveIri('http://example.org/a/b#old', '#frag'), 'http://example.org/a/b#frag')
  assert.equal(resolveIri('http://example.org/a/b', 'http://other.org/x'), 'http://other.org/x')
  assert.equal(resolveIri('http://example.org/a/b?q=1#f', '?x=2'), 'http://example.org/a/b?x=2')
  assert.equal(resolveIri('http://example.org', ''), 'http://example.org')
  assert.equal(resolveIri('', 'relative'), 'relative')
})

test('expandPrefixedName uses the prefix map only', () => {
  assert.equal(expandPrefixedName('foaf:Person', { foaf: FOAF }), FOAF + 'Person')
  assert.equal(expandPrefixedName(':Person', { '': FOAF }), FOAF + 'Person')
  assert.equal(expandPrefixedName('unknown:Person', { foaf: FOAF }), null)
  assert.equal(expandPrefixedName('Person', { foaf: FOAF }), null)
  assert.equal(expandPrefixedName('foaf:Person', null), null)
  assert.equal(expandPrefixedName(42, { foaf: FOAF }), null)
})

test('maxTriples stops parsing and warns', () => {
  const doc = parseTurtle(fixture('sample.ttl'), { maxTriples: 3 })
  assert.equal(doc.triples.length, 3)
  assert.ok(doc.warnings.some((warning) => /limit/.test(warning)))
})

test('BOM and CRLF input parse identically', () => {
  const source = '\uFEFF' + fixture('sample.ttl').replace(/\n/g, '\r\n')
  const doc = parseOntology(source, { fileName: 'sample.ttl' })
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 18)
})

test('parseOntology detects formats and returns the frozen shape', () => {
  const documents = [
    parseOntology(fixture('sample.ttl'), { fileName: 'sample.ttl' }),
    parseOntology(fixture('sample.nt'), { fileName: 'sample.nt' }),
    parseOntology(fixture('sample.rdf'), { fileName: 'sample.rdf' }),
    parseOntology(fixture('sample.jsonld'), { fileName: 'sample.jsonld' }),
    parseOntology('', { format: 'nope' }),
  ]
  const formats = ['turtle', 'ntriples', 'rdfxml', 'jsonld', 'unknown']
  for (let i = 0; i < documents.length; i++) {
    assertDocumentShape(documents[i])
    assert.equal(documents[i].format, formats[i])
  }
  assert.equal(parseOntology(fixture('sample.jsonld')).format, 'jsonld')
  assert.equal(parseOntology(fixture('sample.ttl'), { format: 'ttl' }).format, 'turtle')
})

test('parsing the same text twice yields identical JSON', () => {
  const cases = [
    ['sample.ttl', { fileName: 'sample.ttl' }],
    ['sample.nt', { fileName: 'sample.nt' }],
    ['sample.rdf', { fileName: 'sample.rdf' }],
    ['sample.jsonld', { fileName: 'sample.jsonld' }],
  ]
  for (const [name, options] of cases) {
    const first = parseOntology(fixture(name), options)
    const second = parseOntology(fixture(name), options)
    assert.deepEqual(first, second)
    assert.equal(JSON.stringify(first), JSON.stringify(second))
  }
})

/* ------------------------------------------------------------------ */
/* Base IRI provenance                                                */
/* ------------------------------------------------------------------ */

function parseRelative(resourceAddress, extra) {
  return parseOntology('@prefix ex: <http://e/> .\n<rel> ex:p ex:o .', {
    format: 'turtle',
    resourceAddress,
    ...(extra || {}),
  })
}

test('base IRI: resource addresses map deterministically', () => {
  const https = parseRelative('https://example.org/dir/file.ttl#section')
  assert.equal(https.base, 'https://example.org/dir/file.ttl')
  assert.equal(https.baseSource, 'resource')
  assert.equal(https.triples[0].s, 'https://example.org/dir/rel')
  assert.equal(diagnosticsWithCode(https, 'base-unavailable'), undefined)

  const fileUri = parseRelative('file:///repo/onto.ttl#frag')
  assert.equal(fileUri.base, 'file:///repo/onto.ttl')
  assert.equal(fileUri.baseSource, 'resource')

  // Same display name in different directories must not share an identity.
  const first = parseRelative('/repo/one/onto.ttl')
  const second = parseRelative('/repo/two/onto.ttl')
  assert.equal(first.base, 'file:///repo/one/onto.ttl')
  assert.equal(second.base, 'file:///repo/two/onto.ttl')
  assert.equal(first.triples[0].s, 'file:///repo/one/rel')
  assert.equal(second.triples[0].s, 'file:///repo/two/rel')
  assert.notEqual(first.triples[0].s, second.triples[0].s)
  // The same file seen as a file: URI or as a native absolute path must agree.
  assert.equal(parseRelative('file:///repo/one/onto.ttl').base, first.base)

  // Windows drive and UNC paths normalize to file URLs.
  assert.equal(parseRelative('C:\\repo\\onto.ttl').base, 'file:///C:/repo/onto.ttl')
  assert.equal(parseRelative('\\\\server\\share\\onto.ttl').base, 'file:////server/share/onto.ttl')

  // Custom schemes are used verbatim only when they are absolute hierarchical URIs.
  assert.equal(parseRelative('dsh-app://panel/dir/onto.ttl#frag').base, 'dsh-app://panel/dir/onto.ttl')
  assert.equal(parseRelative('custom:/absolute/dir/onto.ttl').base, 'custom:/absolute/dir/onto.ttl')

  // Unusable addresses are never guessed; relative IRIs stay verbatim.
  for (const address of ['weird:relative', 'relative/path/onto.ttl', '']) {
    const result = parseRelative(address)
    assert.equal(result.base, '', 'base for ' + JSON.stringify(address))
    assert.equal(result.baseSource, 'none', 'baseSource for ' + JSON.stringify(address))
    assert.equal(result.triples[0].s, 'rel')
    const diagnostic = diagnosticsWithCode(result, 'base-unavailable')
    assert.ok(diagnostic, 'base-unavailable for ' + JSON.stringify(address))
    assert.equal(diagnostic.severity, 'warning')
    assert.equal(diagnostic.count, 1)
  }
})

test('base IRI: display names never fabricate identities', () => {
  for (const fileName of ['onto.ttl', 'nested/onto.ttl', 'sample.ttl']) {
    const doc = parseOntology('@prefix ex: <http://e/> .\n<rel> ex:p ex:o .', { fileName })
    assert.equal(doc.base, '', fileName)
    assert.equal(doc.baseSource, 'none', fileName)
    assert.equal(doc.triples[0].s, 'rel', fileName)
    assert.ok(diagnosticsWithCode(doc, 'base-unavailable'), fileName)
    assert.ok(!JSON.stringify(doc.triples).includes('file:///'), fileName)
  }

  // Legacy compatibility: an address-like `fileName` with no resourceAddress
  // still contributes a base for library callers.
  const legacy = parseTurtle('@prefix ex: <http://e/> .\n<rel> ex:p ex:o .', {
    fileName: 'C:\\data\\onto.ttl',
  })
  assert.equal(legacy.base, 'file:///C:/data/onto.ttl')
  assert.equal(legacy.baseSource, 'resource')
})

test('base IRI: document declarations override the resource address', () => {
  const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const turtle = parseOntology(
    '@base <http://doc.example/base/> .\n<rel> <http://e/p> <http://e/o> .',
    { format: 'turtle', resourceAddress: 'https://resource.example/file.ttl' },
  )
  assert.equal(turtle.base, 'http://doc.example/base/')
  assert.equal(turtle.baseSource, 'document')
  assert.equal(turtle.triples[0].s, 'http://doc.example/base/rel')

  const rdfxml = parseOntology(
    '<rdf:RDF xmlns:rdf="' + RDF_NS + '" xmlns:ex="http://e/" xml:base="http://doc.example/x/">' +
      '<rdf:Description rdf:about="alice"><ex:p>v</ex:p></rdf:Description></rdf:RDF>',
    { format: 'rdfxml', resourceAddress: 'https://resource.example/file.rdf' },
  )
  assert.equal(rdfxml.base, 'http://doc.example/x/')
  assert.equal(rdfxml.baseSource, 'document')
  assert.equal(rdfxml.triples[0].s, 'http://doc.example/x/alice')

  const jsonld = parseOntology(
    '{"@context":{"@base":"http://doc.example/j/"},"@id":"alice","@type":"http://e/T"}',
    { format: 'jsonld', resourceAddress: 'https://resource.example/file.jsonld' },
  )
  assert.equal(jsonld.base, 'http://doc.example/j/')
  assert.equal(jsonld.baseSource, 'document')
  assert.equal(jsonld.triples[0].s, 'http://doc.example/j/alice')
})

/* ------------------------------------------------------------------ */
/* Structured truncation                                              */
/* ------------------------------------------------------------------ */

function assertTripleTruncation(doc, limit) {
  assert.equal(doc.stats.truncated, true)
  assert.equal(doc.triples.length, limit)
  assert.deepEqual(doc.stats.truncation, { reason: 'triple-limit', limit, kept: limit })
  const diagnostic = diagnosticsWithCode(doc, 'triple-limit')
  assert.ok(diagnostic, 'missing triple-limit diagnostic')
  assert.equal(diagnostic.severity, 'warning')
  assert.equal(diagnostic.count, 1)
}

test('structured truncation: every format stops at maxTriples', () => {
  const turtle = parseOntology(fixture('sample.ttl'), { fileName: 'sample.ttl', maxTriples: 3 })
  assertTripleTruncation(turtle, 3)

  const ntriples = parseOntology(fixture('sample.nt'), { fileName: 'sample.nt', maxTriples: 2 })
  assertTripleTruncation(ntriples, 2)

  const rdfxml = parseOntology(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://e/">' +
      '<rdf:Description rdf:about="http://e/a"><ex:p>1</ex:p></rdf:Description>' +
      '<rdf:Description rdf:about="http://e/b"><ex:p>2</ex:p></rdf:Description>' +
      '<rdf:Description rdf:about="http://e/c"><ex:p>3</ex:p></rdf:Description></rdf:RDF>',
    { format: 'rdfxml', maxTriples: 2 },
  )
  assertTripleTruncation(rdfxml, 2)

  const jsonld = parseOntology(
    '{"@context":{"@vocab":"http://e/"},"@graph":[' +
      '{"@id":"http://e/a","p":"1"},{"@id":"http://e/b","p":"2"},{"@id":"http://e/c","p":"3"}]}',
    { format: 'jsonld', maxTriples: 2 },
  )
  assertTripleTruncation(jsonld, 2)

  const full = parseOntology(fixture('sample.ttl'), { fileName: 'sample.ttl' })
  assert.equal(full.stats.truncated, false)
  assert.equal(full.stats.truncation, null)
  assert.equal(diagnosticsWithCode(full, 'triple-limit'), undefined)
})

/* ------------------------------------------------------------------ */
/* Named graphs                                                       */
/* ------------------------------------------------------------------ */

test('named graph diagnostics: TriG labels are ignored, triples kept', () => {
  const trig = parseTurtle(
    '@prefix ex: <http://e/> .\nex:g1 { ex:a ex:p ex:b . }\nex:g2 { ex:c ex:p ex:d . }',
  )
  assert.equal(trig.triples.length, 2)
  const diagnostic = diagnosticsWithCode(trig, 'named-graph-ignored')
  assert.ok(diagnostic, 'TriG labels must be reported')
  assert.equal(diagnostic.severity, 'warning')
  assert.equal(diagnostic.count, 2)
  assert.equal(diagnostic.sample.length, 2)
  assert.deepEqual(trig.triples.map((triple) => triple.s), ['http://e/a', 'http://e/c'])

  const keyword = parseTurtle('@prefix ex: <http://e/> .\nGRAPH ex:g { ex:a ex:p ex:b . }')
  assert.equal(keyword.triples.length, 1)
  assert.ok(diagnosticsWithCode(keyword, 'named-graph-ignored'))

  const plain = parseTurtle('@prefix ex: <http://e/> .\nex:a ex:p ex:b .')
  assert.equal(diagnosticsWithCode(plain, 'named-graph-ignored'), undefined)
})

/* ------------------------------------------------------------------ */
/* JSON-LD semantic fixes                                             */
/* ------------------------------------------------------------------ */

test('jsonld: top-level @graph keeps sibling keys', () => {
  const text = readFileSync(new URL('../examples/courses.jsonld', import.meta.url), 'utf8')
  const doc = parseOntology(text, { fileName: 'courses.jsonld' })
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 36)
  assert.equal(doc.stats.truncated, false)
  const catalog = 'http://example.org/course#course-graph'
  assert.ok(
    doc.triples.some((triple) => triple.s === catalog && triple.p === RDF + 'type' &&
      triple.o === 'http://example.org/course#Catalog'),
    'sibling @type must produce a triple',
  )
  assert.ok(
    doc.triples.some((triple) => triple.s === catalog && triple.p === 'http://schema.org/name' &&
      triple.o === '课程目录' && triple.oKind === 'literal'),
    'sibling property must produce a triple',
  )
})

test('jsonld: term-level @container "@list" expands to an RDF list', () => {
  const doc = parseJsonLd(
    '{"@context":{"@base":"http://e/","ex":"http://e/",' +
      '"items":{"@id":"ex:items","@container":"@list"}},' +
      '"@id":"s","items":["a","b"]}',
  )
  assert.deepEqual(doc.errors, [])
  assert.equal(doc.triples.length, 5)
  assert.deepEqual(
    doc.triples.filter((triple) => triple.p === RDF_FIRST).map((triple) => triple.o),
    ['a', 'b'],
  )
  assert.ok(doc.triples.some((triple) => triple.p === RDF_REST && triple.o === RDF_NIL))
  const listHead = doc.triples.find(
    (triple) => triple.s === 'http://e/s' && triple.p === 'http://e/items',
  )
  assert.ok(listHead && String(listHead.o).startsWith('_:'))

  // An array container (not a list) still produces separate triples.
  const set = parseJsonLd(
    '{"@context":{"@base":"http://e/","ex":"http://e/",' +
      '"items":{"@id":"ex:items","@container":"@set"}},' +
      '"@id":"s","items":["a","b"]}',
  )
  assert.equal(set.triples.length, 2)
  assert.equal(diagnosticsWithCode(set, 'jsonld-container-unsupported'), undefined)
})

/* ------------------------------------------------------------------ */
/* Limits and diagnostic caps                                         */
/* ------------------------------------------------------------------ */

test('literal limit truncates values and marks the triple', () => {
  const longValue = 'x'.repeat(40)
  const doc = parseTurtle(
    '@prefix ex: <http://example.org/> .\nex:a ex:short "ok" ; ex:long "' + longValue + '" .',
    { maxLiteralLength: 10 },
  )
  const long = doc.triples.find((triple) => triple.p === EX + 'long')
  assert.equal(long.o, 'x'.repeat(10))
  assert.equal(long.literalTruncated, true)
  const short = doc.triples.find((triple) => triple.p === EX + 'short')
  assert.equal(short.o, 'ok')
  assert.equal(short.literalTruncated, undefined)
  const diagnostic = diagnosticsWithCode(doc, 'literal-limit')
  assert.ok(diagnostic)
  assert.equal(diagnostic.severity, 'warning')
  assert.equal(diagnostic.count, 1)

  const defaultLimit = parseTurtle('@prefix ex: <http://e/> .\nex:a ex:p "' + 'y'.repeat(20000) + '" .')
  assert.equal(defaultLimit.triples[0].o.length, 16384)
  assert.equal(defaultLimit.triples[0].literalTruncated, true)
})

test('diagnostics aggregate by code and respect the caps', () => {
  let rows = ''
  for (let i = 0; i < 20; i++) rows += 'bad line ' + i + '\n'
  const capped = parseNTriples(rows, { maxDiagnostics: 5 })
  assert.equal(capped.warnings.length + capped.errors.length, 5)
  const truncated = diagnosticsWithCode(capped, 'diagnostics-truncated')
  assert.ok(truncated, 'overflow must be reported once')
  assert.equal(truncated.severity, 'warning')
  assert.equal(truncated.count, 15)
  assert.ok(truncated.sample.length <= 3)

  let literals = ''
  for (let i = 0; i < 5; i++) literals += 'ex:s' + i + ' ex:p "abcdefgh" .\n'
  const long = parseTurtle('@prefix ex: <http://e/> .\n' + literals, { maxLiteralLength: 3 })
  const diagnostic = diagnosticsWithCode(long, 'literal-limit')
  assert.equal(diagnostic.count, 5)
  assert.equal(diagnostic.sample.length, 3)
})

test('jsonld: semantic-loss diagnostics are classified', () => {
  const doc = parseJsonLd(
    JSON.stringify({
      '@context': {
        '@vocab': 'http://e/',
        rev: { '@reverse': 'http://e/rev' },
        bad: { '@id': 'http://e/bad', '@container': '@graph' },
      },
      '@id': 'http://e/s',
      '@reverse': { 'http://e/x': 'http://e/y' },
      '@included': [{ '@id': 'http://e/inc' }],
      '@nest': { p: 'v' },
      rev: { '@id': 'http://e/z' },
      bad: ['one'],
    }),
  )
  assert.ok(diagnosticsWithCode(doc, 'jsonld-reverse-term-forward'))
  assert.ok(diagnosticsWithCode(doc, 'jsonld-node-reverse-ignored'))
  assert.equal(diagnosticsWithCode(doc, 'jsonld-included-nest-ignored').count, 2)
  assert.ok(diagnosticsWithCode(doc, 'jsonld-container-unsupported'))

  const remote = parseJsonLd('{"@context":"http://remote.example/ctx","@id":"http://e/s"}')
  const remoteDiagnostic = diagnosticsWithCode(remote, 'jsonld-remote-context-skipped')
  assert.ok(remoteDiagnostic)
  assert.equal(remoteDiagnostic.count, 1)

  const dropped = parseJsonLd('{"@context":{"@vocab":"http://e/"},"@graph":[{"@value":"x"}]}')
  assert.equal(dropped.triples.length, 0)
  assert.ok(diagnosticsWithCode(dropped, 'jsonld-value-object-dropped'))
})

test('rdfxml: reification, parseType and multiple-object diagnostics', () => {
  const doc = parseRdfXml(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
      'xmlns:ex="http://e/" xml:base="http://e/">' +
      '<rdf:Description rdf:about="a">' +
      '<ex:reified rdf:ID="r1">v</ex:reified>' +
      '<ex:unsupported rdf:parseType="Other">v</ex:unsupported>' +
      '<ex:multi><rdf:Description rdf:about="b"/><rdf:Description rdf:about="c"/></ex:multi>' +
      '<ex:multi><rdf:Description rdf:about="d"/><rdf:Description rdf:about="e"/></ex:multi>' +
      '</rdf:Description></rdf:RDF>',
  )
  const reification = diagnosticsWithCode(doc, 'rdfxml-reification-ignored')
  assert.ok(reification)
  assert.equal(reification.count, 1, 'reification is reported once per document')
  assert.ok(diagnosticsWithCode(doc, 'rdfxml-parsetype-unsupported'))
  const multiple = diagnosticsWithCode(doc, 'rdfxml-multiple-objects')
  assert.ok(multiple)
  assert.equal(multiple.count, 1, 'multiple objects are deduped per parent')
})

test('nesting limits stop branches and keep partial results', () => {
  const DEPTH = 600

  let turtle = '@prefix ex: <http://e/> .\nex:root ex:p '
  for (let i = 0; i < DEPTH; i++) turtle += '[ ex:p '
  turtle += 'ex:leaf'
  for (let i = 0; i < DEPTH; i++) turtle += ' ]'
  turtle += ' .'
  let turtleDoc
  assert.doesNotThrow(() => {
    turtleDoc = parseTurtle(turtle)
  })
  assert.ok(turtleDoc.triples.length > 0, 'partial triples are kept')
  const turtleLimit = diagnosticsWithCode(turtleDoc, 'nesting-limit')
  assert.ok(turtleLimit)
  assert.equal(turtleLimit.severity, 'error')
  assert.ok(turtleLimit.count >= 1)

  let jsonld = ''
  for (let i = 0; i < DEPTH; i++) jsonld += '{"@context":{"ex":"http://e/"},"ex:p":'
  jsonld += '{"@id":"http://e/leaf"}'
  for (let i = 0; i < DEPTH; i++) jsonld += '}'
  let jsonldDoc
  assert.doesNotThrow(() => {
    jsonldDoc = parseJsonLd(jsonld)
  })
  assert.ok(jsonldDoc.triples.length > 0)
  const jsonldLimit = diagnosticsWithCode(jsonldDoc, 'nesting-limit')
  assert.ok(jsonldLimit)
  assert.equal(jsonldLimit.severity, 'error')

  let rdfxml = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
    'xmlns:ex="http://e/"><rdf:Description rdf:about="http://e/a">'
  for (let i = 0; i < DEPTH; i++) rdfxml += '<ex:p>'
  rdfxml += '<rdf:Description rdf:about="http://e/b"><ex:q>v</ex:q></rdf:Description>'
  for (let i = 0; i < DEPTH; i++) rdfxml += '</ex:p>'
  rdfxml += '</rdf:Description></rdf:RDF>'
  let rdfxmlDoc
  assert.doesNotThrow(() => {
    rdfxmlDoc = parseRdfXml(rdfxml)
  })
  assert.ok(rdfxmlDoc.triples.length > 0)
  const rdfxmlLimit = diagnosticsWithCode(rdfxmlDoc, 'nesting-limit')
  assert.ok(rdfxmlLimit)
  assert.equal(rdfxmlLimit.severity, 'error')
})

test('parsing with diagnostics and truncation is deterministic', () => {
  const text =
    '@prefix ex: <http://e/> .\n' +
    'ex:g { ex:a ex:p "abcdefgh" . }\n' +
    'ex:b ex:p "abcdefgh", "abcdefgh" .\n' +
    'ex:c ex:p ex:d .\n'
  const options = { format: 'turtle', maxTriples: 3, maxLiteralLength: 4 }
  const first = parseOntology(text, options)
  const second = parseOntology(text, options)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.ok(first.diagnostics.length > 0)
})
