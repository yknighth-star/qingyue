import { indexOfIgnoreCase } from '@/utils/searchText'

/** Remove temporary search-hit marks and normalize text nodes. */
export function clearSearchMarks(root: ParentNode | null | undefined) {
  if (!root) return
  root.querySelectorAll('mark.search-hit').forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

/**
 * Wrap all case-insensitive matches of `query` in <mark class="search-hit">.
 * Returns the first mark (scrolled into view when scroll=true).
 */
export function highlightSearchInRoot(
  root: HTMLElement | null | undefined,
  query: string,
  scroll = true,
): HTMLElement | null {
  if (!root) return null
  clearSearchMarks(root)
  const q = query.trim()
  if (!q) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      if (el.closest('mark.search-hit, mark.annot, script, style')) return NodeFilter.FILTER_REJECT
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) textNodes.push(cur as Text)

  let first: HTMLElement | null = null
  for (const textNode of textNodes) {
    const value = textNode.nodeValue || ''
    const lower = value.toLocaleLowerCase()
    const needle = q.toLocaleLowerCase()
    if (!lower.includes(needle)) continue

    const frag = document.createDocumentFragment()
    let last = 0
    let idx = lower.indexOf(needle)
    while (idx >= 0) {
      if (idx > last) frag.appendChild(document.createTextNode(value.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = 'search-hit'
      mark.textContent = value.slice(idx, idx + q.length)
      frag.appendChild(mark)
      if (!first) first = mark
      last = idx + q.length
      idx = lower.indexOf(needle, last)
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }

  if (scroll && first) {
    try {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* */
    }
  }
  return first
}

/** Escape HTML then wrap query matches with <mark class="search-hit-snip"> for panel snippets. */
export function markQueryInSnippet(snippet: string, query: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const q = query.trim()
  if (!q) return escape(snippet)

  let out = ''
  let from = 0
  while (from < snippet.length) {
    const found = indexOfIgnoreCase(snippet, q, from)
    if (found < 0) {
      out += escape(snippet.slice(from))
      break
    }
    out += escape(snippet.slice(from, found))
    out += `<mark class="search-hit-snip">${escape(snippet.slice(found, found + q.length))}</mark>`
    from = found + Math.max(1, q.length)
  }
  return out
}
