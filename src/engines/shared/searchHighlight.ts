import { clearSearchMarks, highlightSearchInRoot } from '@/utils/domHighlight'

/** Active search-query state + DOM highlight helpers shared by engines. */
export function createSearchHighlightState() {
  let query: string | null = null

  function set(next: string | null): string | null {
    query = next?.trim() || null
    return query
  }

  function get(): string | null {
    return query
  }

  function applyRoot(root: HTMLElement | null | undefined, scrollIntoView = true) {
    if (!root) return
    if (!query) {
      clearSearchMarks(root)
      return
    }
    highlightSearchInRoot(root, query, scrollIntoView)
  }

  function clearRoot(root: HTMLElement | null | undefined) {
    clearSearchMarks(root)
  }

  function applyRoots(roots: Iterable<Element>, scrollIntoView = true) {
    if (!query) {
      for (const el of roots) clearSearchMarks(el as HTMLElement)
      return
    }
    for (const el of roots) {
      const node = el as HTMLElement
      if (node.innerText?.trim()) highlightSearchInRoot(node, query, scrollIntoView)
    }
  }

  return { set, get, applyRoot, clearRoot, applyRoots }
}
