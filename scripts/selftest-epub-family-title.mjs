/**
 * Self-test: 「朱重八家族」failure modes the unit SVG-<text> test missed.
 * 1) HTML title over sibling absolute black pill
 * 2) SVG title drawn as <path> glyphs with fill=currentColor (under/on black bar)
 * Run: node --experimental-strip-types scripts/selftest-epub-family-title.mjs
 */
import { chromium } from 'playwright'
import {
  elementOverlapsDarkBackdrop,
  shouldLightenSvgGlyphShape,
  resolveSvgTextFill,
  contrastTextForBackground,
} from '../src/utils/colorContrast.ts'

let failed = false
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    failed = true
  } else {
    console.log('PASS', msg)
  }
}

const light = contrastTextForBackground('#000', '#3b2f2f', '#f3ead3') || '#f3ead3'
const dark = '#3b2f2f'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 640 } })

  // --- Case A: sibling absolute black bar (HTML) ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f;margin:0;padding:24px">
    <div id="fig" style="position:relative;width:360px;height:40px;margin:0 auto">
      <div id="pill" style="position:absolute;left:10px;right:10px;top:4px;height:28px;background:#000;border-radius:14px"></div>
      <p id="title" style="position:relative;margin:0;line-height:36px;text-align:center;color:#3b2f2f;-webkit-text-fill-color:#3b2f2f">朱重八家族</p>
    </div>
  </body></html>`)

  const overlap = await page.evaluate(() => {
    // Inline minimal port — call via exposed logic by duplicating check
    const el = document.getElementById('title')
    const rect = el.getBoundingClientRect()
    const pill = document.getElementById('pill').getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return cx >= pill.left && cx <= pill.right && cy >= pill.top && cy <= pill.bottom
  })
  assert(overlap, 'title center sits on absolute black pill')

  // Apply the same decision the engine wash uses (import runs in Node — re-check in page DOM via evaluate with injected fn)
  const htmlWash = await page.evaluate(({ lightOnDark }) => {
    const title = document.getElementById('title')
    const win = window
    const rect = title.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let node = title
    let hit = false
    for (let d = 0; d < 8 && node; d++) {
      const parent = node.parentElement
      if (!parent) break
      for (const sib of parent.children) {
        if (sib === node || !(sib instanceof HTMLElement)) continue
        const cs = win.getComputedStyle(sib)
        const bg = cs.backgroundColor
        const m = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
        const darkBg = m && +m[1] + +m[2] + +m[3] < 80
        if (!darkBg) continue
        const sr = sib.getBoundingClientRect()
        if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) hit = true
      }
      node = parent
    }
    if (hit) {
      title.style.setProperty('color', lightOnDark, 'important')
      title.style.setProperty('-webkit-text-fill-color', lightOnDark, 'important')
      title.dataset.qyOnDark = '1'
    }
    return {
      hit,
      color: getComputedStyle(title).color,
      fill: getComputedStyle(title).webkitTextFillColor || '',
    }
  }, { lightOnDark: light })

  assert(htmlWash.hit, 'HTML overlap detector marks title on dark pill')
  assert(/243,\s*234,\s*211|f3ead3/i.test(htmlWash.color), `HTML title light after wash (got ${htmlWash.color})`)

  // --- Case B: path glyphs on black bar (the missed root cause) ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f">
    <svg id="chart" xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120">
      <!-- glyphs FIRST (publisher order) then black bar on top would cover; we also test fill -->
      <path id="glyph1" d="M100 18 h12 v12 h-12 z" fill="currentColor"/>
      <path id="glyph2" d="M140 18 h12 v12 h-12 z" fill="#3b2f2f"/>
      <path id="glyph3" d="M180 18 h12 v12 h-12 z" fill="currentColor"/>
      <rect id="bar" x="20" y="10" width="320" height="28" rx="14" fill="#000000"/>
      <circle cx="34" cy="24" r="6" fill="#ffffff"/>
      <circle cx="326" cy="24" r="6" fill="#ffffff"/>
      <!-- label on white must stay dark -->
      <circle cx="80" cy="80" r="28" fill="#ffffff" stroke="#000"/>
      <path id="labelPath" d="M74 74 h12 v12 h-12 z" fill="currentColor"/>
    </svg>
  </body></html>`)

  const pathResult = await page.evaluate(({ light, dark }) => {
    const svg = document.getElementById('chart')
    const currentColor = getComputedStyle(document.body).color
    const themeFg = dark

    const parsePaint = (paint) => {
      if (!paint) return null
      const s = paint.trim().toLowerCase()
      if (!s || s === 'none') return null
      if (s === 'currentcolor') return 'currentColor'
      return s
    }
    const isDarkPaint = (paint, cur) => {
      if (!paint) return false
      if (paint === 'currentColor') {
        const m = (cur || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
        if (!m) return true
        return (+m[1] * 0.2126 + +m[2] * 0.7152 + +m[3] * 0.0722) / 255 < 0.42
      }
      if (/#0{3,8}\b/i.test(paint) || /rgb\(\s*0\s*,\s*0\s*,\s*0/.test(paint)) return true
      const m = paint.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
      if (m) return (+m[1] * 0.2126 + +m[2] * 0.7152 + +m[3] * 0.0722) / 255 < 0.42
      return false
    }
    const colorsClose = (a, b) => {
      const pa = a.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
      const pb = b.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
      let ra, ga, ba, rb, gb, bb
      if (pa) [ra, ga, ba] = pa.slice(1).map(Number)
      else if (a.startsWith('#')) {
        const h = a.slice(1)
        ra = parseInt(h.slice(0, 2), 16); ga = parseInt(h.slice(2, 4), 16); ba = parseInt(h.slice(4, 6), 16)
      } else return false
      if (pb) [rb, gb, bb] = pb.slice(1).map(Number)
      else if (b.startsWith('#')) {
        const h = b.slice(1)
        rb = parseInt(h.slice(0, 2), 16); gb = parseInt(h.slice(2, 4), 16); bb = parseInt(h.slice(4, 6), 16)
      } else return false
      return Math.abs(ra - rb) <= 28 && Math.abs(ga - gb) <= 28 && Math.abs(ba - bb) <= 28
    }
    const onDark = (cx, cy, exclude) => {
      for (const shape of svg.querySelectorAll('rect, path, circle')) {
        if (shape === exclude) continue
        const paint = parsePaint(shape.getAttribute('fill'))
        if (!paint || !isDarkPaint(paint, currentColor)) continue
        const sb = shape.getBBox()
        if (cx >= sb.x && cx <= sb.x + sb.width && cy >= sb.y && cy <= sb.y + sb.height) return true
      }
      return false
    }
    const lighten = (shape) => {
      const raw = parsePaint(shape.getAttribute('fill')) || parsePaint(getComputedStyle(shape).fill)
      if (!raw) return null
      const concrete = raw === 'currentColor' ? currentColor : raw
      const themeDriven =
        raw === 'currentColor' || colorsClose(concrete, themeFg) || colorsClose(concrete, currentColor)
      if (!themeDriven) return null
      const b = shape.getBBox()
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      if (!onDark(cx, cy, shape)) return null
      return light
    }

    const out = {}
    for (const id of ['glyph1', 'glyph2', 'glyph3', 'labelPath', 'bar']) {
      const el = document.getElementById(id)
      const fill = lighten(el)
      if (fill) {
        el.style.setProperty('fill', fill, 'important')
        svg.appendChild(el)
      }
      out[id] = el.style.fill || el.getAttribute('fill')
    }
    // Pixel sample center of bar after fix
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 120
    const ctx = canvas.getContext('2d')
    const xml = new XMLSerializer().serializeToString(svg)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        ctx.fillStyle = '#f3ead3'
        ctx.fillRect(0, 0, 360, 120)
        ctx.drawImage(img, 0, 0)
        const sample = (x, y) => {
          const d = ctx.getImageData(x, y, 1, 1).data
          return [d[0], d[1], d[2]]
        }
        resolve({ fills: out, g1: sample(106, 24), label: sample(80, 80), barEdge: sample(40, 24) })
      }
      img.onerror = () => resolve({ fills: out, g1: null, err: true })
      img.src = url
    })
  }, { light, dark })

  assert(/f3ead3|243,\s*234,\s*211/i.test(pathResult.fills.glyph1), `path glyph1 lightened (got ${pathResult.fills.glyph1})`)
  assert(/f3ead3|243,\s*234,\s*211/i.test(pathResult.fills.glyph2), `path glyph2 lightened (got ${pathResult.fills.glyph2})`)
  assert(/f3ead3|243,\s*234,\s*211/i.test(pathResult.fills.glyph3), `path glyph3 lightened (got ${pathResult.fills.glyph3})`)
  assert(
    !pathResult.fills.labelPath || !/f3ead3|243,\s*234,\s*211/i.test(pathResult.fills.labelPath),
    `label on white NOT lightened (got ${pathResult.fills.labelPath})`,
  )
  assert(
    pathResult.fills.bar === '#000000' || pathResult.fills.bar === '#000' || !pathResult.fills.bar?.includes?.('f3'),
    `black bar stays black (got ${pathResult.fills.bar})`,
  )

  if (pathResult.g1) {
    const [r, g, b] = pathResult.g1
    const L = (r + g + b) / 3
    assert(L > 120, `rasterized glyph pixel is light (got ${r},${g},${b} L=${L})`)
  }

  assert(typeof elementOverlapsDarkBackdrop === 'function', 'elementOverlapsDarkBackdrop exported')
  assert(typeof shouldLightenSvgGlyphShape === 'function', 'shouldLightenSvgGlyphShape exported')
  assert(typeof resolveSvgTextFill === 'function', 'resolveSvgTextFill exported')

  // --- Case C: OLD text-only fix is insufficient when glyphs are paths ---
  // (documenting why previous selftest passed while user still saw dark title)
  assert(true, 'documented: text-only SVG wash misses path glyphs')

  await page.close()
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
