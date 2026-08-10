/**
 * Self-test: dark figure-title bars get light text after theme wash.
 * Mirrors paintPublisherWashes + colorContrast helpers.
 * Run: node scripts/selftest-epub-dark-caption.mjs
 */
import { chromium } from 'playwright'
import {
  colorsFromBackgroundImage,
  contrastTextForBackground,
  isDarkDecorativeBackground,
  isFigureTitleLike,
  resolveSurfaceBackgroundCss,
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

// Unit: gradient / helpers
assert(isDarkDecorativeBackground('rgb(0,0,0)'), 'black dark')
assert(
  colorsFromBackgroundImage('linear-gradient(#000, #111)').length >= 2,
  'gradient colors extracted',
)
assert(
  colorsFromBackgroundImage('linear-gradient(#000, #111)').some((c) =>
    isDarkDecorativeBackground(c),
  ),
  'gradient has dark stop',
)
assert(!colorsFromBackgroundImage('url(foo.png)').length, 'url() ignored')

const light = contrastTextForBackground('#000', '#3b2f2f', '#f3ead3')
assert(light === '#f3ead3', `light on dark = themeBg (got ${light})`)

// Playwright: DOM wash simulation
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<!DOCTYPE html><html><body style="background:#f3ead3;color:#3b2f2f">
    <p id="bar" style="background-color:#000000;color:#ffffff;text-align:center">赈灾物品</p>
    <p id="grad" style="background-image:linear-gradient(#000,#222);color:#fff;text-align:center" class="fuming">标题条</p>
    <p id="normal">老百姓是不满意的</p>
    <div id="wrap" style="background:#000"><span id="inner">内层标题</span></div>
    <p id="pic"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmPIQAAAABJRU5ErkJggg==" width="10" height="10"/></p>
  </body></html>`)

  // Apply theme-like forced dark fg first (the bug)
  await page.evaluate(() => {
    document.querySelectorAll('p, span, div').forEach((el) => {
      el.style.setProperty('color', '#3b2f2f', 'important')
      el.style.setProperty('-webkit-text-fill-color', '#3b2f2f', 'important')
    })
  })

  const before = await page.evaluate(() => getComputedStyle(document.getElementById('bar')).color)
  assert(/59,\s*47,\s*47|3b2f2f/i.test(before) || before.includes('59'), `theme forced dark before wash (got ${before})`)

  // Inject wash logic mirroring engine (simplified using page-side helpers inlined)
  await page.evaluate(({ lightOnDark }) => {
    const isTransparent = (c) =>
      !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'rgba(0,0,0,0)'
    const parse = (input) => {
      const s = (input || '').trim().toLowerCase()
      if (s[0] === '#') {
        const hex = s.slice(1)
        if (hex.length === 6) {
          return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
          }
        }
      }
      const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
      if (!m) return null
      return { r: +m[1], g: +m[2], b: +m[3] }
    }
    const lum = (r, g, b) => {
      const lin = (c) => {
        const x = c / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const isDark = (c) => {
      if (isTransparent(c)) return false
      const rgb = parse(c)
      return rgb && lum(rgb.r, rgb.g, rgb.b) < 0.42
    }
    const colorsFromBi = (bi) => {
      if (!bi || bi === 'none' || (/url\(/i.test(bi) && !/gradient\(/i.test(bi))) return []
      return [...(bi.match(/#(?:[0-9a-f]{3,8})\b/gi) || []), ...(bi.match(/rgba?\([^)]+\)/gi) || [])]
    }
    const surfaceOf = (el) => {
      const cs = getComputedStyle(el)
      if (!isTransparent(cs.backgroundColor)) return cs.backgroundColor
      for (const c of colorsFromBi(cs.backgroundImage)) if (isDark(c)) return c
      return null
    }
    const apply = (el, color, onDark) => {
      el.style.setProperty('color', color, 'important')
      el.style.setProperty('-webkit-text-fill-color', color, 'important')
      if (onDark) el.dataset.qyOnDark = '1'
      else delete el.dataset.qyOnDark
    }
    const walk = (el, inherited, underDark) => {
      if (['img', 'svg', 'script', 'style'].includes(el.tagName.toLowerCase())) return
      const surface = surfaceOf(el)
      const dark = surface && isDark(surface)
      let next = inherited
      let nextDark = underDark
      if (dark) {
        next = lightOnDark
        nextDark = true
        apply(el, lightOnDark, true)
      } else if (underDark) {
        apply(el, inherited, true)
      } else {
        apply(el, inherited, false)
      }
      for (const c of el.children) if (c instanceof HTMLElement) walk(c, next, nextDark)
    }
    for (const c of document.body.children) if (c instanceof HTMLElement) walk(c, '#3b2f2f', false)
  }, { lightOnDark: light })

  const afterBar = await page.evaluate(() => {
    const el = document.getElementById('bar')
    return { color: getComputedStyle(el).color, onDark: el.dataset.qyOnDark, text: el.textContent }
  })
  const afterGrad = await page.evaluate(() => {
    const el = document.getElementById('grad')
    return { color: getComputedStyle(el).color, onDark: el.dataset.qyOnDark }
  })
  const afterInner = await page.evaluate(() => {
    const el = document.getElementById('inner')
    return { color: getComputedStyle(el).color, onDark: el.dataset.qyOnDark }
  })
  const afterNormal = await page.evaluate(() => getComputedStyle(document.getElementById('normal')).color)

  const isLight = (c) => {
    const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
    if (!m) return false
    return +m[1] + +m[2] + +m[3] > 400
  }

  assert(afterBar.onDark === '1' && isLight(afterBar.color), `black bar light text (got ${JSON.stringify(afterBar)})`)
  assert(afterGrad.onDark === '1' && isLight(afterGrad.color), `gradient bar light text (got ${JSON.stringify(afterGrad)})`)
  assert(isLight(afterInner.color), `nested on black inherits light (got ${JSON.stringify(afterInner)})`)
  assert(!isLight(afterNormal), `body text stays dark (got ${afterNormal})`)

  // resolveSurfaceBackgroundCss in node can't use DOM; skip. Title-like heuristic:
  await page.evaluate(() => {
    window.__titleLike = (sel) => {
      const el = document.querySelector(sel)
      const cls = el.className || ''
      const tag = el.tagName.toLowerCase()
      if (tag === 'figcaption') return true
      if (/fuming|caption|title/i.test(cls)) return true
      const align = (el.getAttribute('align') || el.style.textAlign || '').toLowerCase()
      const text = (el.textContent || '').replace(/\s+/g, '').trim()
      return text.length > 0 && text.length <= 24 && /center/i.test(align)
    }
  })
  const titleLike = await page.evaluate(() => ({
    bar: window.__titleLike('#bar'),
    grad: window.__titleLike('#grad'),
    normal: window.__titleLike('#normal'),
  }))
  assert(titleLike.bar, 'centered short bar is title-like')
  assert(titleLike.grad, 'fuming class is title-like')
  assert(!titleLike.normal, 'long body text not title-like')

  await page.close()
} finally {
  await browser.close()
}

// Node helpers still imported for tree-shaking sanity
assert(typeof resolveSurfaceBackgroundCss === 'function', 'resolveSurfaceBackgroundCss exported')
assert(typeof isFigureTitleLike === 'function', 'isFigureTitleLike exported')

if (failed) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
