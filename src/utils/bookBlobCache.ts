/**
 * Short-lived strong cache of book Blobs so "import → open" and rapid re-open
 * skip a second full IDB/FS read. Cap + TTL keep phone memory bounded.
 */

const MAX_ENTRIES = 3
const TTL_MS = 5 * 60 * 1000

type Entry = { blob: Blob; at: number }

const cache = new Map<string, Entry>()

function prune() {
  const now = Date.now()
  for (const [id, row] of cache) {
    if (now - row.at > TTL_MS) cache.delete(id)
  }
  while (cache.size > MAX_ENTRIES) {
    let oldestId: string | null = null
    let oldestAt = Infinity
    for (const [id, row] of cache) {
      if (row.at < oldestAt) {
        oldestAt = row.at
        oldestId = id
      }
    }
    if (!oldestId) break
    cache.delete(oldestId)
  }
}

export function rememberBookBlob(id: string, blob: Blob) {
  if (!id || !blob) return
  cache.set(id, { blob, at: Date.now() })
  prune()
}

export function peekBookBlob(id: string): Blob | null {
  const row = cache.get(id)
  if (!row) return null
  if (Date.now() - row.at > TTL_MS) {
    cache.delete(id)
    return null
  }
  row.at = Date.now()
  return row.blob
}

export function forgetBookBlob(id: string) {
  cache.delete(id)
}

export function clearBookBlobCache() {
  cache.clear()
}
