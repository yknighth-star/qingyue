/**
 * Real-book visual check in Chromium (not unit fixtures).
 * Imports 《明朝那些事儿》, finds 「朱重八家族」node, screenshots + asserts white-on-black.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QY_BASE || 'http://localhost:5173/'
const OUT = path.resolve('scripts/_visual-ming-out')
fs.mkdirSync(OUT, { recursive: true })

const EPUB =
  process.env.QY_MING_EPUB ||
  'F:\\01知识库\\书籍\\网文小说\\明朝那些事儿（图文增补版）-明朝那些事儿（图文增补版）（套装全9册） - 当年明月.epub'

let failed = false
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    failed = true
  } else console.log('PASS', msg)
}

assert(fs.existsSync(EPUB), `epub exists: ${EPUB}`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
page.setDefaultTimeout(120000)

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  // Prefer already-on-shelf book to avoid re-importing the huge epub every run.
  let card = page.getByText('明朝那些事儿').first()
  if ((await card.count()) === 0) {
    console.log('NOTE importing epub…')
    await page.locator('input[type="file"][accept*="epub"]').first().setInputFiles(EPUB)
    await page.waitForTimeout(8000)
    card = page.getByText('明朝那些事儿').first()
  }
  assert((await card.count()) > 0, 'book on shelf')
  await card.click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: path.join(OUT, 'A-open.png') })

  // Open search UI if present
  for (const label of ['搜索', '查找']) {
    const b = page.getByRole('button', { name: label }).or(page.getByText(label, { exact: true })).first()
    if ((await b.count()) > 0) {
      await b.click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }
  const search = page.locator('input[type="search"], input[placeholder*="搜"], input[placeholder*="找"]').first()
  if ((await search.count()) > 0) {
    await search.fill('朱重八家族')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
    // click first hit if any
    const hit = page.getByText('朱重八家族').first()
    if ((await hit.count()) > 0) await hit.click().catch(() => {})
    await page.waitForTimeout(2000)
  }

  async function inspect() {
    for (const f of page.frames()) {
      try {
        const data = await f.evaluate(() => {
          const needle = '朱重八家族'
          const body = document.body
          if (!body) return null
          if (!(body.innerText || '').includes(needle) && !body.querySelector('svg')) return null

          const hits = []
          const pushEl = (el, text) => {
            if (!el) return
            const r = el.getBoundingClientRect()
            if (r.width < 2 || r.height < 2) return
            // Prefer tight boxes — skip near-full-page wrappers
            if (r.width > window.innerWidth * 0.95 && r.height > window.innerHeight * 0.6) return
            const cs = getComputedStyle(el)
            hits.push({
              tag: el.tagName.toLowerCase(),
              text: (text || el.textContent || '').replace(/\s+/g, '').slice(0, 24),
              color: cs.color,
              fill: el.style.fill || el.getAttribute('fill') || cs.fill || '',
              webkitFill: cs.webkitTextFillColor || '',
              onDark: el.dataset?.qyOnDark || el.getAttribute('data-qy-on-dark') || null,
              rect: {
                x: Math.round(r.left),
                y: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
              },
              inSvg: !!el.closest('svg'),
            })
          }

          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          let n
          while ((n = walk.nextNode())) {
            if (!(n.textContent || '').includes(needle)) continue
            let el = n.parentElement
            // climb to the smallest element whose trimmed text is short (title leaf)
            while (el && el.parentElement && el.parentElement !== body) {
              const t = (el.textContent || '').replace(/\s+/g, '')
              if (t === needle || (t.includes(needle) && t.length <= 24)) break
              if (t.length > 48) break
              el = el.parentElement
            }
            pushEl(el, needle)
          }

          document.querySelectorAll('svg text').forEach((t) => {
            if ((t.textContent || '').includes(needle) || (t.textContent || '').includes('朱重八')) {
              pushEl(t, t.textContent || '')
            }
          })

          // Path glyphs on dark bands: sample SVG title bands
          const svgBands = []
          document.querySelectorAll('svg').forEach((svg, idx) => {
            const sr = svg.getBoundingClientRect()
            if (sr.width < 80 || sr.height < 20) return
            const dark = []
            const lightPaths = []
            svg.querySelectorAll('rect,path,polygon').forEach((sh) => {
              const fillAttr = (sh.getAttribute('fill') || '').toLowerCase()
              let fillCs = ''
              try {
                fillCs = getComputedStyle(sh).fill
              } catch {
                /* */
              }
              const styleFill = sh.style.fill || ''
              const onDark = sh.getAttribute('data-qy-on-dark')
              const isLight =
                /255,\s*255,\s*255|#fff|ffffff/i.test(styleFill + fillCs) || onDark === '1'
              const isDark =
                fillAttr === '#000' ||
                fillAttr === '#000000' ||
                fillAttr === 'black' ||
                /rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(fillCs)
              try {
                const b = sh.getBBox()
                if (isDark && b.width >= sr.width * 0.25 && b.height <= Math.max(40, sr.height * 0.45)) {
                  dark.push({
                    tag: sh.tagName,
                    w: Math.round(b.width),
                    h: Math.round(b.height),
                    y: Math.round(b.y),
                    fill: fillAttr || fillCs,
                  })
                }
                // small path glyphs near top band
                if (b.height <= 28 && b.width <= 40 && b.y <= sr.height * 0.45) {
                  lightPaths.push({
                    fill: styleFill || fillCs || fillAttr,
                    onDark,
                    isLight,
                    isDark,
                    y: Math.round(b.y),
                    w: Math.round(b.width),
                    h: Math.round(b.height),
                  })
                }
              } catch {
                /* */
              }
            })
            if (dark.length || lightPaths.some((p) => p.isDark || p.isLight)) {
              svgBands.push({
                idx,
                w: Math.round(sr.width),
                h: Math.round(sr.height),
                x: Math.round(sr.left),
                y: Math.round(sr.top),
                dark: dark.slice(0, 6),
                glyphs: lightPaths.slice(0, 20),
                texts: Array.from(svg.querySelectorAll('text'))
                  .map((t) => ({
                    t: (t.textContent || '').slice(0, 20),
                    fill: t.style.fill || t.getAttribute('fill'),
                    on: t.getAttribute('data-qy-on-dark'),
                  }))
                  .slice(0, 10),
              })
            }
          })

          return {
            theme: !!document.getElementById('qingyue-theme'),
            marked: body.dataset.qyWashMarked || null,
            hits,
            svgBands,
            hasNeedle: (body.innerText || '').includes(needle),
          }
        })
        if (data && (data.hasNeedle || data.hits.length || data.svgBands.length)) {
          return { frame: f, data }
        }
      } catch {
        /* */
      }
    }
    return null
  }

  let found = await inspect()
  if (!found?.data?.hasNeedle) {
    console.log('NOTE hunting pages for 朱重八家族…')
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(280)
      found = await inspect()
      if (found?.data?.hasNeedle && (found.data.hits.length || found.data.svgBands.length)) {
        console.log('NOTE found after', i + 1, 'turns')
        break
      }
      if (i % 15 === 14) await page.screenshot({ path: path.join(OUT, `hunt-${i}.png`) })
    }
  }

  fs.writeFileSync(path.join(OUT, 'inspect.json'), JSON.stringify(found?.data || null, null, 2))
  console.log('NOTE inspect summary', {
    theme: found?.data?.theme,
    marked: found?.data?.marked,
    hits: found?.data?.hits?.length,
    svgBands: found?.data?.svgBands?.length,
    hasNeedle: found?.data?.hasNeedle,
  })
  console.log('NOTE hits', JSON.stringify(found?.data?.hits?.slice(0, 8), null, 2))
  console.log('NOTE svgBands', JSON.stringify(found?.data?.svgBands?.slice(0, 3), null, 2))

  await page.screenshot({ path: path.join(OUT, 'B-page.png') })

  assert(!!found?.data?.hasNeedle, 'page contains 朱重八家族')

  const familyHits = (found.data.hits || []).filter((h) => (h.text || '').includes('朱重八家族'))
  const whitened = familyHits.find((h) => h.onDark === '1' || /255,\s*255,\s*255/i.test(`${h.color} ${h.webkitFill}`))
  const titleHit = whitened || familyHits.find((h) => h.h <= 40) || familyHits[0]
  console.log('NOTE familyHits', familyHits.length, 'whitened', !!whitened)

  if (titleHit) {
    console.log('NOTE titleHit', titleHit)
    const isWhite = /255,\s*255,\s*255|#fff|ffffff/i.test(
      `${titleHit.color} ${titleHit.fill} ${titleHit.webkitFill}`,
    )
    // Clip around the whitened leaf if possible
    const clipHit = whitened || titleHit
    const shot = await found.frame
      .locator('body')
      .screenshot({
        clip: {
          x: Math.max(0, Math.min(clipHit.rect.x, 2000)),
          y: Math.max(0, clipHit.rect.y - 10),
          width: Math.min(600, clipHit.rect.w + 40),
          height: Math.min(80, Math.max(36, clipHit.rect.h + 20)),
        },
      })
      .catch(() => null)
    if (shot) {
      fs.writeFileSync(path.join(OUT, 'C-title-clip.png'), shot)
      const px = await page.evaluate(async (b64) => {
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
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        let light = 0
        let blackish = 0
        for (let i = 0; i < d.length; i += 4) {
          const L = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255
          if (L > 0.72) light++
          else if (L < 0.2) blackish++
        }
        return { light, blackish, w: c.width, h: c.height, n: d.length / 4 }
      }, shot.toString('base64'))
      console.log('NOTE title clip pixels', px)
      assert(px.blackish > 20, `title clip has black capsule (blackish=${px.blackish})`)
      assert(px.light > 8, `title clip has light glyphs (light=${px.light})`)
    }
    assert(
      !!whitened || isWhite,
      `朱重八家族 whitened (got hits=${JSON.stringify(familyHits.map((h) => ({ c: h.color, on: h.onDark, h: h.h })))})`,
    )
  } else if (found.data.svgBands.length) {
    // Path-glyph diagram: require some glyphs lightened on dark bands
    const band = found.data.svgBands[0]
    const lightGlyphs = (band.glyphs || []).filter((g) => g.isLight).length
    const darkGlyphs = (band.glyphs || []).filter((g) => g.isDark && !g.isLight).length
    console.log('NOTE path glyphs light/dark', lightGlyphs, darkGlyphs)
    assert(band.dark.length > 0, 'svg has dark title band')
    assert(lightGlyphs > 0 || (band.texts || []).some((t) => /fff|255/i.test(t.fill || '')), 'glyphs/text on band are light')
  } else {
    assert(false, 'found title hit or svg band for 朱重八家族')
  }

  // ◆ section if on same chapter
  const sec = await found.frame.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walk.nextNode())) {
      const t = (n.textContent || '').replace(/\s+/g, '')
      if (t.includes('我们从一份档案开始') || t.includes('档案开始')) {
        const el = n.parentElement
        return { color: getComputedStyle(el).color, onDark: el.dataset?.qyOnDark || null, text: t.slice(0, 20) }
      }
    }
    return null
  })
  if (sec) {
    console.log('NOTE sec', sec)
    assert(!/255,\s*255,\s*255/i.test(sec.color), `◆ section stays dark (got ${sec.color})`)
  }
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nREAL BROWSER CHECK FAILED — see scripts/_visual-ming-out/')
  process.exit(1)
}
console.log('\nREAL BROWSER CHECK OK')
