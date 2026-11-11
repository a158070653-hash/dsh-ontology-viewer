import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOntology } from '../src/rdf-parse.js'
import { buildGraph } from '../src/graph-model.js'
import {
  buildHierarchy,
  expandHierarchy,
  layoutLayeredGraph,
  computeStronglyConnectedComponents,
  VIEW_BUDGETS,
} from '../src/ontology-views.js'

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL = 'http://www.w3.org/2002/07/owl#'
const EX = 'http://e/'

const PREFIXES = '@prefix ex: <http://e/> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n' +
  '@prefix owl: <http://www.w3.org/2002/07/owl#> .\n'

function graphOf(body) {
  const parsed = parseOntology(PREFIXES + body, { format: 'turtle' })
  return buildGraph(parsed, { sourceId: 'src1' })
}

const CLASS_FIXTURE = graphOf(
  'ex:A a owl:Class .\n' +
  'ex:B a owl:Class ; rdfs:subClassOf ex:A .\n' +
  'ex:C a owl:Class ; rdfs:subClassOf ex:A, ex:B .\n' +
  'ex:D a owl:Class .\n' +
  'ex:Employee a owl:Class ; rdfs:subClassOf ex:Person .\n' +
  'ex:Person a owl:Class .\n',
)

/* ------------------------------------------------------------------ */
/* Class hierarchy                                                    */
/* ------------------------------------------------------------------ */

test('hierarchy: explicit subClassOf builds parents, children, roots and orphans', () => {
  const hierarchy = buildHierarchy(CLASS_FIXTURE, { mode: 'class' })
  assert.equal(hierarchy.predicate, RDFS + 'subClassOf')
  assert.equal(hierarchy.stats.entities, 6)
  assert.equal(hierarchy.stats.relations, 4)

  const c = hierarchy.entities.get(EX + 'C')
  assert.deepEqual(c.parents.map((item) => item.parentId).sort(), [EX + 'A', EX + 'B'])
  const a = hierarchy.entities.get(EX + 'A')
  assert.deepEqual(a.children.map((item) => item.childId).sort(), [EX + 'B', EX + 'C'])

  assert.deepEqual(hierarchy.roots.sort(), [EX + 'A', EX + 'Person'])
  assert.deepEqual(hierarchy.orphans, [EX + 'D'])
  assert.equal(hierarchy.cycles.length, 0)
  assert.equal(hierarchy.stats.truncated, 0)
})

test('hierarchy: rdf:type is never inheritance', () => {
  const graph = graphOf(
    'ex:Animal a owl:Class .\n' +
    'ex:rex a ex:Animal .\n' +
    'ex:Cat a owl:Class ; rdfs:subClassOf ex:Animal .\n',
  )
  const hierarchy = buildHierarchy(graph, { mode: 'class' })
  const animal = hierarchy.entities.get(EX + 'Animal')
  assert.deepEqual(animal.children.map((item) => item.childId), [EX + 'Cat'])
  assert.equal(hierarchy.entities.has(EX + 'rex'), false, 'instances are not classes')
  const layered = layoutLayeredGraph(graph, { predicates: [RDF + 'type'] })
  const edgePairs = layered.edges.map((edge) => edge.source + '>' + edge.target)
  assert.ok(edgePairs.includes(EX + 'rex>' + EX + 'Animal'))
})

test('hierarchy: property mode follows subPropertyOf only', () => {
  const graph = graphOf(
    'ex:p1 a owl:ObjectProperty .\n' +
    'ex:p2 a owl:ObjectProperty ; rdfs:subPropertyOf ex:p1 .\n' +
    'ex:p3 a owl:DatatypeProperty .\n',
  )
  const properties = buildHierarchy(graph, { mode: 'property' })
  assert.equal(properties.predicate, RDFS + 'subPropertyOf')
  assert.deepEqual(properties.roots, [EX + 'p1'])
  assert.deepEqual(properties.orphans, [EX + 'p3'])
  const p2 = properties.entities.get(EX + 'p2')
  assert.deepEqual(p2.parents.map((item) => item.parentId), [EX + 'p1'])

  const classes = buildHierarchy(graph, { mode: 'class' })
  assert.equal(classes.stats.entities, 0, 'no class declarations or subClassOf')
})

