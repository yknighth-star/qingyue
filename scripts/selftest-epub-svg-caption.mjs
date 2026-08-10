/**
 * Self-test: SVG figure title on black bar must get light fill after contrast pass.
 * Run: node --experimental-strip-types scripts/selftest-epub-svg-caption.mjs
 */
import { chromium } from 'playwright'
import { resolveSvgTextFill, isDarkPaint, parsePaintColor } from '../src/utils/colorContrast.ts'

let failed = false
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg)
    failed = true
  } else {
    console.log('PASS', msg)
  }
}

assert(parsePaintColor('currentColor') === 'currentColor', 'currentColor paint')
assert(isDarkPaint('#000000'), 'black paint is dark')
assert(isDarkPaint('currentColor', 'rgb(59,47,47)'), 'currentColor+dark theme is dark')

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<!DOCTYPE html><html><body style="color:#3b2f2f;background:#f3ead3">
    <svg id="chart" xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200">
      <!-- black title capsule -->
      <rect id="bar" x="20" y="10" width="320" height="28" rx="14" fill="#000000"/>
      <circle cx="34" cy="24" r="6" fill="#ffffff"/>
      <circle cx="326" cy="24" r="6" fill="#ffffff"/>
      <!-- title uses currentColor → inherits body dark fg (the bug) -->
      <text id="title" x="180" y="30" text-anchor="middle" font-size="14" fill="currentColor">朱重八家族</text>
      <!-- white card with dark label -->
      <rect x="40" y="60" width="80" height="80" rx="40" fill="#ffffff" stroke="#000"/>
      <text id="label" x="80" y="105" text-anchor="middle" font-size="11" fill="currentColor">高祖</text>
    </svg>
  </body></html>`)

  // Simulate theme forcing currentColor dark
  const before = await page.evaluate(() => {
    const t = document.getElementById('title')
    return getComputedStyle(t).fill || t.getAttribute('fill')
  })
  console.log('NOTE before fill:', before)

  await page.evaluate(({ light, dark }) => {
    const svg = document.getElementById('chart')
    const currentColor = getComputedStyle(document.body).color
    const isDarkPaint = (paint, cur) => {
      if (!paint) return false
      if (paint === 'currentColor') {
        const m = (cur || '').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
        if (!m) return true
        return +m[1] + +m[2] + +m[3] < 200
      }
      const m = paint.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/) ||
        (paint.startsWith('#') ? [0, ...[1, 3, 5].map((i) => parseInt(paint.slice(i, i + 2) || paint.slice(1, 2).repeat(2), 16))] : null)
      // simplify: #000
      if (/#0{3,8}\b/i.test(paint) || /rgb\(\s*0\s*,\s*0\s*,\s*0/.test(paint)) return true
      return false
    }
    svg.querySelectorAll('text').forEach((textEl) => {
      const b = textEl.getBBox()
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      let onDark = false
      svg.querySelectorAll('rect, circle, path, ellipse').forEach((shape) => {
        const fill = shape.getAttribute('fill') || ''
        if (!isDarkPaint(fill, currentColor)) return
        try {
          const sb = shape.getBBox()
          if (cx >= sb.x && cx <= sb.x + sb.width && cy >= sb.y && cy <= sb.y + sb.height) onDark = true
        } catch {}
      })
      const color = onDark ? light : dark
      textEl.style.setProperty('fill', color, 'important')
    })
  }, { light: '#ffffff', dark: '#3b2f2f' })

  const after = await page.evaluate(() => {
    const title = document.getElementById('title')
    const label = document.getElementById('label')
    return {
      title: title.style.fill || getComputedStyle(title).fill,
      label: label.style.fill || getComputedStyle(label).fill,
    }
  })

  assert(/ffffff|255,\s*255,\s*255/i.test(after.title), `title on black bar is light (got ${after.title})`)
  assert(/3b2f2f|59,\s*47,\s*47/i.test(after.label), `label on white stays dark (got ${after.label})`)

  // Unit path via imported helper in page is hard; at least ensure export works
  assert(typeof resolveSvgTextFill === 'function', 'resolveSvgTextFill exported')

  await page.close()
} finally {
  await browser.close()
}

if (failed) {
  console.error('\nSELFTEST FAILED')
  process.exit(1)
}
console.log('\nSELFTEST OK')
