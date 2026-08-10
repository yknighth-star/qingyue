/**
 * Self-test: paginated EPUB media fit — tall images stay in one CSS column page box
 * without collapsing bitmaps (width/height attrs preserved; no width/height:auto !important).
 *
 * Mirrors src/utils/epubMediaFit.ts
 * Run: node scripts/selftest-epub-media-fit.mjs
 */
import { chromium } from 'playwright'

const EPUBJS_COLUMN_PADDING_Y = 40
const PAGE_BOX_SAFETY = 8
const STAGE_W = 360
const STAGE_H = 640

function resolveColumnPageBox({ stageW, stageH, dual, gap = 40 }) {
  const maxH = Math.max(48, stageH - EPUBJS_COLUMN_PADDING_Y - PAGE_BOX_SAFETY)
  if (!dual) return { maxW: stageW, maxH }
  return { maxW: Math.max(48, Math.floor(stageW / 2 - gap / 2)), maxH }
}

function paginatedMediaCss() {
  return `
html body img, html body picture, html body video, html body canvas, html body svg, html body figure {
  max-width: 100% !important;
  object-fit: contain !important;
  break-inside: avoid-column !important;
  page-break-inside: avoid !important;
  -webkit-column-break-inside: avoid !important;
}
`.trim()
}

function fitPaginatedScript() {
  // Injected into page — mirrors applyPaginatedMedia
  return `
    function parseSizeAttr(el, name) {
      const raw = el.getAttribute(name)
      if (!raw) return 0
      const n = parseFloat(raw)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
    function resolveIntrinsic(el) {
      const attrW = parseSizeAttr(el, 'width')
      const attrH = parseSizeAttr(el, 'height')
      let natW = 0, natH = 0
      if (el instanceof HTMLImageElement) {
        natW = el.naturalWidth || 0
        natH = el.naturalHeight || 0
      }
      if (attrW >= 2 && attrH >= 2) return { w: attrW, h: attrH }
      if (natW >= 2 && natH >= 2) return { w: natW, h: natH }
      const r = el.getBoundingClientRect()
      if (r.width >= 2 && r.height >= 2) return { w: r.width, h: r.height }
      return null
    }
    function applyPaginated(el, box) {
      el.style.setProperty('max-width', '100%', 'important')
      el.style.setProperty('max-height', box.maxH + 'px', 'important')
      el.style.setProperty('object-fit', 'contain', 'important')
      el.style.setProperty('break-inside', 'avoid-column', 'important')
      el.style.setProperty('page-break-inside', 'avoid', 'important')
      el.style.setProperty('-webkit-column-break-inside', 'avoid', 'important')
      const intrinsic = resolveIntrinsic(el)
      if (!intrinsic) return
      const scale = Math.min(1, box.maxW / intrinsic.w, box.maxH / intrinsic.h)
      if (!(scale < 1)) {
        el.style.removeProperty('width')
        el.style.removeProperty('height')
        return
      }
      el.style.setProperty('width', Math.max(1, Math.round(intrinsic.w * scale)) + 'px', 'important')
      el.style.setProperty('height', Math.max(1, Math.round(intrinsic.h * scale)) + 'px', 'important')
    }
  `
}

/** Tall red PNG 200×900 via canvas. */
async function tallPngDataUrl(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 900
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#c44'
    ctx.fillRect(0, 0, 200, 900)
    ctx.fillStyle = '#fff'
    ctx.font = '24px sans-serif'
    ctx.fillText('TALL', 60, 80)
    return c.toDataURL('image/png')
  })
}

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmPIQAAAABJRU5ErkJggg=='