test('hierarchy: multiple inheritance expands to several display references', () => {
  const hierarchy = buildHierarchy(CLASS_FIXTURE, { mode: 'class' })
  const expanded = expandHierarchy(hierarchy, {
    expandedIds: [EX + 'A', EX + 'B', EX + 'C'],
  })
  const cRefs = expanded.refs.filter((ref) => ref.entityId === EX + 'C')
  assert.equal(cRefs.length, 2, 'one reference per parent path')
  assert.notEqual(cRefs[0].refId, cRefs[1].refId)
  assert.deepEqual(cRefs.map((ref) => ref.parentRefId).sort(),
    expanded.refs.filter((ref) => ref.entityId === EX + 'A' && ref.depth === 0)
      .concat(expanded.refs.filter((ref) => ref.entityId === EX + 'B'))
      .map((ref) => ref.refId).sort())
  assert.equal(expanded.stats.refs, expanded.refs.length)
})

test('hierarchy: cycles are grouped, marked and finite', () => {
  const graph = graphOf(
    'ex:X a owl:Class ; rdfs:subClassOf ex:Y .\n' +
    'ex:Y a owl:Class ; rdfs:subClassOf ex:X .\n',
  )
  const hierarchy = buildHierarchy(graph, { mode: 'class' })
  assert.equal(hierarchy.cycles.length, 1)
  assert.deepEqual(hierarchy.cycles[0].members, [EX + 'X', EX + 'Y'])
  assert.equal(hierarchy.entities.get(EX + 'X').inCycle, true)
  assert.equal(hierarchy.entities.get(EX + 'Y').inCycle, true)

  const expanded = expandHierarchy(hierarchy, { expandedIds: [EX + 'X', EX + 'Y'] })
  assert.ok(expanded.refs.length > 0)
  assert.ok(expanded.refs.every((ref) => Number.isFinite(ref.depth)))
  assert.ok(expanded.refs.length <= VIEW_BUDGETS.maxRefs)
  assert.ok(expanded.refs.some((ref) => ref.cycle === true), 'a repeated entity is a cycle reference')
})

test('hierarchy: self loop stays visible and does not recurse', () => {
  const graph = graphOf('ex:S a owl:Class ; rdfs:subClassOf ex:S .\n')
  const hierarchy = buildHierarchy(graph, { mode: 'class' })
  assert.equal(hierarchy.stats.entities, 1)
  assert.equal(hierarchy.entities.get(EX + 'S').inCycle, true)
  const expanded = expandHierarchy(hierarchy, { expandedIds: [EX + 'S'] })
  assert.equal(expanded.refs.filter((ref) => ref.entityId === EX + 'S').length, 1)
  assert.ok(expanded.refs[0].inCycle)
})

test('hierarchy: relation provenance is exposed on parent links', () => {
  const hierarchy = buildHierarchy(CLASS_FIXTURE, { mode: 'class' })
  const c = hierarchy.entities.get(EX + 'C')
  for (const relation of c.parents) {
    assert.ok(relation.relationId)
    assert.ok(Array.isArray(relation.statementIds))
    assert.ok(relation.statementIds.length >= 1)
    assert.deepEqual(relation.sourceIds, ['src1'])
  }
})

test('hierarchy: budgets bound entities and expansion references', () => {
  let body = 'ex:Root a owl:Class .\n'
  for (let index = 0; index < 30; index++) {
    body += 'ex:Child' + index + ' a owl:Class ; rdfs:subClassOf ex:Root .\n'
  }
  const graph = graphOf(body)
  const hierarchy = buildHierarchy(graph, { mode: 'class', maxEntities: 10 })
  assert.equal(hierarchy.stats.entities, 10)
  assert.equal(hierarchy.stats.truncated, 21)

  const expanded = expandHierarchy(hierarchy, {
    expandedIds: hierarchy.entityIds,
    maxRefs: 5,
    maxDepth: 3,
  })
  assert.equal(expanded.refs.length, 5)
  assert.ok(expanded.stats.truncated >= 1)
})

/* ------------------------------------------------------------------ */
/* Layered relation view                                              */
/* ------------------------------------------------------------------ */

test('scc: strongly connected components are deterministic', () => {
  const ids = ['a', 'b', 'c', 'd']
  const adjacency = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a', 'd']],
    ['d', []],
  ])
  const first = computeStronglyConnectedComponents(ids, adjacency)
  const second = computeStronglyConnectedComponents(ids, adjacency)
  assert.deepEqual(first.components, second.components)
  assert.equal(first.components.length, 2)
  const componentOfA = first.componentOf.get('a')
  assert.equal(first.componentOf.get('b'), componentOfA)
  assert.equal(first.componentOf.get('c'), componentOfA)
  assert.notEqual(first.componentOf.get('d'), componentOfA)
})

