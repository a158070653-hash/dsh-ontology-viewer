/**
 * Semantic projections over the L1 graph: the class/property hierarchy tree
 * and the layered relation view.
 *
 * Both projections are read-only. They never add synthetic RDF entities or
 * assertions to the graph: display references, cycle groups and layout
 * coordinates live only in the projection result. All coordinates are
 * deterministic (stable ordering, no Math.random) and bounded by explicit
 * budgets.
 *
 * Plain ECMAScript: concatenated into the Client bundle and the embedded
 * Worker (see build/build.mjs), and imported directly by Node tests.
 */

const VIEW_RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const VIEW_RDF_PROPERTY = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'
const VIEW_RDFS_SUBCLASSOF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const VIEW_RDFS_SUBPROPERTYOF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf'
const VIEW_RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const VIEW_OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const VIEW_RDFS_CLASS = 'http://www.w3.org/2000/01/rdf-schema#Class'
const VIEW_OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'
const VIEW_OWL_DATATYPE_PROPERTY = 'http://www.w3.org/2002/07/owl#DatatypeProperty'

const VIEW_HIERARCHY_DEFAULT_PREDICATE = VIEW_RDFS_SUBCLASSOF
const VIEW_GROUP_MARKER = '\u0000group\u0000'

/** Default element/expansion budgets (callers may override). */
export const VIEW_BUDGETS = Object.freeze({
  maxEntities: 1200,
  maxRefs: 2000,
  maxDepth: 12,
  maxLayers: 200,
  maxLayerWidth: 80,
})

function viewIsObject(value) {
  return value !== null && typeof value === 'object'
}

function viewCompare(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function viewString(value) {
  return value === null || value === undefined ? '' : String(value)
}

function viewPositive(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

/**
 * Iterative Tarjan strongly-connected components.
 *
 * @param {string[]} ids node ids in deterministic order
 * @param {Map<string, string[]>} outAdjacency outgoing edges per id
 * @returns {{componentOf: Map<string, number>, components: string[][]}}
 */
export function computeStronglyConnectedComponents(ids, outAdjacency) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const componentOf = new Map()
  const components = []
  let counter = 0

  for (const rootId of ids) {
    if (index.has(rootId)) continue
    const frames = [{ id: rootId, next: 0 }]
    index.set(rootId, counter)
    low.set(rootId, counter)
    counter += 1
    stack.push(rootId)
    onStack.add(rootId)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      const neighbors = outAdjacency.get(frame.id) || []
      if (frame.next < neighbors.length) {
        const nextId = neighbors[frame.next]
        frame.next += 1
        if (!index.has(nextId)) {
          index.set(nextId, counter)
          low.set(nextId, counter)
          counter += 1
          stack.push(nextId)
          onStack.add(nextId)
          frames.push({ id: nextId, next: 0 })
        } else if (onStack.has(nextId)) {
          low.set(frame.id, Math.min(low.get(frame.id), index.get(nextId)))
        }
        continue
      }
      frames.pop()
      if (frames.length > 0) {
        const parent = frames[frames.length - 1]
        low.set(parent.id, Math.min(low.get(parent.id), low.get(frame.id)))
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
          componentOf.set(member, components.length)
        } while (member !== frame.id)
        components.push(component)
      }
    }
  }
  return { componentOf, components }
}

/** Node ids in graph order, plus a lookup for one node by id. */
function viewNodeIndex(graph) {
  const nodes = viewIsObject(graph) && Array.isArray(graph.nodes) ? graph.nodes : []
  const byId = new Map()
  for (const node of nodes) {
    if (!viewIsObject(node) || typeof node.id !== 'string') continue
    if (!byId.has(node.id)) byId.set(node.id, node)
  }
  return { nodes: Array.from(byId.values()), byId }
}

/** Class-like candidate ids derived from explicit declarations and hierarchy. */
function viewClassCandidates(byId) {
  const candidates = new Set()
  for (const node of byId.values()) {
    if (node.kind === 'class') candidates.add(node.id)
  }
  return candidates
}

/**
 * Build the class or property hierarchy projection.
 *
 * Mode `class` follows explicit rdfs:subClassOf; mode `property` follows
 * explicit rdfs:subPropertyOf. `rdf:type` never becomes inheritance. The
 * result reports roots, orphan entities, cycles and budget truncation so the
 * view can explain missing structure instead of silently inventing it.
 *
 * @param {any} graph L1 graph
 * @param {{mode?: 'class'|'property', predicate?: string,
 *          maxEntities?: number}} [options]
 */
