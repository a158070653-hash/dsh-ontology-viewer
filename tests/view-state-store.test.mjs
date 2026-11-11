/**
 * Node tests for the per-view workspace state cache (6.1).
 *
 * The cache only stores view-local values; selection remains shared. These
 * tests pin the state matrix, isolation between views and stale-layout rules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createViewStateStore,
  snapshotView,
  viewSnapshot,
  markLayoutRevision,
  isViewSnapshotStale,
  viewStateIds,
} from '../src/ontology-view-state.js'

test('view state: snapshots round-trip for every view and stay isolated', () => {
  const store = createViewStateStore()
  for (const view of viewStateIds()) {
    snapshotView(store, view, { query: view + '-q', expandedIds: [view] })
  }
  for (const view of viewStateIds()) {
    const saved = viewSnapshot(store, view)
    assert.equal(saved.query, view + '-q')
    assert.deepEqual(saved.expandedIds, [view])
    saved.query = 'mutated'
    assert.equal(viewSnapshot(store, view).query, view + '-q', 'readers get a copy')
  }
  assert.equal(viewSnapshot(store, 'nope').query, 'network-q', 'unknown views fall back to network')
})

test('view state: partial patches merge instead of replacing a view', () => {
  const store = createViewStateStore()
  snapshotView(store, 'tree', { query: 'a', expandedIds: ['x'] })
  snapshotView(store, 'tree', { expandedIds: ['x', 'y'] })
  const saved = viewSnapshot(store, 'tree')
  assert.equal(saved.query, 'a')
  assert.deepEqual(saved.expandedIds, ['x', 'y'])
  snapshotView(store, 'tree', { query: undefined })
  assert.equal(viewSnapshot(store, 'tree').query, 'a', 'undefined leaves the field alone')
})

test('view state: camera snapshots survive layout changes but are marked stale', () => {
  const store = createViewStateStore()
  markLayoutRevision(store, 3)
  snapshotView(store, 'network', { camera: { zoom: 2, panX: 10, panY: -5 } })
  assert.equal(viewSnapshot(store, 'network').revision, 3)
  assert.equal(isViewSnapshotStale(store, 'network'), false)
  markLayoutRevision(store, 4)
  assert.equal(isViewSnapshotStale(store, 'network'), true, 'an older layout revision is stale')
  snapshotView(store, 'network', {})
  assert.equal(isViewSnapshotStale(store, 'network'), false, 'a fresh snapshot follows the revision')
  assert.deepEqual(viewSnapshot(store, 'network').camera, { zoom: 2, panX: 10, panY: -5 })
})

test('view state: unknown view ids fall back to the network slot', () => {
  const store = createViewStateStore()
  snapshotView(store, 'mystery', { query: 'x' })
  assert.equal(viewSnapshot(store, 'network').query, 'x')
  assert.equal(viewSnapshot(store, 'mystery').query, 'x')
})

test('view state: a missing store never throws', () => {
  assert.deepEqual(viewSnapshot(null, 'tree'), {})
  assert.doesNotThrow(() => snapshotView(null, 'tree', { query: 'x' }))
  assert.equal(isViewSnapshotStale(null, 'tree'), false)
})
