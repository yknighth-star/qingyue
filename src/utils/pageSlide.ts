/** Dual-layer horizontal page slide — current viewport and next page move together. */

const SLIDE_MS = 320
const SLIDE_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)'

const LAYOUT_STYLE_PROPS = [
  'column-width',
  'column-gap',
  'column-count',
  'column-fill',
  'column-rule',
  '-webkit-column-width',
  '-webkit-column-gap',
  '-webkit-column-count',
  '-webkit-column-fill',
  '-moz-column-width',
  '-moz-column-gap',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'box-sizing',
  'overflow',
  'overflow-x',
  'overflow-y',
  'writing-mode',
  'direction',
  'font-size',
  'font-family',
  'line-height',
  'color',
  'background-color',
  'text-indent',
  'word-break',
  'overflow-wrap',
] as const

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

function copyCanvases(srcRoot: HTMLElement, dstRoot: HTMLElement) {
  const src = srcRoot.querySelectorAll('canvas')
  const dst = dstRoot.querySelectorAll('canvas')
  src.forEach((sc, i) => {
    const dc = dst[i]
    if (!(dc instanceof HTMLCanvasElement) || !(sc instanceof HTMLCanvasElement)) return
    dc.width = sc.width
    dc.height = sc.height
    dc.style.width = sc.style.width
    dc.style.height = sc.style.height
    const ctx = dc.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(sc, 0, 0)
    } catch {
      /* tainted / empty */
    }
  })
}

function transferLayoutStyles(from: Element, to: HTMLElement) {
  const cs = getComputedStyle(from)
  for (const prop of LAYOUT_STYLE_PROPS) {
    const v = cs.getPropertyValue(prop)
    if (v) to.style.setProperty(prop, v)
  }
}

/**
 * Snapshot an EPUB/PDF iframe so the visible column page matches the live view.
 * Keep styles in the light DOM (brief lifetime under the turn plate). Selector
 * rewriting / Shadow DOM broke CSS columns and produced blank green/black peels.
 */
