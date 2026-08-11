/**
 * E2E: real Vite reader + fixture EPUB. Fails if black-bar title stays dark after theme.
 * Requires: npm run dev on http://localhost:5173/
 * Run: node --experimental-strip-types scripts/selftest-epub-reader-e2e-black-bar.mjs
 */
import { chromium } from 'playwright'
import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QY_BASE || 'http://localhost:5173/'
const OUT = path.resolve('scripts/_e2e-black-bar-out')
fs.mkdirSync(OUT, { recursive: true })

let failed = false
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    failed = true
  } else {
    console.log('PASS', msg)
  }
}

async function buildFixtureEpub() {
  const zip = new JSZip()
  zip.file(
    'mimetype',
    'application/epub+zip',
    { compression: 'STORE' },
  )
  zip.folder('META-INF').file(
    'container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.folder('OEBPS').file(
    'content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>黑条对比度夹具</dc:title>
    <dc:language>zh</dc:language>
    <dc:identifier id="uid">qy-black-bar-fixture</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`,
  )
  zip.folder('OEBPS').file(
    'toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><docTitle><text>黑条</text></docTitle><navMap><navPoint id="n1"><navLabel><text>一</text></navLabel><content src="chap1.xhtml"/></navPoint></navMap></ncx>`,
  )
  // Three real failure modes on one page
  zip.folder('OEBPS').file(
    'chap1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh">
<head><title>chap</title>
<style>
body{font-family:sans-serif;background:#f3ead3;color:#3b2f2f;padding:12px}
.solid{background:#000;color:#fff;text-align:center;padding:8px 16px;border-radius:16px;margin:16px auto;max-width:420px}
.wrap{position:relative;width:420px;margin:20px auto;height:32px}
.pill{position:absolute;inset:0;background:#000;border-radius:16px}
.over{position:relative;margin:0;line-height:32px;text-align:center;color:#fff}
.ch-head{text-align:center;margin:28px auto;max-width:420px}
.ch-rule{height:1px;background:#000;margin:0 auto;width:72%}
.ch-rule-thick{height:3px;background:#000;margin:0 auto;width:72%}
.ch-num,.ch-title{margin:10px 0;text-align:center;color:#3b2f2f}
.sec-head{margin:20px 0;color:#3b2f2f}
.sec-head::before{content:"◆";display:inline-block;width:0.9em;height:0.9em;margin-right:0.35em;background:#000;color:transparent;vertical-align:-0.05em}
</style>
</head>
<body>
<div class="ch-head" id="ch-head">
  <div class="ch-rule" id="rule-top"></div>
  <p class="ch-num" id="ch-num" align="center">第二章</p>
  <div class="ch-rule-thick" id="rule-mid"></div>
  <p class="ch-title" id="ch-title" align="center">灾难</p>
</div>
<p class="sec-head title" id="sec-head">我们从一份档案开始</p>
<p>前文：朱元璋原来叫朱重八。</p>
<p class="solid" id="solid-title">赈灾物品</p>
<div class="wrap" id="abs-wrap">
  <div class="pill"></div>
  <p class="over" id="abs-title">朱重八家族</p>
</div>
<svg id="chart" xmlns="http://www.w3.org/2000/svg" width="420" height="100" viewBox="0 0 420 100" style="display:block;margin:20px auto">
  <rect x="20" y="8" width="380" height="28" rx="14" fill="#000000"/>
  <circle cx="34" cy="22" r="5" fill="#ffffff"/>
  <circle cx="386" cy="22" r="5" fill="#ffffff"/>
  <text id="svg-title" x="210" y="27" text-anchor="middle" font-size="14" fill="#000000">朱重八家族</text>
  <path id="glyph" d="M100 14 h10 v10 h-10 z" fill="#000000"/>
  <circle cx="80" cy="70" r="22" fill="#ffffff" stroke="#000"/>
  <text id="svg-label" x="80" y="74" text-anchor="middle" font-size="11" fill="#000000">高祖</text>
</svg>
<div class="wrap" id="html-over-svg" style="position:relative;width:420px;margin:20px auto;height:36px">
  <svg xmlns="http://www.w3.org/2000/svg" width="420" height="36" viewBox="0 0 420 36" style="position:absolute;inset:0">
    <rect x="20" y="4" width="380" height="28" rx="14" fill="#000000"/>
    <circle cx="34" cy="18" r="5" fill="#ffffff"/>
    <circle cx="386" cy="18" r="5" fill="#ffffff"/>
  </svg>
  <p class="over" id="html-svg-title" style="position:relative;margin:0;line-height:36px;text-align:center;color:#3b2f2f">朱重八家族</p>
</div>
<p>这并不是数学题。</p>
</body></html>`,
  )
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.setDefaultTimeout(45000)

  const alive = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).then(() => true).catch((e) => {
    console.error('Cannot open', BASE, e.message)
    return false
  })
  assert(alive, `dev server reachable at ${BASE}`)
  if (!alive) {
    process.exit(1)
  }

  const epubBuf = await buildFixtureEpub()
  const epubPath = path.join(OUT, 'black-bar-fixture.epub')
  fs.writeFileSync(epubPath, epubBuf)

  // Import via hidden file input on shelf
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const input = page.locator('input[type="file"][accept*="epub"]')
  await input.setInputFiles(epubPath)
  await page.waitForTimeout(1500)

  // Click the imported book card (title 黑条对比度夹具)
  const card = page.getByText('黑条对比度夹具').first()
  const hasCard = await card.count()
  assert(hasCard > 0, 'fixture book appears on shelf')
  if (hasCard === 0) {
    // dump for debug
    const html = await page.content()
    fs.writeFileSync(path.join(OUT, 'shelf.html'), html)
    throw new Error('import failed — see scripts/_e2e-black-bar-out/shelf.html')
  }
  await card.click()
  await page.waitForTimeout(2500)

  // Find epub iframe(s)
  const frames = page.frames()
  const chapter = frames.find((f) => f.url().includes('blob:') || f.name()?.includes('epub') || f !== page.mainFrame())
  // epub.js uses iframe with blob or about:blank — search all
  let target = null
  for (const f of frames) {
    try {
      const has = await f.locator('#abs-title, #solid-title, #svg-title').count()
      if (has > 0) {
        target = f
        break
      }
    } catch {
      /* */
    }
  }
  assert(!!target, 'found chapter iframe with fixture ids')
  if (!target) {
    fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames.map((f) => f.url()), null, 2))
    throw new Error('no chapter frame')
  }

  // Wait for theme wash retries
  await page.waitForTimeout(2000)

  const colors = await target.evaluate(() => {
    const solid = document.getElementById('solid-title')
    const abs = document.getElementById('abs-title')
    const svgTitle = document.getElementById('svg-title')
    const label = document.getElementById('svg-label')
    const glyph = document.getElementById('glyph')
    const chNum = document.getElementById('ch-num')
    const chTitle = document.getElementById('ch-title')
    const secHead = document.getElementById('sec-head')
    const htmlSvg = document.getElementById('html-svg-title')
    const cs = (el) => (el ? getComputedStyle(el).color : null)
    const fill = (el) => {
      if (!el) return null
      return el.style.fill || getComputedStyle(el).fill
    }
    return {
      solid: cs(solid),
      abs: cs(abs),
      solidOnDark: solid?.dataset?.qyOnDark || null,
      absOnDark: abs?.dataset?.qyOnDark || null,
      svgTitle: fill(svgTitle),
      svgLabel: fill(label),
      glyph: fill(glyph),
      chNum: cs(chNum),
      chTitle: cs(chTitle),
      chNumOnDark: chNum?.dataset?.qyOnDark || null,
      chTitleOnDark: chTitle?.dataset?.qyOnDark || null,
      secHead: cs(secHead),
      secHeadOnDark: secHead?.dataset?.qyOnDark || null,
      htmlSvg: cs(htmlSvg),
      htmlSvgOnDark: htmlSvg?.dataset?.qyOnDark || null,
      bodyColor: getComputedStyle(document.body).color,
      themeStyle: !!document.getElementById('qingyue-theme'),
    }
  })
  console.log('NOTE colors', JSON.stringify(colors, null, 2))
  fs.writeFileSync(path.join(OUT, 'colors.json'), JSON.stringify(colors, null, 2))

  const isWhite = (c) => /255,\s*255,\s*255|#fff/i.test(c || '')
  const isDark = (c) => /59,\s*47,\s*47|3b2f2f|0,\s*0,\s*0|#000/i.test(c || '')

  assert(colors.themeStyle, 'qingyue-theme injected')
  assert(isWhite(colors.solid), `solid black bar title is white (got ${colors.solid})`)
  assert(isWhite(colors.abs), `absolute overlay title is white (got ${colors.abs})`)
  assert(isWhite(colors.svgTitle), `svg text on black is white (got ${colors.svgTitle})`)
  assert(isWhite(colors.glyph) || isWhite(String(colors.glyph)), `svg #000 path glyph lightened (got ${colors.glyph})`)
  assert(isDark(colors.svgLabel) || /59|3b2f2f|0,\s*0,\s*0/i.test(colors.svgLabel || ''), `label on white stays dark (got ${colors.svgLabel})`)
  // Chapter titles between thin black rules must stay theme-dark (not white-on-cream).
  assert(!isWhite(colors.chNum), `chapter number stays dark (got ${colors.chNum})`)
  assert(!isWhite(colors.chTitle), `chapter title stays dark (got ${colors.chTitle})`)
  assert(colors.chNumOnDark !== '1', 'chapter number not marked on-dark')
  assert(colors.chTitleOnDark !== '1', 'chapter title not marked on-dark')
  assert(isDark(colors.chNum) || isDark(colors.bodyColor), `chapter number readable dark (got ${colors.chNum})`)
  assert(isDark(colors.chTitle) || isDark(colors.bodyColor), `chapter title readable dark (got ${colors.chTitle})`)
  assert(!isWhite(colors.secHead), `◆ section head stays dark (got ${colors.secHead})`)
  assert(colors.secHeadOnDark !== '1', '◆ section head not marked on-dark')
  assert(isDark(colors.secHead) || isDark(colors.bodyColor), `◆ section head readable (got ${colors.secHead})`)
  assert(isWhite(colors.htmlSvg), `HTML over SVG capsule is white (got ${colors.htmlSvg})`)
  assert(colors.htmlSvgOnDark === '1', 'HTML over SVG marked on-dark')

  // Pixel proof on abs title
  const shot = await target.locator('#abs-wrap').screenshot()
  fs.writeFileSync(path.join(OUT, 'abs-wrap.png'), shot)
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
    const y = Math.floor(c.height / 2)
    const d = ctx.getImageData(Math.floor(c.width * 0.3), y, Math.floor(c.width * 0.4), 1).data
    let light = 0
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3
      if (L > 180) light++
      else if (L > 20 && L < 100) dark++
    }
    return { light, dark, w: c.width, h: c.height }
  }, shot.toString('base64'))
  console.log('NOTE pixels', probe)
  assert(probe.light > 0, `raster abs title has light glyphs (light=${probe.light} dark=${probe.dark})`)
  // Rounded black pill edges count as "dark" AA; require light text signal present.
  assert(
    probe.light + 5 >= probe.dark || probe.light >= 12,
    `raster abs title not crushed (light=${probe.light} dark=${probe.dark})`,
  )

  await page.screenshot({ path: path.join(OUT, 'reader.png'), fullPage: true })
  await page.close()
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nE2E FAILED — see scripts/_e2e-black-bar-out/')
  process.exit(1)
}
console.log('\nE2E OK')
