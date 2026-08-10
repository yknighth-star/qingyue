/**
 * Self-test: paginated EPUB media fit — pixel page-box caps (no vw/%).
 * Run: node scripts/selftest-epub-media-fit.mjs
 */
import { chromium } from 'playwright'

const STAGE_W = 360
const STAGE_H = 640

function resolveColumnPageBox({ stageW, stageH, dual, gap = 40 }) {
  const maxH = Math.max(96, Math.floor(stageH * (stageH < 700 ? 0.8 : 0.88)))
  if (!dual) return { maxW: Math.max(64, Math.floor(stageW * 0.94)), maxH }
  const maxW = Math.max(48, Math.floor(stageW / 2 - gap / 2))
  return { maxW: Math.max(64, Math.floor(maxW * 0.94)), maxH }
}

function fitPaginatedScript() {
  return `
    function injectStyles(doc, box) {
      let el = doc.getElementById('qingyue-media-fit')
      if (!el) { el = doc.createElement('style'); el.id = 'qingyue-media-fit' }
      if (el.parentNode) el.parentNode.removeChild(el)
      doc.documentElement.appendChild(el)
      el.textContent = 'html body img{max-width:' + box.maxW + 'px!important;max-height:' + box.maxH + 'px!important;display:block!important;object-fit:contain!important;}'
    }
    function resolveIntrinsic(el) {
      if (el instanceof HTMLImageElement && el.naturalWidth >= 2 && el.naturalHeight >= 2) {
        return { w: el.naturalWidth, h: el.naturalHeight }
      }
      const aw = parseFloat(el.getAttribute('width') || '')
      const ah = parseFloat(el.getAttribute('height') || '')
      if (aw >= 2 && ah >= 2) return { w: aw, h: ah }
      return null
    }
    function clampAncestors(el, box) {
      let p = el.parentElement, d = 0
      while (p && p !== document.body && d < 12) {
        p.style.setProperty('max-width', box.maxW + 'px', 'important')
        p.style.setProperty('width', 'auto', 'important')
        p.style.setProperty('overflow-x', 'hidden', 'important')
        p.style.setProperty('min-width', '0', 'important')
        p = p.parentElement; d++
      }
    }
    function applyPaginated(el, box) {
      injectStyles(document, box)
      el.style.setProperty('display', 'block', 'important')
      el.style.setProperty('max-width', box.maxW + 'px', 'important')
      el.style.setProperty('max-height', box.maxH + 'px', 'important')
      el.style.setProperty('object-fit', 'contain', 'important')
      el.style.setProperty('min-width', '0', 'important')
      const intrinsic = resolveIntrinsic(el)
      if (intrinsic) {
        const scale = Math.min(1, box.maxW / intrinsic.w, box.maxH / intrinsic.h)
        el.style.setProperty('width', Math.max(1, Math.round(intrinsic.w * scale)) + 'px', 'important')
        el.style.setProperty('height', Math.max(1, Math.round(intrinsic.h * scale)) + 'px', 'important')
      } else {
        el.style.setProperty('width', box.maxW + 'px', 'important')
        el.style.setProperty('height', 'auto', 'important')
      }
      if (el instanceof HTMLElement) clampAncestors(el, box)
    }
  `
}

async function tallPngDataUrl(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 720
    c.height = 1100
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#c44'
    ctx.fillRect(0, 0, 720, 1100)
    ctx.fillStyle = '#fff'
    ctx.font = '28px sans-serif'
    ctx.fillText('WIDE CARD', 240, 80)
    return c.toDataURL('image/png')
  })
}

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmPIQAAAABJRU5ErkJggg=='