export function buildHierarchy(graph, options) {
  const opts = viewIsObject(options) ? options : {}
  const mode = opts.mode === 'property' ? 'property' : 'class'
  const predicate = typeof opts.predicate === 'string' && opts.predicate
    ? opts.predicate
    : (mode === 'property' ? VIEW_RDFS_SUBPROPERTYOF : VIEW_HIERARCHY_DEFAULT_PREDICATE)
  const maxEntities = viewPositive(opts.maxEntities, VIEW_BUDGETS.maxEntities)
  const { nodes, byId } = viewNodeIndex(graph)
  const edges = viewIsObject(graph) && Array.isArray(graph.edges) ? graph.edges : []

  // Candidates are entities the document explicitly declares as classes (or
  // properties) plus both ends of a hierarchy relation. A node that is only
  // the object of rdf:type is a vocabulary reference, not a declared class, so
  // it does not flood the tree with owl:Class / rdfs:Class entries.
  const declaredTypes = mode === 'property'
    ? [VIEW_OWL_OBJECT_PROPERTY, VIEW_OWL_DATATYPE_PROPERTY, VIEW_RDF_PROPERTY]
    : [VIEW_OWL_CLASS, VIEW_RDFS_CLASS]
  const candidates = new Set()
  for (const node of nodes) {
    const types = Array.isArray(node.types) ? node.types : []
    for (const type of declaredTypes) {
      if (types.indexOf(type) >= 0) {
        candidates.add(node.id)
        break
      }
    }
  }
  for (const edge of edges) {
    if (!viewIsObject(edge) || edge.p !== predicate) continue
    if (typeof edge.source === 'string' && byId.has(edge.source)) candidates.add(edge.source)
    if (typeof edge.target === 'string' && byId.has(edge.target)) candidates.add(edge.target)
  }

  // Deterministic budget: keep the entities with the most hierarchy relations,
  // then the lexicographically smallest id.
  const relationCount = new Map()
  for (const id of candidates) relationCount.set(id, 0)
  for (const edge of edges) {
    if (!viewIsObject(edge) || edge.p !== predicate) continue
    if (relationCount.has(edge.source)) relationCount.set(edge.source, relationCount.get(edge.source) + 1)
    if (relationCount.has(edge.target)) relationCount.set(edge.target, relationCount.get(edge.target) + 1)
  }
  let keptIds = Array.from(candidates)
  keptIds.sort((a, b) => {
    const diff = (relationCount.get(b) || 0) - (relationCount.get(a) || 0)
    return diff !== 0 ? diff : viewCompare(a, b)
  })
  const entityTruncated = Math.max(0, keptIds.length - maxEntities)
  keptIds = keptIds.slice(0, maxEntities)
  const kept = new Set(keptIds)

  const entities = new Map()
  for (const id of keptIds) {
    const node = byId.get(id)
    entities.set(id, {
      id: id,
      label: node && typeof node.label === 'string' && node.label ? node.label : id,
      kind: node ? node.kind : 'external',
      iri: node && typeof node.iri === 'string' ? node.iri : id,
      parents: [],
      children: [],
      sourceIds: node && viewIsObject(node.provenance) && Array.isArray(node.provenance.sourceIds)
        ? node.provenance.sourceIds.slice()
        : [],
      inCycle: false,
      orphan: false,
    })
  }

  // Child -> parent edge direction. `relationId` points at the real graph edge.
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index]
    if (!viewIsObject(edge) || edge.p !== predicate) continue
    if (!kept.has(edge.source) || !kept.has(edge.target)) continue
    if (edge.source === edge.target) continue
    const relation = {
      relationId: typeof edge.id === 'string' ? edge.id : 'edge:' + index,
      predicate: edge.p,
      statementIds: Array.isArray(edge.statementIds) ? edge.statementIds.slice() : [],
      sourceIds: Array.isArray(edge.sourceIds) ? edge.sourceIds.slice() : [],
      graphs: Array.isArray(edge.graphs) ? edge.graphs.slice() : [],
    }
    const child = entities.get(edge.source)
    const parent = entities.get(edge.target)
    if (!child || !parent) continue
    child.parents.push(Object.assign({ parentId: edge.target }, relation))
    parent.children.push(Object.assign({ childId: edge.source }, relation))
  }

  // Self loops are cycles too; they stay visible as a cycle mark on the entity.
  for (const edge of edges) {
    if (!viewIsObject(edge) || edge.p !== predicate || edge.source !== edge.target) continue
    const entity = entities.get(edge.source)
    if (entity) entity.inCycle = true
  }

  const ids = keptIds.slice()
  const outAdjacency = new Map()
  for (const id of ids) outAdjacency.set(id, [])
  for (const entity of entities.values()) {
    const parents = entity.parents.map((relation) => relation.parentId).sort(viewCompare)
    outAdjacency.set(entity.id, parents)
  }
  const { componentOf, components } = computeStronglyConnectedComponents(ids, outAdjacency)
  for (const entity of entities.values()) {
    const component = components[componentOf.get(entity.id)]
    if (component.length > 1) entity.inCycle = true
  }

  const roots = []
  const cycles = []
  const orphans = []
  const componentMembers = new Map()
  for (const component of components) {
    if (component.length < 2) continue
    const members = component.slice().sort(viewCompare)
    componentMembers.set(component[0], members)
    for (const id of members) {
      const entity = entities.get(id)
      if (entity) entity.componentId = component[0]
    }
  }
  for (const id of ids) {
    const entity = entities.get(id)
    if (!entity) continue
    if (entity.inCycle) {
      const members = componentMembers.get(id)
      if (members) {
        // One group per multi-node SCC, emitted from its first member.
        if (!cycles.some((cycle) => cycle.id === id)) {
          const hasIncoming = members.some((memberId) => {
            const member = entities.get(memberId)
            return member && member.parents.some((relation) => members.indexOf(relation.parentId) < 0)
          })
          cycles.push({ id: id, members: members, hasExternalParent: hasIncoming })
        }
        continue
      }
      // A self loop marks the entity; with no other structure it stays a
      // visible root entry so the cycle is reachable.
      if (entity.parents.length === 0 && entity.children.length === 0) {
        entity.selfCycle = true
        roots.push(id)
      }
      continue
    }
    if (entity.parents.length === 0) {
      if (entity.children.length === 0) orphans.push(id)
      else roots.push(id)
    }
  }
  roots.sort(viewCompare)
  orphans.sort(viewCompare)
  cycles.sort((a, b) => viewCompare(a.id, b.id))

  let relationCountTotal = 0
  for (const entity of entities.values()) relationCountTotal += entity.parents.length

  return {
    mode: mode,
    predicate: predicate,
    entities: entities,
    entityIds: ids,
    roots: roots,
    orphans: orphans,
    cycles: cycles,
    stats: {
      entities: entities.size,
      relations: relationCountTotal,
      roots: roots.length,
      orphans: orphans.length,
      cycles: cycles.length,
      truncated: entityTruncated,
      maxEntities: maxEntities,
    },
  }
}

