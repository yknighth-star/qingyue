import type { PageTurnMode } from '@/types'
import { runDualLayerCurl, runDualLayerLiteCurl } from '@/utils/pageCurl'
import { runEpubSoftTurn } from '@/utils/pageEpubTurn'
import { runDualLayerSlide } from '@/utils/pageSlide'
import { resolveTurnAnim, resolveTurnProfile, type TurnProfile } from '@/utils/turnProfile'

/**
 * Shared page-turn animation gate for TXT / PDF / EPUB.
 * - scroll: no chrome animation
 * - slide: dual-layer translate
 * - lite-curl / curl: peel animations (never silently equal to slide)
 * - EPUB: dual-buffer peel/slide (front text plate; live surface hidden during swap)
 */
export function createCurlGate() {
  let busy = false
  const listeners = new Set<(busy: boolean) => void>()

  function setBusy(next: boolean) {
    busy = next
    listeners.forEach((fn) => fn(busy))
  }

  function onBusyChange(cb: (busy: boolean) => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function isBusy() {
    return busy
  }

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
    setBusy(true)
    const el = container ?? null
    try {
      const isEpub = !!el?.classList.contains('epub-reader')
      if (isEpub) {
        const skin = anim === 'slide' ? 'slide' : 'curl'
        await runEpubSoftTurn(el, dir, action, skin)
        return
      }
      if (anim === 'slide') {
        await runDualLayerSlide(el, dir, action)
      } else if (anim === 'lite-curl') {
        await runDualLayerLiteCurl(el, dir, action)
      } else {
        await runDualLayerCurl(el, dir, action)
      }
    } finally {
      setBusy(false)
    }
  }

  return { run, isBusy, onBusyChange }
}
