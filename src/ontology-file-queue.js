/** Sequential browser reads; invalidation rejects late results without new authority. */
export function createFileReadQueue(options) {
  const opts = options || {}
  let revision = 0
  let tail = Promise.resolve()
  let disposed = false
  let pending = 0
  return {
    enqueue(files, replacementId) {
      const list = Array.isArray(files) ? files : []
      const token = revision
      for (const file of list) {
        pending += 1
        tail = tail.then(async () => {
          if (disposed || revision !== token) return
          const byteSize = Number(file && file.size) || 0
          if (byteSize > (opts.maxBytes || 12 * 1024 * 1024)) {
            if (opts.onError) opts.onError(file, 'too-large', replacementId)
            return
          }
          try {
            if (!file || typeof file.arrayBuffer !== 'function') throw new Error('read-unavailable')
            const buffer = await file.arrayBuffer()
            if (disposed || revision !== token) return
            const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
            await opts.accept({ file, text, byteSize, replacementId })
          } catch (error) {
            if (!disposed && revision === token && opts.onError) {
              opts.onError(file, error && error.message ? String(error.message) : 'read-failed', replacementId)
            }
          }
        }).finally(() => {
          pending -= 1
          if (!disposed && pending === 0 && opts.onIdle) opts.onIdle()
        })
      }
      return tail
    },
    get pending() { return pending },
    invalidate() { revision += 1 },
    dispose() { disposed = true; revision += 1 },
    whenIdle() { return tail },
  }
}