function iframeToSnapshot(iframe: HTMLIFrameElement): HTMLElement {
  const shell = document.createElement('div')
  const w = iframe.offsetWidth || iframe.clientWidth
  const h = iframe.offsetHeight || iframe.clientHeight
  shell.className = 'page-slide-iframe-snap'
  shell.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;position:relative;pointer-events:none;box-sizing:border-box`

  const iframeCs = getComputedStyle(iframe)
  if (iframeCs.position && iframeCs.position !== 'static') {
    shell.style.position = iframeCs.position
  }
  ;(['top', 'left', 'right', 'bottom'] as const).forEach((p) => {
    const v = iframe.style[p]
    if (v) shell.style[p] = v
  })

  try {
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc?.body) {
      shell.style.background = iframeCs.backgroundColor || 'transparent'
      return shell
    }

    const readerBg =
      getComputedStyle(iframe.closest('.epub-reader') || document.documentElement)
        .getPropertyValue('--reader-bg')
        .trim() || '#f3ead3'
    const bodyBg = getComputedStyle(doc.body).backgroundColor
    const htmlBg = getComputedStyle(doc.documentElement).backgroundColor
    const bg =
      (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent' ? bodyBg : null) ||
      (htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent' ? htmlBg : null) ||
      readerBg
    shell.style.background = bg

    for (const st of Array.from(doc.head.querySelectorAll('style'))) {
      shell.appendChild(st.cloneNode(true))
    }
    for (const link of Array.from(doc.head.querySelectorAll('link[rel="stylesheet"]'))) {
      try {
        const sheet = (link as HTMLLinkElement).sheet
        if (!sheet) continue
        const style = document.createElement('style')
        let css = ''
        for (const rule of Array.from(sheet.cssRules)) css += `${rule.cssText}\n`
        style.textContent = css
        shell.appendChild(style)
      } catch {
        /* cross-origin stylesheet */
      }
    }

    const layoutRoot = document.createElement('div')
    layoutRoot.className = 'page-slide-iframe-layout'
    transferLayoutStyles(doc.documentElement, layoutRoot)
    const htmlCs = getComputedStyle(doc.documentElement)
    layoutRoot.style.width = htmlCs.width || `${w}px`
    layoutRoot.style.height = htmlCs.height || `${h}px`

    const body = doc.body.cloneNode(true) as HTMLElement
    body.querySelectorAll('script').forEach((s) => s.remove())
    transferLayoutStyles(doc.body, body)
    layoutRoot.appendChild(body)

    const scrollX = win?.scrollX ?? doc.documentElement.scrollLeft ?? doc.body.scrollLeft ?? 0
    const scrollY = win?.scrollY ?? doc.documentElement.scrollTop ?? doc.body.scrollTop ?? 0
    if (scrollX || scrollY) {
      layoutRoot.style.transform = `translate3d(${-scrollX}px, ${-scrollY}px, 0)`
    }

    shell.appendChild(layoutRoot)
  } catch {
    shell.style.background = 'var(--reader-bg, #f3ead3)'
  }
  return shell
}

function snapshotIframes(srcRoot: HTMLElement, dstRoot: HTMLElement) {
  const src = srcRoot.querySelectorAll('iframe')
  const dst = dstRoot.querySelectorAll('iframe')
  src.forEach((si, i) => {
    const di = dst[i]
    if (!di) return
    di.replaceWith(iframeToSnapshot(si))
  })
}

function findScrollRoot(surface: HTMLElement): HTMLElement {
  return (
    (surface.querySelector('.pdf-pages, .txt-content, .epub-container') as HTMLElement | null) ||
    surface
  )
}

/**
 * EPUB: clip by .epub-container scrollLeft (paginated pages are horizontal).
 * Prefer full-column clone + snapped translate (readable text) over viewport-only
 * snapshots (those often paint blank/black peels).
 */
function buildEpubViewportGhost(surface: HTMLElement, container: HTMLElement): HTMLElement {
  const w = surface.clientWidth
  const h = surface.clientHeight
  const cs = getComputedStyle(surface)
  const bg = cs.backgroundColor || 'var(--reader-bg, #f3ead3)'

  const pageW = container.clientWidth
  let scrollLeft = container.scrollLeft
  let scrollTop = container.scrollTop
  if (pageW >= 8) {
    const snapped = Math.round(scrollLeft / pageW) * pageW
    if (Math.abs(scrollLeft - snapped) >= 0.5) {
      container.scrollLeft = snapped
      scrollLeft = snapped
    }
  }
  scrollLeft = Math.round(scrollLeft)
  scrollTop = Math.round(scrollTop)

  const ghost = document.createElement('div')
  ghost.className = 'page-slide-ghost page-slide-ghost-epub'
  Object.assign(ghost.style, {
    background: bg,
    overflow: 'hidden',
    width: `${w}px`,
    height: `${h}px`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
    position: 'relative',
    contain: 'paint',
  })

  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script').forEach((s) => s.remove())
  copyCanvases(container, clone)
  snapshotIframes(container, clone)

  const sRect = surface.getBoundingClientRect()
  const cRect = container.getBoundingClientRect()
  Object.assign(clone.style, {
    position: 'absolute',
    left: `${cRect.left - sRect.left}px`,
    top: `${cRect.top - sRect.top}px`,
    width: `${Math.max(container.scrollWidth, container.clientWidth)}px`,
    height: `${Math.max(container.scrollHeight, container.clientHeight)}px`,
    margin: '0',
    overflow: 'hidden',
    transform: `translate3d(${-scrollLeft}px, ${-scrollTop}px, 0)`,
    willChange: 'auto',
  })
  ghost.appendChild(clone)

  // Soft edge masks hide residual adjacent-column fringe without blanking the page.
  const maskW = 2
  for (const side of ['left', 'right'] as const) {
    const mask = document.createElement('div')
    mask.className = 'page-slide-ghost-edge'
    Object.assign(mask.style, {
      position: 'absolute',
      top: '0',
      bottom: '0',
      [side]: '0',
      width: `${maskW}px`,
      background: bg,
      pointerEvents: 'none',
      zIndex: '2',
    })
    ghost.appendChild(mask)
  }

  return ghost
}

/** Build a clipped clone of whatever is currently visible in the reading surface. */
export function buildViewportGhost(surface: HTMLElement): HTMLElement {
  const epubContainer = surface.querySelector('.epub-container') as HTMLElement | null
  if (epubContainer && surface.querySelector('iframe')) {
    return buildEpubViewportGhost(surface, epubContainer)
  }

  const w = surface.clientWidth
  const h = surface.clientHeight
  const ghost = document.createElement('div')
  ghost.className = 'page-slide-ghost'
  const cs = getComputedStyle(surface)
  ghost.style.background = cs.backgroundColor || 'var(--reader-bg, #f3ead3)'
  ghost.style.overflow = 'hidden'
  ghost.style.width = `${w}px`
  ghost.style.height = `${h}px`
  ghost.style.boxSizing = 'border-box'
  ghost.style.pointerEvents = 'none'

  const scrollRoot = findScrollRoot(surface)

  const clone = scrollRoot.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script').forEach((s) => s.remove())
  copyCanvases(scrollRoot, clone)
  snapshotIframes(scrollRoot, clone)

  const sRect = surface.getBoundingClientRect()
  const rRect = scrollRoot.getBoundingClientRect()
  Object.assign(clone.style, {
    position: 'absolute',
    left: `${rRect.left - sRect.left}px`,
    top: `${rRect.top - sRect.top}px`,
    width: `${scrollRoot.clientWidth}px`,
    margin: '0',
    transform: `translate3d(${-scrollRoot.scrollLeft}px, ${-scrollRoot.scrollTop}px, 0)`,
    overflow: 'visible',
    willChange: 'auto',
  })
  ghost.style.position = 'relative'
  ghost.appendChild(clone)
  return ghost
}

/**
 * Capture the current viewport as a ghost layer, run `swap` to reveal the next page,
 * then slide ghost out while the live surface slides in — content stays readable.
 */
export async function runDualLayerSlide(
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
  host.style.overflow = 'hidden'

  const ghost = buildViewportGhost(surface)
  const sRect = surface.getBoundingClientRect()
  const hRect = host.getBoundingClientRect()
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${sRect.left - hRect.left}px`,
    top: `${sRect.top - hRect.top}px`,
    width: `${sRect.width}px`,
    height: `${sRect.height}px`,
    zIndex: '7',
    transition: 'none',
    transform: 'translate3d(0,0,0)',
    willChange: 'transform',
  })
  host.appendChild(ghost)

  const prevSurfaceTransition = surface.style.transition
  const prevSurfaceTransform = surface.style.transform
  const prevSurfaceWillChange = surface.style.willChange
  const prevSurfaceZ = surface.style.zIndex

  try {
    await swap()
    await frames(2)

    const from = dir === 'next' ? '100%' : '-100%'
    const out = dir === 'next' ? '-100%' : '100%'

    // EPUB: never translate the live surface — transform on .epub-reader breaks
    // epub.js column metrics / scrollLeft alignment. Only the ghost moves.
    const isEpub = surface.classList.contains('epub-reader')

    surface.style.zIndex = '6'
    if (!isEpub) {
      surface.style.willChange = 'transform'
      surface.style.transition = 'none'
      surface.style.transform = `translate3d(${from},0,0)`
    }
    ghost.style.transition = 'none'
    ghost.style.transform = 'translate3d(0,0,0)'

    await frames(2)

    ghost.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`
    ghost.style.transform = `translate3d(${out},0,0)`
    if (!isEpub) {
      surface.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`
      surface.style.transform = 'translate3d(0,0,0)'
    }

    await wait(SLIDE_MS + 24)
  } finally {
    ghost.remove()
    surface.style.transition = prevSurfaceTransition
    surface.style.transform = prevSurfaceTransform
    surface.style.willChange = prevSurfaceWillChange
    surface.style.zIndex = prevSurfaceZ
    host.style.overflow = prevHostOverflow
  }
}

/* Legacy class-based helpers kept for any residual callers */
const SLIDE_CLASSES = [
  'slide-out-next',
  'slide-out-prev',
  'slide-in-next',
  'slide-in-prev',
  'slide-hold',
] as const

const OUT_MS = 240
const IN_MS = 240

export async function playSlideOut(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove(...SLIDE_CLASSES)
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'slide-out-next' : 'slide-out-prev')
  await wait(OUT_MS)
  el.classList.add('slide-hold')
  el.classList.remove('slide-out-next', 'slide-out-prev')
}

export async function playSlideIn(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove('slide-hold', 'slide-out-next', 'slide-out-prev', 'slide-in-next', 'slide-in-prev')
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'slide-in-next' : 'slide-in-prev')
  await wait(IN_MS)
  el.classList.remove(...SLIDE_CLASSES)
}
