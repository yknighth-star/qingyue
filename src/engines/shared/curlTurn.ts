import type { PageTurnMode } from '@/types'
import { runDualLayerCurl, runDualLayerLiteCurl } from '@/utils/pageCurl'
import { runDualLayerSlide } from '@/utils/pageSlide'
import { resolveTurnAnim, resolveTurnProfile, type TurnProfile } from '@/utils/turnProfile'

/**
 * Shared page-turn animation gate for TXT / PDF / EPUB.
 * - scroll: no chrome animation
 * - slide/curl: dual-layer for TXT/PDF
 * - EPUB: plain swap (coalescing lives in EpubEngine — never drop rapid input)
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
    const el = container ?? null
    const isEpub = !!el?.classList.contains('epub-reader')

    if (anim === 'none' || isEpub) {
      await action()
      return
    }

    if (busy) return
    setBusy(true)
    const safety = window.setTimeout(() => {
      if (busy) setBusy(false)
    }, 5000)
    try {
      if (anim === 'slide') {
        await runDualLayerSlide(el, dir, action)
      } else if (anim === 'lite-curl') {
        await runDualLayerLiteCurl(el, dir, action)
      } else {
        await runDualLayerCurl(el, dir, action)
      }
    } finally {
      window.clearTimeout(safety)
      setBusy(false)
    }
  }

  return { run, isBusy, onBusyChange }
}
