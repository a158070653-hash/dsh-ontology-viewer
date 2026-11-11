import test from 'node:test'
import assert from 'node:assert/strict'
import { createFileReadQueue } from '../src/ontology-file-queue.js'

const file = (name, text) => ({ name, size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer })

test('browser multi-file queue waits for parse acceptance before reading next source', async () => {
  const order = []
  let finishFirst
  const queue = createFileReadQueue({ accept: async ({ file: source }) => {
    order.push(source.name)
    if (source.name === 'one') await new Promise(resolve => { finishFirst = resolve })
  } })
  queue.enqueue([file('one', 'a'), file('two', 'b')])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['one'])
  finishFirst()
  await queue.whenIdle()
  assert.deepEqual(order, ['one', 'two'])
  assert.equal(queue.pending, 0)
})

test('late read from a previous document is never accepted', async () => {
  let finishRead
  const accepted = []
  const queue = createFileReadQueue({ accept: async input => accepted.push(input.file.name) })
  queue.enqueue([{ name: 'old', size: 1, arrayBuffer: () => new Promise(resolve => { finishRead = resolve }) }])
  await new Promise(resolve => setImmediate(resolve))
  queue.invalidate()
  finishRead(new Uint8Array([65]).buffer)
  await queue.whenIdle()
  assert.deepEqual(accepted, [])
  await queue.enqueue([file('new', 'x')], 'replace-src')
  assert.deepEqual(accepted, ['new'])
})

test('byte budget is checked before read and invalid UTF-8 preserves prior source', async () => {
  let reads = 0
  const errors = []
  const accepted = []
  const queue = createFileReadQueue({ maxBytes: 2,
    accept: input => accepted.push(input), onError: (_, reason) => errors.push(reason) })
  await queue.enqueue([{ name: 'huge', size: 3, arrayBuffer: async () => { reads++; return new ArrayBuffer(3) } },
    { name: 'invalid', size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }])
  assert.equal(reads, 0)
  assert.equal(accepted.length, 0)
  assert.equal(errors[0], 'too-large')
  assert.equal(errors.length, 2)
})
