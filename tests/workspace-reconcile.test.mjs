/**
 * Node tests for the shared workspace state reconciliation (6.1).
 *
 * When the retained graph or the source set changes, stale selections, anchors,
 * predicates and exploration cursors must be dropped instead of silently
 * keeping an invalid projection; valid filter kinds and sources survive.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileWorkspaceState } from '../src/ontology-view-state.js'

const graph = {
  nodes: [
    { id: 'urn:A', kind: 'class' },
    { id: 'urn:B', kind: 'individual' },
  ],
  edges: [
    { source: 'urn:A', target: 'urn:B', p: 'http://e/p1' },
    { source: 'urn:B', target: 'urn:A', p: 'http://e/p2' },
  ],
}

test('shared workspace state: invalid selection and anchor are cleared', () => {
  const state = reconcileWorkspaceState({
    query: 'A', selectedId: 'urn:gone', anchorId: 'urn:B',
    filter: { kinds: ['class'], predicates: [], direction: 'both' },
    explore: { on: true, depth: 2, cursor: 'c1', extension: 3 },
  }, graph, ['s1'])
  assert.equal(state.selectedId, null)
  assert.equal(state.anchorId, 'urn:B', 'a still-valid anchor survives')
  assert.equal(state.explore.on, true)
  assert.equal(state.explore.cursor, null, 'exploration cursor is always dropped')
  assert.equal(state.explore.extension, 0)
  assert.deepEqual(state.filter.kinds, ['class'])
  assert.equal(state.query, 'A')
})

test('shared workspace state: exploration turns off when the anchor is gone', () => {
  const state = reconcileWorkspaceState({
    selectedId: 'urn:A', anchorId: 'urn:gone',
    filter: { kinds: [], predicates: [], direction: 'out' },
    explore: { on: true, depth: 3, cursor: 'c2' },
  }, graph, ['s1'])
  assert.equal(state.anchorId, null)
  assert.equal(state.explore.on, false)
  assert.equal(state.explore.cursor, null)
  assert.equal(state.filter.direction, 'out', 'direction survives an invalid anchor')
})

test('shared workspace state: predicates and source ids are pruned to what exists', () => {
  const state = reconcileWorkspaceState({
    selectedId: 'urn:A',
    filter: {
      kinds: ['class', 'unknown-kind'],
      predicates: ['http://e/p1', 'http://e/missing'],
      direction: 'sideways',
      sourceIds: ['s1', 's9'],
    },
    explore: {},
  }, graph, ['s1'])
  assert.deepEqual(state.filter.predicates, ['http://e/p1'])
  assert.deepEqual(state.filter.sourceIds, ['s1'])
  assert.equal(state.filter.direction, 'both', 'an unknown direction falls back to both')
  assert.equal(state.selectedId, 'urn:A')
})

test('shared workspace state: missing graph or sources never invents state', () => {
  const state = reconcileWorkspaceState({ selectedId: 'urn:A', anchorId: 'urn:A' }, null, null)
  assert.equal(state.selectedId, null)
  assert.equal(state.anchorId, null)
  assert.equal(state.explore.on, false)
  assert.deepEqual(state.filter.kinds, [])
  assert.equal(state.query, '')
})