/**
 * Materialize only the expanded paths of a hierarchy into display references.
 *
 * Roots and orphan entries always get one reference. Every child of an
 * expanded entity becomes its own reference, so one entity reached by several
 * paths appears several times while every reference still points at the same
 * entity id. A path that revisits an entity gets a `cycle` reference instead
 * of recursing.
 *
 * @param {ReturnType<typeof buildHierarchy>} hierarchy
 * @param {{expandedIds?: string[], maxRefs?: number, maxDepth?: number}} [options]
 */
export function expandHierarchy(hierarchy, options) {
  const input = viewIsObject(hierarchy) ? hierarchy : { entities: new Map() }
  const opts = viewIsObject(options) ? options : {}
  const maxRefs = viewPositive(opts.maxRefs, VIEW_BUDGETS.maxRefs)
  const maxDepth = viewPositive(opts.maxDepth, VIEW_BUDGETS.maxDepth)
  const expanded = new Set(Array.isArray(opts.expandedIds) ? opts.expandedIds : [])
  const entities = input.entities instanceof Map ? input.entities : new Map()
  const refs = []
  let truncatedRefs = 0

  function pushRef(entityId, parentRefId, depth, path, relation) {
    if (refs.length >= maxRefs) {
      truncatedRefs += 1
      return null
    }
    const entity = entities.get(entityId)
    if (!entity) return null
    const cycle = path.indexOf(entityId) >= 0
    const ref = {
      refId: 'r' + refs.length,
      entityId: entityId,
      parentRefId: parentRefId,
      depth: depth,
      cycle: cycle,
      expanded: !cycle && expanded.has(entityId),
      childCount: entity.children.length,
      orphan: !!entity.orphan,
      inCycle: !!entity.inCycle,
      label: entity.label,
      kind: entity.kind,
    }
    if (relation) {
      ref.relationId = relation.relationId
      ref.statementIds = relation.statementIds
      ref.sourceIds = relation.sourceIds
    }
    refs.push(ref)
    return ref
  }

  const queue = []
  for (const id of input.roots || []) queue.push({ entityId: id, parentRefId: null, depth: 0, path: [], relation: null })
  for (const cycle of input.cycles || []) {
    queue.push({
      entityId: cycle.members[0],
      parentRefId: null,
      depth: 0,
      path: [],
      relation: null,
      cycleGroup: cycle.members.slice(),
    })
  }
  for (const id of input.orphans || []) {
    queue.push({ entityId: id, parentRefId: null, depth: 0, path: [], relation: null, orphan: true })
  }
  let cursor = 0
  while (cursor < queue.length) {
    const item = queue[cursor]
    cursor += 1
    const entity = entities.get(item.entityId)
    if (!entity) continue
    const ref = pushRef(item.entityId, item.parentRefId, item.depth, item.path, item.relation)
    if (!ref) continue
    if (item.cycleGroup) ref.cycleGroup = item.cycleGroup
    if (item.orphan) ref.orphan = true
    if (!ref.expanded || ref.depth >= maxDepth) continue
    const path = item.path.concat([item.entityId])
    for (const relation of entity.children) {
      queue.push({
        entityId: relation.childId,
        parentRefId: ref.refId,
        depth: ref.depth + 1,
        path: path,
        relation: relation,
      })
    }
  }
  return {
    refs: refs,
    stats: {
      refs: refs.length,
      entities: entities.size,
      truncated: truncatedRefs,
      maxRefs: maxRefs,
    },
  }
}

