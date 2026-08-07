import type { PageTurnMode } from '@/types'
import { runDualLayerCurl } from '@/utils/pageCurl'
import { runDualLayerSlide } from '@/utils/pageSlide'

/**
 * Shared page-turn animation gate for TXT / PDF / EPUB.
 * - scroll: no chrome animation
 * - slide/curl on TXT/PDF: dual-layer content transition
 * - slide/curl on EPUB: no dual-layer (iframe column layout breaks under ghost/transform)
 */
export function createCurlGate() {
  let busy = false

  async function run(
    pageTurn: PageTurnMode,
    container: HTMLElement | null | undefined,
    dir: 'next' | 'prev',
    action: () => void | Promise<void>,
  ): Promise<void> {
    if (pageTurn === 'scroll') {
      await action()
      return
    }
    if (busy) return
    busy = true
    const el = container ?? null
    try {
      // EPUB paginated flow must not be cloned/transformed — epub.js owns paging.
      if (el?.classList.contains('epub-reader')) {
        await action()
        return
      }
      if (pageTurn === 'slide') {
        await runDualLayerSlide(el, dir, action)
      } else {
        await runDualLayerCurl(el, dir, action)
      }
    } finally {
      busy = false
    }
  }

  return { run }
}
