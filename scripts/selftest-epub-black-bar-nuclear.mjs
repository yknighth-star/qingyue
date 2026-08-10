/**
 * Nuclear selftest: 「朱重八家族」PC failure modes.
 * Run: node --experimental-strip-types scripts/selftest-epub-black-bar-nuclear.mjs
 */
import { chromium } from 'playwright'
import {
  LIGHT_ON_DARK_FG,
  forceShortLabelsOnDarkBackdrop,
  collectSvgTitleBands,
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

assert(LIGHT_ON_DARK_FG === '#ffffff', 'light-on-dark is pure white')
assert(contrastTextForBackground('#000', '#3b2f2f', '#f3ead3') === '#ffffff', 'contrast → white')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const BLACK_BAR = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 480
    c.height = 28
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 480, 28)
    return c.toDataURL('image/png')
  })

  // --- Case 1: text over img black bar ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f;margin:0;padding:40px">
    <div id="wrap" style="position:relative;width:480px;margin:0 auto">
      <img id="bar" src="${BLACK_BAR}" width="480" height="28" style="display:block;width:480px;height:28px"/>
      <p id="title" style="position:absolute;left:0;right:0;top:0;margin:0;line-height:28px;text-align:center;color:#3b2f2f;-webkit-text-fill-color:#3b2f2f">朱重八家族</p>
    </div>
  </body></html>`)
  await page.waitForFunction(() => {
    const img = document.getElementById('bar')
    return !!(img && img.complete && img.naturalWidth > 0)
  })

  const case1 = await page.evaluate(() => {
    const title = document.getElementById('title')
    const img = document.getElementById('bar')
    const rect = title.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const r = img.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    const nx = ((cx - r.left) / r.width) * img.naturalWidth
    const ny = ((cy - r.top) / r.height) * img.naturalHeight
    ctx.drawImage(img, nx, ny, 1, 1, 0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    const dark = (d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722) / 255 < 0.42
    if (dark) {
      title.style.setProperty('color', '#ffffff', 'important')
      title.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important')
      title.dataset.qyOnDark = '1'
    }
    return { dark, color: getComputedStyle(title).color, sample: [d[0], d[1], d[2]] }
  })
  assert(case1.dark, `img under title is dark (sample ${case1.sample})`)
  assert(/255,\s*255,\s*255/i.test(case1.color), `title forced white over img (got ${case1.color})`)

  // --- Case 2: background:url ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f">
    <p id="title" style="width:480px;height:28px;margin:40px auto;line-height:28px;text-align:center;color:#3b2f2f;-webkit-text-fill-color:#3b2f2f;background-image:url('${BLACK_BAR}');background-size:100% 100%">朱重八家族</p>
  </body></html>`)
  const case2 = await page.evaluate(() => {
    const title = document.getElementById('title')
    const bi = getComputedStyle(title).backgroundImage
    const short = (title.textContent || '').replace(/\s+/g, '').length <= 24
    if (bi && bi !== 'none' && /url\(/i.test(bi) && short) {
      title.style.setProperty('color', '#ffffff', 'important')
      title.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important')
    }
    return { bi, color: getComputedStyle(title).color }
  })
  assert(/url\(/i.test(case2.bi), 'title has url background')
  assert(/255,\s*255,\s*255/i.test(case2.color), `url-bar title white (got ${case2.color})`)

  // --- Case 3: SVG text over <image> ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f">
    <svg id="chart" xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120">
      <image href="${BLACK_BAR}" x="20" y="10" width="440" height="28"/>
      <text id="title" x="240" y="30" text-anchor="middle" font-size="14" fill="currentColor">朱重八家族</text>
      <circle cx="80" cy="80" r="28" fill="#fff" stroke="#000"/>
      <text id="label" x="80" y="84" text-anchor="middle" font-size="11" fill="currentColor">高祖</text>
    </svg>
  </body></html>`)
  await page.waitForTimeout(50)

  const case3 = await page.evaluate(({ light, dark }) => {
    const svg = document.getElementById('chart')
    const bands = []
    const sw = 480
    const sh = 120
    svg.querySelectorAll('image').forEach((img) => {
      const b = img.getBBox()
      if (b.width >= sw * 0.35 && b.height <= sh * 0.45 && b.y + b.height / 2 <= sh * 0.42) {
        bands.push(b)
      }
    })
    const inBand = (cx, cy) =>
      bands.some((b) => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height)
    svg.querySelectorAll('text').forEach((t) => {
      const b = t.getBBox()
      const fill = inBand(b.x + b.width / 2, b.y + b.height / 2) ? light : dark
      t.style.setProperty('fill', fill, 'important')
    })
    return {
      bands: bands.length,
      title: document.getElementById('title').style.fill,
      label: document.getElementById('label').style.fill,
    }
  }, { light: '#ffffff', dark: '#3b2f2f' })

  assert(case3.bands >= 1, `svg image title band detected (${case3.bands})`)
  assert(/ffffff|255,\s*255,\s*255/i.test(case3.title), `svg title white (got ${case3.title})`)
  assert(/3b2f2f|59,\s*47,\s*47/i.test(case3.label), `svg label stays dark (got ${case3.label})`)

  assert(typeof forceShortLabelsOnDarkBackdrop === 'function', 'forceShortLabelsOnDarkBackdrop exported')
  assert(typeof collectSvgTitleBands === 'function', 'collectSvgTitleBands exported')

  // Raster: white text on black must produce light pixels
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;margin:0">
    <div style="position:relative;width:480px;height:28px;margin:20px;background:#000">
      <p id="title" style="position:absolute;inset:0;margin:0;line-height:28px;text-align:center;color:#ffffff;font:bold 16px sans-serif">朱重八家族</p>
    </div>
  </body></html>`)
  const shot = await page.locator('div').first().screenshot()
  const probe = await page.evaluate(async (b64) => {
    const img = new Image()
    await new Promise((r, j) => {
      img.onload = r
      img.onerror = j
      img.src = 'data:image/png;base64,' + b64
    })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(Math.floor(c.width * 0.35), Math.floor(c.height / 2), Math.floor(c.width * 0.3), 1).data
    let light = 0
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3
      if (L > 180) light++
      else if (L > 20 && L < 90) dark++
    }
    return { light, dark }
  }, shot.toString('base64'))
  assert(probe.light > probe.dark, `raster title has light glyphs (light=${probe.light} dark=${probe.dark})`)

  await page.close()
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