/** Effective predicates of a layered projection (user-selected, else one). */
function viewPredicates(options, fallback) {
  if (Array.isArray(options.predicates)) {
    const unique = []
    for (const value of options.predicates) {
      if (typeof value === 'string' && value && unique.indexOf(value) < 0) unique.push(value)
    }
    if (unique.length > 0) return unique.sort(viewCompare)
  }
  return [fallback]
}

/**
 * Build and lay out the layered relation graph.
 *
 * The selected predicates are projected onto the L1 graph, strongly connected
 * components are contracted into visible groups, and the condensation is
 * layered with a longest-path assignment plus a bounded barycenter sweep.
 * Coordinates are deterministic and limited to the requested canvas.
 *
 * @param {any} graph L1 (or L2) graph
 * @param {{predicates?: string[], orientation?: 'down'|'right',
 *          width?: number, height?: number, maxNodes?: number,
 *          maxLayers?: number}} [options]
 */
export function layoutLayeredGraph(graph, options) {
  const opts = viewIsObject(options) ? options : {}
  const predicates = viewPredicates(opts, VIEW_RDFS_SUBCLASSOF)
  const orientation = opts.orientation === 'right' ? 'right' : 'down'
  const width = viewPositive(opts.width, 900)
  const height = viewPositive(opts.height, 600)
  const maxNodes = viewPositive(opts.maxNodes, VIEW_BUDGETS.maxEntities)
  const maxLayers = viewPositive(opts.maxLayers, VIEW_BUDGETS.maxLayers)
  const { nodes, byId } = viewNodeIndex(graph)
  const edges = viewIsObject(graph) && Array.isArray(graph.edges) ? graph.edges : []

  const predicateSet = new Set(predicates)
  const projected = []
  const selfLoopEdges = []
  const used = new Set()
  for (const edge of edges) {
    if (!viewIsObject(edge) || !predicateSet.has(edge.p)) continue
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string') continue
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    if (edge.source === edge.target) {
      selfLoopEdges.push(edge)
      used.add(edge.source)
      continue
    }
    projected.push({ edge: edge, internal: false })
    used.add(edge.source)
    used.add(edge.target)
  }

  let candidates = Array.from(used)
  candidates.sort(viewCompare)
  const nodeTruncated = Math.max(0, candidates.length - maxNodes)
  candidates = candidates.slice(0, maxNodes)
  const kept = new Set(candidates)

  // Self loops stay visible on their entity; other edges respect the budget.
  const keptEdges = []
  for (const item of projected) {
    if (item.internal) continue
    if (kept.has(item.edge.source) && kept.has(item.edge.target)) keptEdges.push(item.edge)
  }

  const adjacency = new Map()
  for (const id of candidates) adjacency.set(id, [])
  for (const edge of keptEdges) adjacency.get(edge.source).push(edge.target)
  const { componentOf, components } = computeStronglyConnectedComponents(candidates, adjacency)

  const groups = []
  const groupKeyOf = new Map()
  const displayIdOf = new Map()
  for (const id of candidates) {
    const component = components[componentOf.get(id)]
    if (component.length > 1) {
      const anchor = component.slice().sort(viewCompare)[0]
      groupKeyOf.set(id, anchor)
      displayIdOf.set(id, VIEW_GROUP_MARKER + anchor)
    } else {
      displayIdOf.set(id, id)
    }
  }
  const groupAnchors = new Set()
  for (const id of candidates) {
    const anchor = groupKeyOf.get(id)
    if (anchor === undefined || groupAnchors.has(anchor)) continue
    groupAnchors.add(anchor)
    groups.push({
      id: VIEW_GROUP_MARKER + anchor,
      anchor: anchor,
      members: components[componentOf.get(anchor)].slice().sort(viewCompare),
    })
  }
  groups.sort((a, b) => viewCompare(a.anchor, b.anchor))

  const displayIds = []
  for (const group of groups) displayIds.push(group.id)
  for (const id of candidates) {
    if (groupKeyOf.has(id)) continue
    displayIds.push(id)
  }
  displayIds.sort(viewCompare)
  const displayIndex = new Map()
  for (let index = 0; index < displayIds.length; index++) displayIndex.set(displayIds[index], index)

  // Condensation edges between display nodes.
  const displayAdjacency = new Map()
  for (const id of displayIds) displayAdjacency.set(id, [])
  const crossEdges = []
  const internalEdges = []
  for (const edge of keptEdges) {
    const from = displayIdOf.get(edge.source)
    const to = displayIdOf.get(edge.target)
    if (from === to) {
      internalEdges.push(edge)
      continue
    }
    crossEdges.push(edge)
    displayAdjacency.get(from).push(to)
  }
  // Parallel condensation edges collapse for layering, not for rendering.
  for (const id of displayIds) {
    const unique = Array.from(new Set(displayAdjacency.get(id))).sort(viewCompare)
    displayAdjacency.set(id, unique)
  }

  // Longest-path layering over the condensation DAG (Kahn order).
  const indegree = new Map()
  for (const id of displayIds) indegree.set(id, 0)
  for (const id of displayIds) {
    for (const next of displayAdjacency.get(id)) indegree.set(next, indegree.get(next) + 1)
  }
  const queue = displayIds.filter((id) => indegree.get(id) === 0)
  queue.sort(viewCompare)
  const layer = new Map()
  for (const id of displayIds) layer.set(id, 0)
  const order = []
  while (queue.length > 0) {
    const id = queue.shift()
    order.push(id)
    for (const next of displayAdjacency.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1))
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) {
        queue.push(next)
        queue.sort(viewCompare)
      }
    }
  }
  // Every display node is in the condensation DAG, so `order` is complete.

  // Layer budget: drop deepest layers deterministically.
  let layerCount = 0
  for (const id of displayIds) layerCount = Math.max(layerCount, layer.get(id) + 1)
  const layerTruncated = Math.max(0, layerCount - maxLayers)
  const visible = new Set()
  for (const id of displayIds) {
    if (layer.get(id) < maxLayers) visible.add(id)
  }

  // Barycenter sweeps (bounded) to reduce crossings within layers.
  const layers = []
  for (let index = 0; index < layerCount && index < maxLayers; index++) layers.push([])
  for (const id of order) {
    if (!visible.has(id)) continue
    layers[layer.get(id)].push(id)
  }
  for (const list of layers) list.sort(viewCompare)
  const position = new Map()
  function reindex() {
    for (const list of layers) {
      for (let index = 0; index < list.length; index++) position.set(list[index], index)
    }
  }
  reindex()
  const incoming = new Map()
  for (const id of displayIds) incoming.set(id, [])
  for (const id of displayIds) {
    for (const next of displayAdjacency.get(id)) incoming.get(next).push(id)
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    const topDown = sweep % 2 === 0
    const sequence = topDown ? layers.slice(1) : layers.slice(0, -1).reverse()
    for (const list of sequence) {
      const scores = new Map()
      for (const id of list) {
        const neighbors = topDown ? incoming.get(id) : displayAdjacency.get(id)
        let sum = 0
        let count = 0
        for (const neighbor of neighbors) {
          if (!visible.has(neighbor)) continue
          sum += position.get(neighbor)
          count += 1
        }
        scores.set(id, count === 0 ? position.get(id) : sum / count)
      }
      list.sort((a, b) => {
        const diff = scores.get(a) - scores.get(b)
        return diff !== 0 ? diff : viewCompare(a, b)
      })
    }
    reindex()
  }

  // Coordinates: layers along one axis, members spread along the other.
  const padding = 24
  const innerWidth = Math.max(1, width - padding * 2)
  const innerHeight = Math.max(1, height - padding * 2)
  const positions = new Map()
  const layerSpan = orientation === 'down' ? innerHeight : innerWidth
  const laneSpan = orientation === 'down' ? innerWidth : innerHeight
  const layerStep = Math.max(1, layerSpan / Math.max(1, layers.length))
  for (let index = 0; index < layers.length; index++) {
    const list = layers[index]
    const laneStep = Math.max(1, laneSpan / Math.max(1, list.length))
    for (let lane = 0; lane < list.length; lane++) {
      const along = padding + layerStep * (index + 0.5)
      const across = padding + laneStep * (lane + 0.5)
      positions.set(list[lane], orientation === 'down'
        ? { x: across, y: along }
        : { x: along, y: across })
    }
  }

  const layoutNodes = []
  for (const id of displayIds) {
    if (!visible.has(id) || !positions.has(id)) continue
    const point = positions.get(id)
    const group = groups.find((item) => item.id === id)
    const node = group ? null : byId.get(id)
    layoutNodes.push({
      id: id,
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100,
      layer: layer.get(id),
      label: group ? id : (node && node.label) || id,
      kind: group ? 'group' : (node ? node.kind : 'external'),
      groupId: group ? group.id : null,
      memberCount: group ? group.members.length : 0,
    })
  }
  const layoutEdges = []
  for (const edge of crossEdges) {
    const from = displayIdOf.get(edge.source)
    const to = displayIdOf.get(edge.target)
    if (!visible.has(from) || !visible.has(to)) continue
    layoutEdges.push({
      id: edge.id,
      source: from,
      target: to,
      p: edge.p,
      label: edge.label,
      count: edge.count,
      sourceIds: edge.sourceIds,
      statementIds: edge.statementIds,
    })
  }
  const internal = []
  for (const edge of internalEdges) {
    internal.push({
      id: edge.id,
      source: displayIdOf.get(edge.source),
      target: displayIdOf.get(edge.target),
      p: edge.p,
      label: edge.label,
      count: edge.count,
      sourceIds: edge.sourceIds,
      statementIds: edge.statementIds,
    })
  }
  for (const edge of selfLoopEdges) {
    if (!visible.has(displayIdOf.get(edge.source))) continue
    internal.push({
      id: edge.id,
      source: displayIdOf.get(edge.source),
      target: displayIdOf.get(edge.source),
      p: edge.p,
      label: edge.label,
      count: edge.count,
      sourceIds: edge.sourceIds,
      statementIds: edge.statementIds,
      selfLoop: true,
    })
  }

  return {
    orientation: orientation,
    predicates: predicates,
    nodes: layoutNodes,
    edges: layoutEdges,
    internalEdges: internal,
    groups: groups.map((group) => ({
      id: group.id,
      anchor: group.anchor,
      members: group.members,
    })),
    layers: layers.length,
    bounds: { minX: padding, minY: padding, width: width - padding * 2, height: height - padding * 2 },
    stats: {
      nodes: layoutNodes.length,
      edges: layoutEdges.length,
      internalEdges: internal.length,
      groups: groups.length,
      layers: layers.length,
      truncatedNodes: nodeTruncated,
      truncatedLayers: layerTruncated,
      maxNodes: maxNodes,
      maxLayers: maxLayers,
    },
  }
}

/** Class/property hierarchy check used by the view to explain empty modes. */
export function hierarchyPredicateFor(mode) {
  return mode === 'property' ? VIEW_RDFS_SUBPROPERTYOF : VIEW_HIERARCHY_DEFAULT_PREDICATE
}

/** The rdf:type-based instance grouping predicate (never inheritance). */
export function instanceTypePredicate() {
  return VIEW_RDF_TYPE
}

/** Explicit class declaration types, for labels and grouping. */
export function classDeclarationTypes() {
  return [VIEW_OWL_CLASS, VIEW_RDFS_CLASS]
}

/** Label predicate used by the class tree when a node has no preferred label. */
export function hierarchyLabelPredicate() {
  return VIEW_RDFS_LABEL
}
