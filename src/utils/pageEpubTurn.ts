/**
 * EPUB dual-buffer turn with a srcdoc iframe front plate.
 * DOM-into-div clones break CSS columns → blank green/black peels.
 * srcdoc restores a real html/body document so columns + fonts paint.
 *
 * Critical: never move a loaded srcdoc iframe in the DOM — browsers reload it
 * and the plate goes blank. Mount the paper in its final host, then set srcdoc.
 */

const SLIDE_MS = 280
const CURL_MS = 380
const SLIDE_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)'
const CURL_EASE = 'cubic-bezier(0.4, 0.0, 0.55, 1)'

export type EpubTurnSkin = 'slide' | 'curl'

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

export function resolveReaderBg(el: HTMLElement): string {
  const fromVar = getComputedStyle(el).getPropertyValue('--reader-bg').trim()
  if (fromVar) return fromVar
  const c = getComputedStyle(el).backgroundColor
  if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
  return '#f3ead3'
}

const styleCache = new WeakMap<Document, string>()

function collectHeadStyles(doc: Document): string {
  const cached = styleCache.get(doc)
  if (cached != null) return cached

  const parts: string[] = []
  const pushCss = (css: string) => {
    // Prevent </style><script> breakout from EPUB stylesheet text.
    const safe = css.replace(/<\/style/gi, '<\\/style')
    parts.push(`<style>${safe}</style>`)
  }
  for (const st of Array.from(doc.head.querySelectorAll('style'))) {
    try {
      const sheet = st.sheet
      if (sheet) {
        let css = ''
        for (const rule of Array.from(sheet.cssRules)) css += `${rule.cssText}\n`
        if (css) {
          pushCss(css)
          continue
        }
      }
    } catch {
      /* */
    }
    pushCss(st.textContent || '')
  }
  for (const link of Array.from(doc.head.querySelectorAll('link[rel="stylesheet"]'))) {
    try {
      const sheet = (link as HTMLLinkElement).sheet
      if (!sheet) continue
      let css = ''
      for (const rule of Array.from(sheet.cssRules)) css += `${rule.cssText}\n`
      pushCss(css)
    } catch {
      /* cross-origin */
    }
  }
  const out = parts.join('\n')
  styleCache.set(doc, out)
  return out
}

function cssEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Static plate only — drop executable nodes so sandbox without allow-scripts stays quiet. */
function sanitizePlateBodyHtml(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, noscript, template, iframe, object, embed, link[rel="import"]').forEach((n) => n.remove())
  for (const el of Array.from(clone.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }
  return clone.innerHTML
}

function buildSrcdoc(doc: Document, pageW: number, pageH: number, fullW: number, bg: string): string | null {
  const bodyCs = getComputedStyle(doc.body)
  const head = collectHeadStyles(doc)
  const bodyHtml = sanitizePlateBodyHtml(doc.body)
  const colWidth = bodyCs.columnWidth && bodyCs.columnWidth !== 'auto' ? bodyCs.columnWidth : `${pageW}px`
  const colGap = bodyCs.columnGap && bodyCs.columnGap !== 'normal' ? bodyCs.columnGap : '0px'
  const colFill = bodyCs.columnFill || 'auto'

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'"/>
${head}
<style>
html {
  margin: 0 !important;
  padding: 0 !important;
  width: ${fullW}px !important;
  height: ${pageH}px !important;
  overflow: hidden !important;
  background: ${cssEscape(bg)} !important;
}
body {
  margin: 0 !important;
  padding: 0 !important;
  width: ${fullW}px !important;
  height: ${pageH}px !important;
  background: ${cssEscape(bg)} !important;
  color: ${cssEscape(bodyCs.color || '#222')} !important;
  font-family: ${cssEscape(bodyCs.fontFamily || 'sans-serif')} !important;
  font-size: ${cssEscape(bodyCs.fontSize || '16px')} !important;
  line-height: ${cssEscape(bodyCs.lineHeight || '1.6')} !important;
  overflow: hidden !important;
  column-width: ${cssEscape(colWidth)} !important;
  column-gap: ${cssEscape(colGap)} !important;
  column-fill: ${cssEscape(colFill)} !important;
  -webkit-column-width: ${cssEscape(colWidth)} !important;
  -webkit-column-gap: ${cssEscape(colGap)} !important;
  box-sizing: border-box !important;
}
</style></head><body>${bodyHtml}</body></html>`
}

function waitFrameSrcdoc(frame: HTMLIFrameElement, srcdoc: string, timeoutMs = 3000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(() => reject(new Error('epub plate srcdoc timeout')), timeoutMs)
    frame.addEventListener('load', finish)
    frame.srcdoc = srcdoc
    // Prefer load event; only fall back if already parsed (microtask, not 50ms sleep).
    queueMicrotask(() => {
      try {
        if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body?.childNodes?.length) {
          finish()
        }
      } catch {
        /* */
      }
    })
  })
}

/**
 * Mount a viewport-sized front paper (srcdoc iframe) into host.
 * Returns null when capture cannot produce readable text.
 * The iframe stays where it was mounted — do not reparent it.
 */
export async function mountEpubFrontPaper(
  surface: HTMLElement,
  host: HTMLElement,
  layout: { left: number; top: number; width: number; height: number },
  contentOffset: { left: number; top: number },
  dir: 'next' | 'prev',
  skin: EpubTurnSkin,
  bg: string,
): Promise<HTMLDivElement | null> {
  const container = surface.querySelector('.epub-container') as HTMLElement | null
  const iframe = surface.querySelector('iframe') as HTMLIFrameElement | null
  const doc = iframe?.contentDocument
  if (!container || !iframe || !doc?.body) return null

  const pageW = container.clientWidth
  const pageH = container.clientHeight
  if (pageW < 8 || pageH < 8) return null

  let scrollLeft = container.scrollLeft
  const snapped = Math.round(scrollLeft / pageW) * pageW
  if (Math.abs(scrollLeft - snapped) >= 0.5) {
    container.scrollLeft = snapped
    scrollLeft = snapped
  }

  const fullW = Math.max(iframe.offsetWidth || 0, iframe.clientWidth || 0, pageW)
  const srcdoc = buildSrcdoc(doc, pageW, pageH, fullW, bg)
  if (!srcdoc) return null

  const plate = document.createElement('div')
  plate.className = 'page-epub-turn-plate'
  Object.assign(plate.style, {
    position: 'absolute',
    left: `${contentOffset.left}px`,
    top: `${contentOffset.top}px`,
    width: `${pageW}px`,
    height: `${pageH}px`,
    overflow: 'hidden',
    background: bg,
    pointerEvents: 'none',
    boxSizing: 'border-box',
  })

  const frame = document.createElement('iframe')
  // Do not use sandbox: Chromium logs "Blocked script execution in about:srcdoc"
  // whenever sandbox lacks allow-scripts. Scripts are blocked via CSP + sanitize instead.
  frame.setAttribute('scrolling', 'no')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  Object.assign(frame.style, {
    width: `${fullW}px`,
    height: `${pageH}px`,
    border: '0',
    display: 'block',
    background: bg,
    transform: `translate3d(${-scrollLeft}px,0,0)`,
    pointerEvents: 'none',
  })
  plate.appendChild(frame)

  const wrap = document.createElement('div')
  wrap.className = `page-epub-turn-paper page-epub-turn-${dir}`
  Object.assign(wrap.style, {
    position: 'absolute',
    left: `${layout.left}px`,
    top: `${layout.top}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    zIndex: '20',
    overflow: 'hidden',
    pointerEvents: 'none',
    // Invisible while srcdoc loads — avoids a solid-cover hitch before the peel starts.
    visibility: 'hidden',
    transform: 'translate3d(0,0,0)',
    transformOrigin: dir === 'next' ? 'left center' : 'right center',
    willChange: 'transform, box-shadow',
    background: bg,
    boxShadow:
      skin === 'curl'
        ? dir === 'next'
          ? '-12px 0 28px rgba(0,0,0,0.16)'
          : '12px 0 28px rgba(0,0,0,0.16)'
        : dir === 'next'
          ? '-8px 0 20px rgba(0,0,0,0.1)'
          : '8px 0 20px rgba(0,0,0,0.1)',
  })
  wrap.appendChild(plate)

  // Mount first, then load srcdoc — moving a loaded iframe blanks it.
  host.appendChild(wrap)

  try {
    await waitFrameSrcdoc(frame, srcdoc)
    // One frame so the plate can paint before we reveal + animate.
    await frames(1)

    let textLen = 0
    try {
      textLen = (frame.contentDocument?.body?.textContent || '').replace(/\s+/g, '').length
    } catch {
      textLen = 0
    }
    if (textLen < 12) {
      wrap.remove()
      return null
    }
    wrap.style.visibility = 'visible'
    return wrap
  } catch (err) {
    wrap.remove()
    throw err
  }
}

