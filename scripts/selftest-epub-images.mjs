/**
 * Self-test: apply current reader theme + media constraints to a fake EPUB chapter
 * and assert <img>, SVG, and CSS-background figures stay visible (non-zero box).
 *
 * Run: node scripts/selftest-epub-images.mjs
 */
import { chromium } from 'playwright'

const THEME_BG = '#f3ead3'
const THEME_FG = '#3b2f2f'

/** Mirrors src/engines/epubEngine.ts applyThemeColorsToDocument stylesheet (current). */
function themeCssCurrent() {
  return `
html {
  color-scheme: light !important;
  background-color: ${THEME_BG} !important;
  background-image: none !important;
  color: ${THEME_FG} !important;
}
html body,
html body[class],
html body[style] {
  background-color: ${THEME_BG} !important;
  background-image: none !important;
  color: ${THEME_FG} !important;
}
html body :where(p, div, li, span, a, h1, h2, h3, h4, h5, h6, td, th, blockquote, em, strong, b, i, u, small, label, font, section, article) {
  color: ${THEME_FG} !important;
}
html body :where(img, svg, video, canvas, picture, object, embed, iframe) {
  background-color: transparent !important;
}
`.trim()
}

/** Safer theme CSS — no size rules on media. */
function themeCssSafe() {
  return `
html, html body {
  background-color: ${THEME_BG} !important;
  background-image: none !important;
  color: ${THEME_FG} !important;
}
html body :where(p, div, li, span, a, h1, h2, h3, h4, h5, h6, td, th, blockquote, section, article) {
  color: ${THEME_FG} !important;
}
`.trim()
}

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function chapterHtml(extraStyle = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body { margin: 0; }
  .cover-bg {
    width: 240px; height: 160px;
    background-image: url("${PNG_1X1}");
    background-size: cover;
  }
  ${extraStyle}
</style></head><body>
  <p>before</p>
  <img id="bitmap" src="${PNG_1X1}" width="320" height="200" alt="bitmap"/>
  <svg id="vector" width="200" height="120" viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
    <rect width="200" height="120" fill="#3d9b5f"/>
    <image href="${PNG_1X1}" x="20" y="20" width="80" height="80"/>
  </svg>
  <div id="cssbg" class="cover-bg"></div>
  <div id="wrap"><img id="nested" src="${PNG_1X1}" width="100" height="80" alt="nested"/></div>
  <p>after</p>
</body></html>`
}

async function measure(page, frame) {
  return frame.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return { sel, missing: true }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        sel,
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        bgImage: cs.backgroundImage?.slice(0, 40),
      }
    }
    return {
      bitmap: box('#bitmap'),
      vector: box('#vector'),
      cssbg: box('#cssbg'),
      nested: box('#nested'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
    }
  })
}

function applyContainOverflow(frame, mode) {
  return frame.evaluate((mode) => {
    if (mode === 'legacy') {
      document.querySelectorAll('img, svg, video, canvas').forEach((node) => {
        if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return
        node.style.setProperty('max-width', '100%', 'important')
        node.style.setProperty('height', 'auto', 'important')
        node.removeAttribute('width')
        node.removeAttribute('height')
      })
    } else if (mode === 'safe') {
      document.querySelectorAll('img, video, canvas, picture').forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        node.style.setProperty('max-width', '100%', 'important')
      })
      document.querySelectorAll('svg').forEach((node) => {
        if (!(node instanceof SVGElement)) return
        node.style.setProperty('max-width', '100%', 'important')
      })
    }
  }, mode)
}

function applyTheme(frame, css) {
  return frame.evaluate((css) => {
    let el = document.getElementById('qingyue-theme')
    if (!el) {
      el = document.createElement('style')
      el.id = 'qingyue-theme'
      document.documentElement.appendChild(el)
    }
    el.textContent = css
    document.documentElement.style.setProperty('background-color', '#f3ead3', 'important')
    document.body.style.setProperty('background-color', '#f3ead3', 'important')
    document.body.style.setProperty('background-image', 'none', 'important')
    document.body.style.setProperty('color', '#3b2f2f', 'important')
  }, css)
}

function paintWashes(frame) {
  return frame.evaluate(() => {
    const bg = '#f3ead3'
    const win = window
    const body = document.body
    const isMedia = (tag) =>
      ['img', 'svg', 'video', 'canvas', 'picture', 'object', 'embed', 'source', 'script', 'style', 'link'].includes(
        tag,
      )
    const hasUrlBackground = (el, cs) => {
      const inline = el.getAttribute('style') || ''
      if (/background(-image)?\s*:[^;]*url\(/i.test(inline)) return true
      const bi = cs.backgroundImage
      return !!bi && bi !== 'none' && /url\(/i.test(bi)
    }
    const isTransparent = (color) =>
      !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || color === 'rgba(0,0,0,0)'
    const walk = (el, depth) => {
      if (depth > 6) return
      const tag = el.tagName.toLowerCase()
      if (isMedia(tag)) return
      let cs
      try {
        cs = win.getComputedStyle(el)
      } catch {
        return
      }
      if (hasUrlBackground(el, cs)) return
      const kids = Array.from(el.children).filter((n) => n instanceof HTMLElement)
      if (kids.length > 0 && kids.every((k) => isMedia(k.tagName.toLowerCase()) || k.tagName.toLowerCase() === 'br')) {
        el.style.setProperty('background-color', 'transparent', 'important')
        return
      }
      if (!isTransparent(cs.backgroundColor)) {
        el.style.setProperty('background-color', bg, 'important')
      }
      for (const child of kids) walk(child, depth + 1)
    }
    for (const child of Array.from(body.children)) {
      if (child instanceof HTMLElement) walk(child, 0)
    }
  })
}

function assertVisible(label, m) {
  const fails = []
  for (const key of ['bitmap', 'vector', 'cssbg', 'nested']) {
    const b = m[key]
    if (!b || b.missing || b.w < 2 || b.h < 2) {
      fails.push(`${key}=${JSON.stringify(b)}`)
    }
  }
  if (fails.length) {
    console.error(`FAIL ${label}:`, fails.join(' | '))
    return false
  }
  console.log(
    `PASS ${label}: bitmap ${m.bitmap.w}x${m.bitmap.h}, svg ${m.vector.w}x${m.vector.h}, cssbg ${m.cssbg.w}x${m.cssbg.h}, bodyBg=${m.bodyBg}`,
  )
  return true
}

async function runCase(browser, name, { themeCss, containMode, washes }) {
  const page = await browser.newPage()
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
    <iframe id="f" style="width:400px;height:600px;border:0"></iframe>
  </body></html>`)
  const frameEl = await page.$('#f')
  const frame = await frameEl.contentFrame()
  await frame.setContent(chapterHtml())
  // wait images
  await frame.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r })))))

  const before = await measure(page, frame)
  if (!assertVisible(`${name}/before`, before)) {
    await page.close()
    return false
  }

  if (themeCss) await applyTheme(frame, themeCss)
  if (containMode) await applyContainOverflow(frame, containMode)
  if (washes) await paintWashes(frame)

  await page.waitForTimeout(50)
  const after = await measure(page, frame)
  const ok = assertVisible(`${name}/after`, after)
  await page.close()
  return ok
}