async function run() {
  const box = resolveColumnPageBox({ stageW: STAGE_W, stageH: STAGE_H, dual: false })
  const dualBox = resolveColumnPageBox({ stageW: 1200, stageH: STAGE_H, dual: true })
  console.log(`page box single: ${box.maxW}x${box.maxH}`)
  console.log(`page box dual:   ${dualBox.maxW}x${dualBox.maxH}`)

  const browser = await chromium.launch({ headless: true })
  let ok = true
  try {
    const page = await browser.newPage()
    const dataUrl = await tallPngDataUrl(page)
    const fitFn = fitPaginatedScript()

    // --- 1) Visibility: fit must not collapse width/height-attr bitmaps ---
    {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
        <img id="bitmap" src="${PNG_1X1}" width="320" height="200" alt="bitmap"/>
        <svg id="vector" width="200" height="120" viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="200" height="120" fill="#3d9b5f"/>
        </svg>
      </body></html>`)
      await frame.evaluate(() =>
        Promise.all(
          [...document.images].map((i) =>
            i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r }),
          ),
        ),
      )
      await frame.evaluate(
        ({ css, box, fitFn }) => {
          // eslint-disable-next-line no-eval
          eval(fitFn)
          const el = document.createElement('style')
          el.id = 'qingyue-theme'
          el.textContent = css
          document.documentElement.appendChild(el)
          document.querySelectorAll('img, svg').forEach((n) => applyPaginated(n, box))
        },
        { css: paginatedMediaCss(), box, fitFn },
      )
      await page.waitForTimeout(40)
      const vis = await frame.evaluate(() => {
        const boxOf = (sel) => {
          const r = document.querySelector(sel).getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        }
        return { bitmap: boxOf('#bitmap'), vector: boxOf('#vector') }
      })
      if (vis.bitmap.w < 2 || vis.bitmap.h < 2 || vis.vector.w < 2 || vis.vector.h < 2) {
        console.error('FAIL visibility collapse:', vis)
        ok = false
      } else {
        console.log(`PASS visibility: bitmap ${vis.bitmap.w}x${vis.bitmap.h}, svg ${vis.vector.w}x${vis.vector.h}`)
      }
    }

    // --- 2) Tall image capped to page box ---
    {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>body{margin:0}</style></head><body>
        <img id="tall" src="${dataUrl}" width="200" height="900" alt="tall"/>
      </body></html>`)
      await frame.evaluate(() =>
        Promise.all(
          [...document.images].map((i) =>
            i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r }),
          ),
        ),
      )
      await frame.evaluate(
        ({ box, fitFn }) => {
          eval(fitFn)
          applyPaginated(document.getElementById('tall'), box)
        },
        { box, fitFn },
      )
      await page.waitForTimeout(40)
      const m = await frame.evaluate(() => {
        const img = document.getElementById('tall')
        const r = img.getBoundingClientRect()
        return {
          w: r.width,
          h: r.height,
          attrs: { w: img.getAttribute('width'), h: img.getAttribute('height') },
        }
      })
      if (m.attrs.w !== '200' || m.attrs.h !== '900') {
        console.error('FAIL stripped width/height attrs:', m.attrs)
        ok = false
      } else if (m.h > box.maxH + 1) {
        console.error(`FAIL tall height ${m.h} > maxH ${box.maxH}`)
        ok = false
      } else if (m.w < 2 || m.h < 2) {
        console.error('FAIL tall collapsed:', m)
        ok = false
      } else {
        const ratio = m.w / m.h
        const expected = 200 / 900
        if (Math.abs(ratio - expected) > 0.08) {
          console.error(`FAIL aspect drift: got ${ratio.toFixed(3)} expect ~${expected.toFixed(3)}`, m)
          ok = false
        } else {
          console.log(`PASS tall fit: ${Math.round(m.w)}x${Math.round(m.h)} <= ${box.maxH} (attrs kept)`)
        }
      }
    }

    // --- 3) Multi-column: no fragmentation ---
    {
      const colH = box.maxH
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>
          html, body { margin: 0; height: ${STAGE_H}px; }
          body {
            width: ${STAGE_W * 3}px;
            column-width: ${STAGE_W}px;
            column-gap: 0;
            column-fill: auto;
            height: ${STAGE_H}px;
            overflow: hidden;
          }
        </style>
      </head><body>
        <p>before text line one</p>
        <img id="tall" src="${dataUrl}" width="200" height="900" alt="tall"/>
        <p>after text that may flow to next columns</p>
      </body></html>`)
      await frame.evaluate(() =>
        Promise.all(
          [...document.images].map((i) =>
            i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r }),
          ),
        ),
      )
      await frame.evaluate(
        ({ css, box, fitFn }) => {
          eval(fitFn)
          const el = document.createElement('style')
          el.textContent = css
          document.documentElement.appendChild(el)
          applyPaginated(document.getElementById('tall'), box)
        },
        { css: paginatedMediaCss(), box, fitFn },
      )
      await page.waitForTimeout(60)
      const frag = await frame.evaluate(() => {
        const img = document.getElementById('tall')
        const rects = img.getClientRects()
        const r = img.getBoundingClientRect()
        return {
          rectCount: rects.length,
          w: r.width,
          h: r.height,
        }
      })
      if (frag.rectCount !== 1) {
        console.error('FAIL image fragmented across columns:', frag)
        ok = false
      } else if (frag.h > colH + 1) {
        console.error(`FAIL column height ${frag.h} > ${colH}:`, frag)
        ok = false
      } else {
        console.log(`PASS single-column: rects=${frag.rectCount}, ${Math.round(frag.w)}x${Math.round(frag.h)}`)
      }
    }

    // --- 4) Dual half-page box ---
    {
      if (dualBox.maxW >= 600) {
        console.error('FAIL dual maxW should be half-page, got', dualBox.maxW)
        ok = false
      } else {
        console.log(`PASS dual box width ${dualBox.maxW} (half of 1200-gap)`)
      }
    }

    // --- 5) Scroll mode natural height ---
    {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <img id="tall" src="${dataUrl}" width="200" height="900" alt="tall"/>
      </body></html>`)
      await frame.evaluate(() =>
        Promise.all(
          [...document.images].map((i) =>
            i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r }),
          ),
        ),
      )
      await frame.evaluate(() => {
        const img = document.getElementById('tall')
        img.style.setProperty('max-width', '100%', 'important')
        img.style.removeProperty('max-height')
        img.style.removeProperty('width')
        img.style.removeProperty('height')
      })
      const h = await frame.evaluate(() => document.getElementById('tall').getBoundingClientRect().height)
      if (h < 800) {
        console.error(`FAIL scroll mode should keep natural tall height, got ${h}`)
        ok = false
      } else {
        console.log(`PASS scroll mode natural height ~${Math.round(h)}`)
      }
    }

    await page.close()
  } finally {
    await browser.close()
  }

  if (!ok) {
    console.error('\nSELFTEST FAILED')
    process.exit(1)
  }
  console.log('\nSELFTEST OK')
}

await run()