/**
 * Cover the stage with a static srcdoc snapshot of the current page so epub.js
 * clear()→append→show chapter hops do not flash an empty container.
 * Returns a disposer; always call it (even if null).
 */
export async function mountEpubChapterHold(
  surface: HTMLElement,
): Promise<(() => void) | null> {
  const host = surface.parentElement
  if (!host) return null
  const container = surface.querySelector('.epub-container') as HTMLElement | null
  const iframe = surface.querySelector('iframe') as HTMLIFrameElement | null
  const doc = iframe?.contentDocument
  const bg = resolveReaderBg(surface)
  if (!container || !iframe || !doc?.body) {
    // Fallback: solid cover still hides the blank stage (better than empty blink).
    return mountSolidHold(host, surface, bg)
  }

  const pageW = container.clientWidth
  const pageH = container.clientHeight
  if (pageW < 8 || pageH < 8) return mountSolidHold(host, surface, bg)

  let scrollLeft = container.scrollLeft
  const snapped = Math.round(scrollLeft / pageW) * pageW
  if (Math.abs(scrollLeft - snapped) >= 0.5) {
    scrollLeft = snapped
  }

  const fullW = Math.max(iframe.offsetWidth || 0, iframe.clientWidth || 0, pageW)
  const srcdoc = buildSrcdoc(doc, pageW, pageH, fullW, bg)
  if (!srcdoc) return mountSolidHold(host, surface, bg)

  const sRect = surface.getBoundingClientRect()
  const hRect = host.getBoundingClientRect()
  const left = sRect.left - hRect.left
  const top = sRect.top - hRect.top

  const wrap = document.createElement('div')
  wrap.className = 'page-epub-chapter-hold'
  wrap.setAttribute('aria-hidden', 'true')
  Object.assign(wrap.style, {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${sRect.width}px`,
    height: `${sRect.height}px`,
    zIndex: '30',
    overflow: 'hidden',
    pointerEvents: 'none',
    background: bg,
    // Stay hidden until srcdoc paints — visible solid bg over illustrated pages = flash #1.
    visibility: 'hidden',
  })

  const plate = document.createElement('div')
  Object.assign(plate.style, {
    position: 'absolute',
    left: `${container.offsetLeft}px`,
    top: `${container.offsetTop}px`,
    width: `${pageW}px`,
    height: `${pageH}px`,
    overflow: 'hidden',
    background: bg,
  })

  const frame = document.createElement('iframe')
  frame.setAttribute('scrolling', 'no')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  Object.assign(frame.style, {
    width: `${fullW}px`,
    height: `${pageH}px`,
    border: '0',
    display: 'block',
    background: bg,
    transform: `translate3d(${-scrollLeft}px,0,0)`,
    pointerEvents: 'none',
  })
  plate.appendChild(frame)
  wrap.appendChild(plate)

  const prevPos = getComputedStyle(host).position
  if (prevPos === 'static') host.style.position = 'relative'
  host.appendChild(wrap)

  try {
    await waitFrameSrcdoc(frame, srcdoc, 1200)
    await frames(1)
    wrap.style.visibility = 'visible'
    // One more frame so the plate is composited before epub.js clear() runs underneath.
    await frames(1)
  } catch {
    // Fallback solid cover — still better than empty blink on clear().
    wrap.style.visibility = 'visible'
  }

  return () => {
    wrap.remove()
    if (prevPos === 'static') host.style.removeProperty('position')
  }
}

function mountSolidHold(
  host: HTMLElement,
  surface: HTMLElement,
  bg: string,
): () => void {
  const sRect = surface.getBoundingClientRect()
  const hRect = host.getBoundingClientRect()
  const wrap = document.createElement('div')
  wrap.className = 'page-epub-chapter-hold page-epub-chapter-hold-solid'
  wrap.setAttribute('aria-hidden', 'true')
  Object.assign(wrap.style, {
    position: 'absolute',
    left: `${sRect.left - hRect.left}px`,
    top: `${sRect.top - hRect.top}px`,
    width: `${sRect.width}px`,
    height: `${sRect.height}px`,
    zIndex: '30',
    pointerEvents: 'none',
    background: bg,
  })
  const prevPos = getComputedStyle(host).position
  if (prevPos === 'static') host.style.position = 'relative'
  host.appendChild(wrap)
  return () => {
    wrap.remove()
    if (prevPos === 'static') host.style.removeProperty('position')
  }
}


function animateFrontAway(
  paper: HTMLElement,
  dir: 'next' | 'prev',
  skin: EpubTurnSkin,
): Promise<void> {
  const ms = skin === 'curl' ? CURL_MS : SLIDE_MS
  const ease = skin === 'curl' ? CURL_EASE : SLIDE_EASE
  paper.style.transformOrigin = dir === 'next' ? 'left center' : 'right center'

  if (skin === 'curl') {
    paper.classList.add('page-epub-turn-curl', `page-epub-turn-${dir}`)
    const rot = dir === 'next' ? '-78deg' : '78deg'
    paper.style.transition = `transform ${ms}ms ${ease}, box-shadow ${ms}ms ${ease}`
    paper.style.transform = `perspective(1800px) rotateY(${rot})`
    paper.style.boxShadow =
      dir === 'next' ? '-24px 0 36px rgba(0,0,0,0.2)' : '24px 0 36px rgba(0,0,0,0.2)'
  } else {
    const out = dir === 'next' ? '-100%' : '100%'
    paper.style.transition = `transform ${ms}ms ${ease}`
    paper.style.transform = `translate3d(${out},0,0)`
  }
  return wait(ms + 24)
}

/**
 * Dual-buffer EPUB turn. Front must be a readable srcdoc plate; otherwise plain swap.
 */
export async function runEpubSoftTurn(
  surface: HTMLElement | null,
  dir: 'next' | 'prev',
  swap: () => void | Promise<void>,
  skin: EpubTurnSkin = 'slide',
): Promise<void> {
  if (!surface) {
    await swap()
    return
  }

  const host = surface.parentElement || surface
  const sRect = surface.getBoundingClientRect()
  const hRect = host.getBoundingClientRect()
  const layout = {
    left: sRect.left - hRect.left,
    top: sRect.top - hRect.top,
    width: sRect.width,
    height: sRect.height,
  }
  const bg = resolveReaderBg(surface)
  const container = surface.querySelector('.epub-container') as HTMLElement | null
  const cRect = container?.getBoundingClientRect()
  const contentOffset = {
    left: cRect ? cRect.left - sRect.left : 0,
    top: cRect ? cRect.top - sRect.top : 0,
  }

  const prevPerspective = host.style.perspective
  const prevHostOverflow = host.style.overflow
  const prevFilter = surface.style.filter
  host.style.overflow = 'hidden'
  surface.style.filter = ''
  if (skin === 'curl' && (!getComputedStyle(host).perspective || getComputedStyle(host).perspective === 'none')) {
    host.style.perspective = '1800px'
  }

  let front: HTMLElement | null = null
  try {
    front = await mountEpubFrontPaper(surface, host, layout, contentOffset, dir, skin, bg)
  } catch (err) {
    console.warn('epub front plate failed, plain swap', err)
  }

  if (!front) {
    host.style.perspective = prevPerspective
    host.style.overflow = prevHostOverflow
    surface.style.filter = prevFilter
    await swap()
    return
  }

  try {
    // Reveal + swap in the same turn; one rAF so the next page can paint under the peel.
    await swap()
    await frames(1)
    await animateFrontAway(front, dir, skin)
  } finally {
    front.remove()
    surface.style.filter = prevFilter
    host.style.perspective = prevPerspective
    host.style.overflow = prevHostOverflow
  }
}