const browser = await chromium.launch({ headless: true })
let allOk = true
try {
  // Diagnostic: legacy contain collapses bitmaps (do not fail suite).
  const legacyOk = await runCase(browser, 'diag-legacy-contain', {
    themeCss: themeCssCurrent(),
    containMode: 'legacy',
    washes: true,
  })
  if (legacyOk) console.log('NOTE: legacy contain unexpectedly passed')
  else console.log('NOTE: legacy contain failed as expected (1x1 collapse)')

  allOk =
    (await runCase(browser, 'prod-safe-theme+safe-contain+washes', {
      themeCss: themeCssSafe(),
      containMode: 'safe',
      washes: true,
    })) && allOk

  allOk =
    (await runCase(browser, 'current-theme+safe-contain', {
      themeCss: themeCssCurrent(),
      containMode: 'safe',
      washes: true,
    })) && allOk

  allOk =
    (await runCase(browser, 'safe-theme+safe-contain', {
      themeCss: themeCssSafe(),
      containMode: 'safe',
      washes: false,
    })) && allOk

  // SVG without viewBox + legacy contain (known collapse)
  {
    const page = await browser.newPage()
    await page.setContent(`<!DOCTYPE html><html><body><iframe id="f" style="width:400px;height:400px;border:0"></iframe></body></html>`)
    const frame = await (await page.$('#f')).contentFrame()
    await frame.setContent(`<!DOCTYPE html><html><body>
      <svg id="novb" width="180" height="90" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="90" fill="red"/></svg>
    </body></html>`)
    const before = await frame.evaluate(() => {
      const r = document.querySelector('#novb').getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
    await applyContainOverflow(frame, 'legacy')
    const after = await frame.evaluate(() => {
      const r = document.querySelector('#novb').getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
    console.log(`SVG-no-viewBox legacy contain: before ${before.w}x${before.h} → after ${after.w}x${after.h}`)
    if (after.h < 2) {
      console.error('FAIL SVG without viewBox collapses under legacy containOverflowMedia')
      allOk = false
    } else {
      console.log('PASS SVG-no-viewBox survived (or browser kept size)')
    }
    await page.close()
  }
} finally {
  await browser.close()
}

if (!allOk) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
