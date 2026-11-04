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
    ['base', 'errors', 'format', 'prefixes', 'stats', 'triples', 'warnings'],
  )
  assert.ok(Array.isArray(doc.triples))
  assert.ok(Array.isArray(doc.warnings))
  assert.ok(Array.isArray(doc.errors))
  assert.equal(typeof doc.prefixes, 'object')
  assert.equal(typeof doc.base, 'string')
  assert.equal(doc.stats.tripleCount, doc.triples.length)
}

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
