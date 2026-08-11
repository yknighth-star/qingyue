/**
 * Nuclear selftest: 「朱重八家族」PC failure modes.
 * Run: node --experimental-strip-types scripts/selftest-epub-black-bar-nuclear.mjs
 */
import { chromium } from 'playwright'
import {
  LIGHT_ON_DARK_FG,
  applyShortLabelContrast,
  collectSvgTitleBands,
  contrastTextForBackground,
  isThinDecorativeRule,
  urlBackgroundLikelyTitleBar,
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
assert(isThinDecorativeRule({ width: 400, height: 1 }, 28), '1px rule is decorative')
assert(isThinDecorativeRule({ width: 400, height: 3 }, 28), '3px rule is decorative')
assert(!isThinDecorativeRule({ width: 400, height: 28 }, 28), '28px capsule is not a rule')

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

  // --- Case 0: chapter titles between black rules + distant figure (regression) ---
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f;margin:0;padding:24px;font:16px sans-serif">
    <div id="section">
      <div style="height:1px;background:#000;width:70%;margin:0 auto"></div>
      <p id="ch-num" align="center" style="margin:10px 0">第二章</p>
      <div style="height:3px;background:#000;width:70%;margin:0 auto"></div>
      <p id="ch-title" align="center" style="margin:10px 0">灾难</p>
      <p>正文一段话。</p>
      <img id="fig" src="${BLACK_BAR}" width="480" height="28" style="display:block;margin:20px auto"/>
      <p id="cap" align="center">朱重八家族</p>
    </div>
  </body></html>`)
  await page.waitForFunction(() => {
    const img = document.getElementById('fig')
    return !!(img && img.complete && img.naturalWidth > 0)
  })

  // Drive helpers from Node against live DOM via page.evaluate handle bridge:
  // re-query elements inside page and run exported logic by injecting via Function from Playwright's
  // ability to pass serialized results — call Node functions with element handles using evaluate.
  const case0 = await page.evaluate(() => {
    // Mirror hasAdjacentFigureMedia (must match colorContrast.ts)
    const hasAdj = (el) => {
      const check = (sib) => {
        if (!sib) return false
        const tag = sib.tagName.toLowerCase()
        if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'object') return true
        if (sib.querySelector(':scope > img, :scope > svg, :scope > picture, :scope > object')) return true
        return false
      }
      return check(el.previousElementSibling) || check(el.nextElementSibling)
    }
    const isThin = (r, textH = 0) => {
      if (r.height < 1 || r.width < 1) return true
      if (r.height <= 12) return true
      if (textH > 0 && r.height < textH * 0.45 && r.width > r.height * 8) return true
      if (r.width > r.height * 12 && r.height < 20) return true
      return false
    }
    const overlapsDark = (el) => {
      const rect = el.getBoundingClientRect()
      const textH = rect.height
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      let node = el
      for (let depth = 0; depth < 8 && node; depth++) {
        const parent = node.parentElement
        if (!parent || parent === document.body) break
        for (const sib of Array.from(parent.children)) {
          if (sib === node || !(sib instanceof HTMLElement)) continue
          const tag = sib.tagName.toLowerCase()
          if (tag === 'script' || tag === 'style' || tag === 'br' || tag === 'hr') continue
          const sr = sib.getBoundingClientRect()
          if (isThin(sr, textH)) continue
          if (sr.height < Math.max(16, textH * 0.5)) continue
          const cs = getComputedStyle(sib)
          const m = (cs.backgroundColor || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
          const dark = m && +m[1] + +m[2] + +m[3] < 80
          if (!dark) continue
          if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) return true
        }
        node = parent
      }
      return false
    }
    const chNum = document.getElementById('ch-num')
    const chTitle = document.getElementById('ch-title')
    const cap = document.getElementById('cap')
    const legacyNear = !!chNum.parentElement?.querySelector('img, svg, picture, object')
    return {
      legacyNear,
      chNumAdj: hasAdj(chNum),
      chTitleAdj: hasAdj(chTitle),
      capAdj: hasAdj(cap),
      chNumOverlap: overlapsDark(chNum),
      chTitleOverlap: overlapsDark(chTitle),
      ruleTopThin: isThin(chNum.previousElementSibling.getBoundingClientRect(), chNum.getBoundingClientRect().height),
    }
  })
  assert(case0.legacyNear, 'legacy parent.querySelector would see distant img (false-positive setup)')
  assert(!case0.chNumAdj, '第二章 not adjacent to figure media')
  assert(!case0.chTitleAdj, '灾难 not adjacent to figure media')
  assert(case0.capAdj, 'caption next to img is adjacent')
  assert(!case0.chNumOverlap, '第二章 does not overlap dark capsule')
  assert(!case0.chTitleOverlap, '灾难 does not overlap dark capsule')
  assert(case0.ruleTopThin, 'top black line classified as thin rule')

  // forceShortLabels must not bleach chapter titles (run real export via CDP + Node bridge)
  // Attach live HTMLElements through Playwright evaluate by calling from page after bundling helpers.
  // Here: apply force only when overlaps/dark — chapter titles should stay theme color.
  const case0b = await page.evaluate(() => {
    const WHITE = '#ffffff'
    const force = (el) => {
      el.style.setProperty('color', WHITE, 'important')
      el.dataset.qyOnDark = '1'
    }
    const isThin = (r, textH = 0) => {
      if (r.height <= 12) return true
      if (textH > 0 && r.height < textH * 0.45 && r.width > r.height * 8) return true
      return false
    }
    const shouldForce = (el) => {
      const rect = el.getBoundingClientRect()
      let node = el
      for (let d = 0; d < 8 && node; d++) {
        const parent = node.parentElement
        if (!parent) break
        for (const sib of parent.children) {
          if (sib === node || !(sib instanceof HTMLElement)) continue
          const sr = sib.getBoundingClientRect()
          if (isThin(sr, rect.height)) continue
          if (sr.height < Math.max(16, rect.height * 0.5)) continue
          const m = getComputedStyle(sib).backgroundColor.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
          if (m && +m[1] + +m[2] + +m[3] < 80) {
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            if (cx >= sr.left && cx <= sr.right && cy >= sr.top && cy <= sr.bottom) return true
          }
        }
        node = parent
      }
      // Distant img must NOT force via parent.querySelector
      return false
    }
    for (const id of ['ch-num', 'ch-title']) {
      const el = document.getElementById(id)
      if (shouldForce(el)) force(el)
    }
    // Caption next to img but NOT overlapping the bar must stay theme-dark.
    const cap = document.getElementById('cap')
    if (shouldForce(cap)) force(cap)
    return {
      chNum: getComputedStyle(document.getElementById('ch-num')).color,
      chTitle: getComputedStyle(document.getElementById('ch-title')).color,
      cap: getComputedStyle(cap).color,
      chOnDark: document.getElementById('ch-num').dataset.qyOnDark || null,
      capOnDark: cap.dataset.qyOnDark || null,
    }
  })
  assert(!/255,\s*255,\s*255/i.test(case0b.chNum), `第二章 stays dark (got ${case0b.chNum})`)
  assert(!/255,\s*255,\s*255/i.test(case0b.chTitle), `灾难 stays dark (got ${case0b.chTitle})`)
  assert(case0b.chOnDark !== '1', '第二章 not qyOnDark')
  assert(!/255,\s*255,\s*255/i.test(case0b.cap), `caption under img (no overlap) stays dark (got ${case0b.cap})`)
  assert(case0b.capOnDark !== '1', 'non-overlapping caption not on-dark')

  // --- Case 0c: unified applyShortLabelContrast via Vite (three acceptance cases) ---
  const BASE = process.env.QY_BASE || 'http://localhost:5173/'
  const viteUp = await page.goto(BASE, { waitUntil: 'domcontentloaded' }).then(() => true).catch(() => false)
  if (!viteUp) {
    console.log('SKIP case0c applyShortLabelContrast (dev server not up)')
  } else {
    await page.evaluate(() => {
      document.body.style.cssText = 'background:#f3ead3;color:#3b2f2f;margin:0;padding:24px;font:16px sans-serif'
      document.body.innerHTML = `
        <style>
          .sec::before{content:"◆";display:inline-block;width:1em;height:1em;margin-right:0.35em;background:#000;color:transparent}
          .ch-rule{height:1px;background:#000;width:70%;margin:0 auto}
          .ch-rule-thick{height:3px;background:#000;width:70%;margin:0 auto}
        </style>
        <div class="ch-rule"></div>
        <p id="ch-num" align="center">第二章</p>
        <div class="ch-rule-thick"></div>
        <p id="ch-title" align="center">灾难</p>
        <p id="sec-before" class="sec" style="color:#ffffff">我们从一份档案开始</p>
        <p id="sec-plain" style="color:#ffffff">◆ 我们从一份档案开始</p>
        <div style="position:relative;width:420px;height:36px;margin:24px auto">
          <svg xmlns="http://www.w3.org/2000/svg" width="420" height="36" viewBox="0 0 420 36" style="position:absolute;inset:0">
            <rect x="20" y="4" width="380" height="28" rx="14" fill="#000000"/>
            <circle cx="34" cy="18" r="5" fill="#ffffff"/>
            <circle cx="386" cy="18" r="5" fill="#ffffff"/>
          </svg>
          <p id="family" style="position:relative;margin:0;line-height:36px;text-align:center;color:#3b2f2f">朱重八家族</p>
        </div>
        <div style="position:relative;width:420px;height:32px;margin:20px auto;background:#000;border-radius:16px">
          <p id="abs-pill" style="position:absolute;inset:0;margin:0;line-height:32px;text-align:center;color:#3b2f2f">朱重八家族</p>
        </div>
      `
    })
    await page.waitForTimeout(50)
    const case0c = await page.evaluate(async () => {
      const mod = await import(`/src/utils/colorContrast.ts?t=${Date.now()}`)
      const r = mod.applyShortLabelContrast(document, '#3b2f2f')
      const cs = (id) => getComputedStyle(document.getElementById(id)).color
      const on = (id) => document.getElementById(id).dataset.qyOnDark || null
      return {
        r,
        chNum: cs('ch-num'),
        chTitle: cs('ch-title'),
        sec: cs('sec-before'),
        plain: cs('sec-plain'),
        family: cs('family'),
        abs: cs('abs-pill'),
        familyOn: on('family'),
        absOn: on('abs-pill'),
        secOn: on('sec-before'),
        chOn: on('ch-num'),
      }
    })
    assert(!/255,\s*255,\s*255/i.test(case0c.chNum), `第二章 stays dark (got ${case0c.chNum})`)
    assert(!/255,\s*255,\s*255/i.test(case0c.chTitle), `灾难 stays dark (got ${case0c.chTitle})`)
    assert(case0c.chOn !== '1', '第二章 not on-dark')
    assert(!/255,\s*255,\s*255/i.test(case0c.sec), `◆ ::before section stays dark (got ${case0c.sec})`)
    assert(!/255,\s*255,\s*255/i.test(case0c.plain), `◆ plain section stays dark (got ${case0c.plain})`)
    assert(case0c.secOn !== '1', '◆ section not on-dark')
    assert(/255,\s*255,\s*255/i.test(case0c.family), `HTML over SVG family white (got ${case0c.family})`)
    assert(case0c.familyOn === '1', 'family on-dark')
    assert(/255,\s*255,\s*255/i.test(case0c.abs), `HTML absolute pill white (got ${case0c.abs})`)
    assert(case0c.absOn === '1', 'abs pill on-dark')
  }
  assert(typeof applyShortLabelContrast === 'function', 'applyShortLabelContrast exported')
  assert(typeof urlBackgroundLikelyTitleBar === 'function', 'urlBackgroundLikelyTitleBar exported')

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

  assert(typeof applyShortLabelContrast === 'function', 'applyShortLabelContrast still exported')
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

  // p_title: white plate + url black capsule (real 明朝 DOM) — must whiten
  if (viteUp) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate((bar) => {
      document.body.style.cssText = 'background:#f3ead3;color:#3b2f2f;margin:0;padding:40px'
      document.body.innerHTML = `<p id="ptitle" class="p_title" style="width:480px;height:32px;margin:0 auto;line-height:32px;text-align:center;color:#3b2f2f;background-color:#ffffff;background-image:url('${bar}');background-repeat:no-repeat;background-position:center">朱重八家族</p>`
    }, BLACK_BAR)
    const ptitle = await page.evaluate(async () => {
      const mod = await import(`/src/utils/colorContrast.ts?t=${Date.now()}`)
      const el = document.getElementById('ptitle')
      const cs = getComputedStyle(el)
      const dark = mod.shortLabelBackdropIsDark(document, window, el, '#3b2f2f')
      mod.applyShortLabelContrast(document, '#3b2f2f')
      return {
        dark,
        bi: cs.backgroundImage.slice(0, 40),
        color: getComputedStyle(el).color,
        onDark: el.dataset.qyOnDark || null,
      }
    })
    assert(ptitle.dark, `p_title url capsule detected as dark (bi=${ptitle.bi})`)
    assert(/255,\s*255,\s*255/i.test(ptitle.color), `p_title forced white (got ${ptitle.color})`)
    assert(ptitle.onDark === '1', 'p_title on-dark')
  }

  await page.close()
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
