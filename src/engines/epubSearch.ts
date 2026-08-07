import type { Book } from 'epubjs'
import type { SearchHit } from '@/types'
import { indexOfIgnoreCase } from '@/utils/searchText'
import type { SearchOptions } from './types'

type SpineSection = {
  href: string
  index: number
  document?: Document
  load: (req?: (url: string) => Promise<Document>) => Promise<Element>
  unload: () => void
}

const MAX_HITS = 40
/** Parallel chapter loads — enough throughput without pegging memory on large spines. */
const CONCURRENCY = 3

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new DOMException('Search aborted', 'AbortError')
    throw err
  }
}

/**
 * Search EPUB spine text with abort + bounded concurrency + progressive onHits.
 */
export async function searchEpubBook(
  book: Book,
  query: string,
  opts?: SearchOptions,
): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []

  const signal = opts?.signal
  throwIfAborted(signal)

  const hits: SearchHit[] = []
  const request = book.load.bind(book) as (url: string) => Promise<Document>
  const spine = book.spine as unknown as { each: (cb: (item: SpineSection) => void) => void }
  const items: SpineSection[] = []
  spine.each((item) => items.push(item))

  let nextIndex = 0

  async function worker() {
    while (true) {
      throwIfAborted(signal)
      if (hits.length >= MAX_HITS) return
      const i = nextIndex++
      if (i >= items.length) return
      const item = items[i]
      try {
        const root = await item.load(request)
        throwIfAborted(signal)
        const text =
          root?.textContent ||
          item.document?.body?.textContent ||
          item.document?.documentElement?.textContent ||
          ''
        if (text) {
          let idx = 0
          while (hits.length < MAX_HITS) {
            const found = indexOfIgnoreCase(text, q, idx)
            if (found < 0) break
            hits.push({
              snippet: `…${text.slice(Math.max(0, found - 16), found + q.length + 16)}…`,
              locator: { type: 'epub', spineIndex: item.index, href: item.href },
            })
            idx = found + Math.max(1, q.length)
          }
          opts?.onHits?.([...hits])
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        console.warn('epub search chapter failed', item.href, err)
      } finally {
        try {
          item.unload()
        } catch {
          /* */
        }
      }
      opts?.onSearchProgress?.({
        page: Math.min(items.length, i + 1),
        total: items.length,
      })
    }
  }

  const pool = Math.min(CONCURRENCY, Math.max(1, items.length))
  await Promise.all(Array.from({ length: pool }, () => worker()))
  throwIfAborted(signal)
  return hits.slice(0, MAX_HITS)
}
