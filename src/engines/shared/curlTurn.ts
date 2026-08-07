import type { PageTurnMode } from '@/types'
import { runDualLayerCurl } from '@/utils/pageCurl'
import { runDualLayerSlide } from '@/utils/pageSlide'
import { resolveTurnAnim, resolveTurnProfile, type TurnProfile } from '@/utils/turnProfile'

/**
 * Shared page-turn animation gate for TXT / PDF / EPUB.
 * - scroll: no chrome animation
 * - slide / curl / lite-curl: dual-layer (EPUB = ghost-only inside utils)
 * Never skip animation for EPUB — only avoid transforming the live surface.
 */
export function createCurlGate() {
  let busy = false

  async function run(
    pageTurn: PageTurnMode,
    container: HTMLElement | null | undefined,
    dir: 'next' | 'prev',
    action: () => void | Promise<void>,
    profile?: TurnProfile | null,
  ): Promise<void> {
    const p = profile ?? resolveTurnProfile()
    const anim = resolveTurnAnim(pageTurn, p)

    if (anim === 'none') {
      await action()
      return
    }
    if (busy) return
    busy = true
    const el = container ?? null
    try {
      // lite-curl: reliable horizontal transition on phone/tablet/coarse (avoid heavy 3D)
      if (anim === 'slide' || anim === 'lite-curl') {
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
