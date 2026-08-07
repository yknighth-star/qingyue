/** 仿真翻页：双层视口 — 旧页幽灵翻折，新页在下层始终可读 */

import { buildViewportGhost } from '@/utils/pageSlide'

const CURL_CLASSES = [
  'curl-out-next',
  'curl-out-prev',
  'curl-in-next',
  'curl-in-prev',
  'curl-hold',
] as const

/** 对齐市面阅读器：整段约 0.7s */
const OUT_MS = 380
const IN_MS = 300

function wait(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms))
}

function frames(n = 2) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve()
      else requestAnimationFrame(() => step(left - 1))
    }
    step(n)
  })
}

/**
 * Capture current viewport as a curling ghost, swap to the next page underneath,
 * then fold the ghost away — reading surface never blanks.
 */
export async function runDualLayerCurl(
  surface: HTMLElement | null,
  dir: 'next' | 'prev',
  swap: () => void | Promise<void>,
): Promise<void> {
  if (!surface) {
    await swap()
    return
  }

  const host = surface.parentElement || surface
  const prevHostOverflow = host.style.overflow
  const prevHostPerspective = host.style.perspective
  host.style.overflow = 'hidden'
  if (!getComputedStyle(host).perspective || getComputedStyle(host).perspective === 'none') {
    host.style.perspective = '2200px'
  }

  const ghost = buildViewportGhost(surface)
  ghost.classList.add('page-curl-ghost')
  const sRect = surface.getBoundingClientRect()
  const hRect = host.getBoundingClientRect()
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${sRect.left - hRect.left}px`,
    top: `${sRect.top - hRect.top}px`,
    width: `${sRect.width}px`,
    height: `${sRect.height}px`,
    zIndex: '8',
    transformStyle: 'preserve-3d',
    backfaceVisibility: 'hidden',
    willChange: 'transform, filter, opacity, box-shadow',
  })
  host.appendChild(ghost)

  const prevSurfaceTransition = surface.style.transition
  const prevSurfaceTransform = surface.style.transform
  const prevSurfaceFilter = surface.style.filter
  const prevSurfaceWillChange = surface.style.willChange
  const prevSurfaceZ = surface.style.zIndex
  const prevSurfaceOrigin = surface.style.transformOrigin

  try {
    await swap()
    await frames(2)

    const isEpub = surface.classList.contains('epub-reader')

    // EPUB: only curl the ghost — transforming the live surface breaks column layout
    surface.style.zIndex = '6'
    if (!isEpub) {
      surface.style.willChange = 'transform, filter'
      surface.classList.remove(...CURL_CLASSES)
      void surface.offsetWidth
      surface.classList.add(dir === 'next' ? 'curl-under-next' : 'curl-under-prev')
    }

    ghost.classList.add(dir === 'next' ? 'curl-out-next' : 'curl-out-prev')

    await wait(OUT_MS)
    if (!isEpub) await wait(Math.max(0, IN_MS - 80))
  } finally {
    ghost.remove()
    surface.classList.remove('curl-under-next', 'curl-under-prev', ...CURL_CLASSES)
    surface.style.transition = prevSurfaceTransition
    surface.style.transform = prevSurfaceTransform
    surface.style.filter = prevSurfaceFilter
    surface.style.willChange = prevSurfaceWillChange
    surface.style.zIndex = prevSurfaceZ
    surface.style.transformOrigin = prevSurfaceOrigin
    host.style.overflow = prevHostOverflow
    host.style.perspective = prevHostPerspective
  }
}

/* Legacy single-layer helpers (unused by gate; kept for safety) */
export async function playCurlOut(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove(...CURL_CLASSES)
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'curl-out-next' : 'curl-out-prev')
  await wait(OUT_MS)
  el.classList.add('curl-hold')
  el.classList.remove('curl-out-next', 'curl-out-prev')
}

export async function playCurlIn(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove('curl-hold', 'curl-out-next', 'curl-out-prev', 'curl-in-next', 'curl-in-prev')
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'curl-in-next' : 'curl-in-prev')
  await wait(IN_MS)
  el.classList.remove(...CURL_CLASSES)
}