test('layered: inheritance projects to layers and cycles become groups', () => {
  const graph = graphOf(
    'ex:A a owl:Class .\n' +
    'ex:B a owl:Class ; rdfs:subClassOf ex:A .\n' +
    'ex:C a owl:Class ; rdfs:subClassOf ex:B .\n' +
    'ex:X a owl:Class ; rdfs:subClassOf ex:Y .\n' +
    'ex:Y a owl:Class ; rdfs:subClassOf ex:X .\n',
  )
  const layout = layoutLayeredGraph(graph, { predicates: [RDFS + 'subClassOf'] })
  assert.equal(layout.predicates.length, 1)
  assert.ok(layout.nodes.length >= 4)
  assert.equal(layout.groups.length, 1)
  assert.deepEqual(layout.groups[0].members, [EX + 'X', EX + 'Y'])
  assert.equal(layout.internalEdges.length, 2, 'edges inside the cycle stay visible')
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y))
    assert.ok(node.x >= 0 && node.x <= 900)
    assert.ok(node.y >= 0 && node.y <= 600)
  }
  // A is the root of the chain; C and the cycle group sit above it.
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  assert.ok(byId.get(EX + 'A').layer > byId.get(EX + 'B').layer)
  assert.ok(byId.get(EX + 'B').layer > byId.get(EX + 'C').layer)
})

test('layered: layout is deterministic and orientation swaps axes', () => {
  const down = layoutLayeredGraph(CLASS_FIXTURE)
  const downAgain = layoutLayeredGraph(CLASS_FIXTURE)
  assert.deepEqual(down.nodes, downAgain.nodes)

  const right = layoutLayeredGraph(CLASS_FIXTURE, { orientation: 'right' })
  const byId = new Map(right.nodes.map((node) => [node.id, node]))
  assert.notDeepEqual(
    { x: byId.get(EX + 'A').x, y: byId.get(EX + 'A').y },
    { x: down.nodes.find((node) => node.id === EX + 'A').x, y: down.nodes.find((node) => node.id === EX + 'A').y },
  )
})

test('layered: predicate selection and empty projections are explicit', () => {
  const graph = graphOf(
    'ex:A a owl:Class .\n' +
    'ex:B a owl:Class ; rdfs:subClassOf ex:A .\n' +
    'ex:p1 a owl:ObjectProperty .\n' +
    'ex:p2 a owl:ObjectProperty ; rdfs:subPropertyOf ex:p1 .\n',
  )
  const subProperty = layoutLayeredGraph(graph, { predicates: [RDFS + 'subPropertyOf'] })
  assert.equal(subProperty.stats.nodes, 2)
  assert.equal(subProperty.edges.length, 1)

  const both = layoutLayeredGraph(graph, {
    predicates: [RDFS + 'subClassOf', RDFS + 'subPropertyOf'],
  })
  assert.equal(both.stats.edges, 2)

  const none = layoutLayeredGraph(graph, { predicates: ['http://e/missing'] })
  assert.equal(none.stats.nodes, 0)
  assert.equal(none.edges.length, 0)
})

test('layered: node and layer budgets are reported deterministically', () => {
  let body = ''
  for (let index = 0; index < 20; index++) {
    body += 'ex:Node' + index + ' a owl:Class .\n'
  }
  for (let index = 1; index < 20; index++) {
    body += 'ex:Node' + index + ' rdfs:subClassOf ex:Node' + (index - 1) + ' .\n'
  }
  const graph = graphOf(body)
  const tight = layoutLayeredGraph(graph, { maxNodes: 6, maxLayers: 3 })
  assert.ok(tight.stats.truncatedNodes > 0)
  assert.ok(tight.stats.truncatedLayers > 0)
  assert.ok(tight.nodes.length <= 6)
  assert.ok(tight.layers <= 3)
  const again = layoutLayeredGraph(graph, { maxNodes: 6, maxLayers: 3 })
  assert.deepEqual(tight.nodes, again.nodes)
})

test('layered: self loops are kept as internal edges, not layout nodes', () => {
  const graph = graphOf(
    'ex:S a owl:Class ; rdfs:subClassOf ex:S .\n' +
    'ex:T a owl:Class ; rdfs:subClassOf ex:S .\n',
  )
  const layout = layoutLayeredGraph(graph, { predicates: [RDFS + 'subClassOf'] })
  assert.ok(layout.internalEdges.some((edge) => edge.source === EX + 'S' && edge.target === EX + 'S'))
  assert.ok(layout.nodes.some((node) => node.id === EX + 'S'))
})