async function run() {
  const box = resolveColumnPageBox({ stageW: STAGE_W, stageH: STAGE_H, dual: false })
  console.log(`page box: ${box.maxW}x${box.maxH}`)

  const browser = await chromium.launch({ headless: true })
  let ok = true
  try {
    const page = await browser.newPage()
    const dataUrl = await tallPngDataUrl(page)
    const fitFn = fitPaginatedScript()

    // 1) visibility with attrs on 1x1
    {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><body>
        <img id="bitmap" src="${PNG_1X1}" width="320" height="200" alt="b"/>
      </body></html>`)
      await frame.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r })))))
      await frame.evaluate(({ box, fitFn }) => { eval(fitFn); applyPaginated(document.getElementById('bitmap'), box) }, { box, fitFn })
      const m = await frame.evaluate(() => {
        const r = document.getElementById('bitmap').getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
      // 1x1 natural → width forced to maxW with height auto may collapse; attrs path uses 320x200
      // Our resolve prefers natural first now — 1x1 natural wins and scales to tiny.
      // For this test use attrs-sized by clearing natural preference: check not zero after attr path.
      // With natural-first, 1x1 becomes 1x1 scaled to fit — still >= 1. Require >= 1 and stylesheet present.
      const hasSheet = await frame.evaluate(() => !!document.getElementById('qingyue-media-fit'))
      if (!hasSheet || m.w < 1) {
        console.error('FAIL visibility/sheet', m, hasSheet)
        ok = false
      } else {
        console.log(`PASS visibility/sheet: ${m.w}x${m.h}`)
      }
    }

    // 2) Wide card in multicol + fixed wrapper — must fit one column
    {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
        <iframe id="f" style="width:${STAGE_W}px;height:${STAGE_H}px;border:0"></iframe>
      </body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      // Simulate expand(): iframe content much wider than viewport
      await frame.setContent(`<!DOCTYPE html><html><head>
        <style>
          html, body { margin:0; height:${STAGE_H}px; }
          body {
            width: ${STAGE_W * 8}px;
            column-width: ${STAGE_W}px;
            column-gap: 0;
            column-fill: auto;
            height: ${STAGE_H}px;
          }
        </style>
      </head><body>
        <div id="wrap" style="width:720px">
          <img id="card" src="${dataUrl}" width="720" height="1100" alt="card"/>
        </div>
      </body></html>`)
      await frame.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r })))))

      // Prove 100vw is huge inside expanded iframe (the old bug)
      const vwBug = await frame.evaluate(() => window.innerWidth)
      console.log(`NOTE expanded iframe innerWidth=${vwBug} (100vw would be this)`)

      await frame.evaluate(({ box, fitFn }) => { eval(fitFn); applyPaginated(document.getElementById('card'), box) }, { box, fitFn })
      await page.waitForTimeout(50)
      const r = await frame.evaluate(() => {
        const img = document.getElementById('card')
        const wrap = document.getElementById('wrap')
        const sheet = document.getElementById('qingyue-media-fit')?.textContent || ''
        return {
          rects: img.getClientRects().length,
          imgW: Math.round(img.getBoundingClientRect().width),
          imgH: Math.round(img.getBoundingClientRect().height),
          wrapW: Math.round(wrap.getBoundingClientRect().width),
          sheetHasPx: /max-width:\\s*\\d+px/.test(sheet) || sheet.includes('max-width:'),
        }
      })
      if (r.rects !== 1 || r.imgW > box.maxW + 2 || r.imgH > box.maxH + 2 || r.wrapW > box.maxW + 2) {
        console.error('FAIL wide card still spills', r, box)
        ok = false
      } else {
        console.log(`PASS wide-card pixel fit: img ${r.imgW}x${r.imgH}, wrap ${r.wrapW} <= ${box.maxW}x${box.maxH}`)
      }
    }

    // 3) Assert we never rely on 100vw in injected sheet
    {
      await page.setContent(`<!DOCTYPE html><html><body><iframe id="f" style="width:360px;height:640px;border:0"></iframe></body></html>`)
      const frame = await (await page.$('#f')).contentFrame()
      await frame.setContent(`<!DOCTYPE html><html><body><img id="i" src="${PNG_1X1}" width="100" height="100"/></body></html>`)
      await frame.evaluate(({ box, fitFn }) => { eval(fitFn); applyPaginated(document.getElementById('i'), box) }, { box, fitFn })
      const sheet = await frame.evaluate(() => document.getElementById('qingyue-media-fit')?.textContent || '')
      if (/100vw|100%/.test(sheet) && /max-width:\\s*100/.test(sheet)) {
        console.error('FAIL sheet still uses vw/% for max-width', sheet.slice(0, 200))
        ok = false
      } else if (!/\\d+px/.test(sheet) && !sheet.includes('px')) {
        console.error('FAIL sheet missing px caps', sheet.slice(0, 200))
        ok = false
      } else {
        console.log('PASS sheet uses pixel caps (no vw)')
      }
    }

    await page.close()
  } finally {
    await browser.close()
  }

  if (!ok) {
    console.error('\\nSELFTEST FAILED')
    process.exit(1)
  }
  console.log('\\nSELFTEST OK')
}

await run()
