/**
 * Theme CSS must beat publisher `.class { color/background !important }`.
 * Run: node scripts/selftest-epub-theme-specificity.mjs
 */
import { chromium } from 'playwright'

const THEMES = {
  light: { bg: '#f7f7f5', fg: '#1c1c1c' },
  dark: { bg: '#12141a', fg: '#e8e6e3' },
  sepia: { bg: '#f3ead3', fg: '#3b2f2f' },
  green: { bg: '#c7e0c7', fg: '#1f2e1f' },
}

function themeCss(bg, fg) {
  const textSel = ['p', 'div', 'span', 'a', 'figcaption', 'caption', 'cite']
    .flatMap((t) => [`html body ${t}`, `html body ${t}[class]`, `html body ${t}[style]`])
    .join(',\n')
  const fillSel = ['p', 'div', 'figcaption']
    .flatMap((t) => [`html body ${t}`, `html body ${t}[class]`, `html body ${t}[style]`])
    .join(',\n')
  return `
html body, html body[class] {
  background-color: ${bg} !important;
  color: ${fg} !important;
  -webkit-text-fill-color: ${fg} !important;
}
${textSel} {
  color: ${fg} !important;
  -webkit-text-fill-color: ${fg} !important;
}
${fillSel} {
  background-color: ${bg} !important;
}
html body figcaption,
html body [class*="caption"] {
  color: ${fg} !important;
  -webkit-text-fill-color: ${fg} !important;
  opacity: 1 !important;
}
html body :has(> img):not(body) {
  background-color: transparent !important;
  color: ${fg} !important;
}
`.trim()
}

/** Old broken rule using :where (zero specificity). */
function themeCssWhere(bg, fg) {
  return `
html body { background-color: ${bg} !important; color: ${fg} !important; }
html body :where(p, div, span, a) { color: ${fg} !important; }
`.trim()
}

const publisher = `
body.kindle { background-color: #1a3a2a !important; color: #e8ffe8 !important; }
p.calibre { color: #e8ffe8 !important; background-color: #1a3a2a !important; }
div.main { background-color: #1a3a2a !important; color: #e8ffe8 !important; }
figcaption.cap, p.caption { color: #999999 !important; opacity: 0.55 !important; }
`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

async function measure(themeName, cssBuilder) {
  const { bg, fg } = THEMES[themeName]
  await page.setContent(`<!DOCTYPE html><html><head>
<style>${publisher}</style>
<style id="qingyue-theme">${cssBuilder(bg, fg)}</style>
</head>
<body class="kindle">
  <div class="main"><p class="calibre" id="t">hello</p></div>
  <div class="wrap"><img id="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="20" height="20"/></div>
  <figure><img width="20" height="20" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"/><figcaption class="cap" id="fc">图题</figcaption></figure>
  <p class="caption" id="pc">图注灰字</p>
</body></html>`)
  return page.evaluate(() => {
    const p = document.getElementById('t')
    const wrap = document.querySelector('.wrap')
    const fc = document.getElementById('fc')
    const pc = document.getElementById('pc')
    const pcs = getComputedStyle(p)
    const bcs = getComputedStyle(document.body)
    const wcs = getComputedStyle(wrap)
    const fcs = getComputedStyle(fc)
    const pccs = getComputedStyle(pc)
    return {
      bodyBg: bcs.backgroundColor,
      bodyFg: bcs.color,
      pBg: pcs.backgroundColor,
      pFg: pcs.color,
      wrapBg: wcs.backgroundColor,
      figFg: fcs.color,
      figOpacity: fcs.opacity,
      capFg: pccs.color,
      capOpacity: pccs.opacity,
    }
  })
}

function approx(cssColor, hex) {
  // parse rgb(r,g,b)
  const m = String(cssColor).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!m) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return Math.abs(+m[1] - r) <= 2 && Math.abs(+m[2] - g) <= 2 && Math.abs(+m[3] - b) <= 2
}

let failed = false

// Show :where loses
const whereSepia = await measure('sepia', themeCssWhere)
if (approx(whereSepia.pFg, THEMES.sepia.fg)) {
  console.log('NOTE: :where unexpectedly beat publisher on this engine')
} else {
  console.log('PASS diagnostic: :where loses to publisher .calibre color', whereSepia.pFg)
}

for (const name of Object.keys(THEMES)) {
  const m = await measure(name, themeCss)
  const { bg, fg } = THEMES[name]
  const ok =
    approx(m.bodyBg, bg) &&
    approx(m.pBg, bg) &&
    approx(m.pFg, fg) &&
    approx(m.figFg, fg) &&
    approx(m.capFg, fg) &&
    Number(m.figOpacity) >= 0.99 &&
    Number(m.capOpacity) >= 0.99
  // Img sits above wrapper fill — theme bg on wrap is acceptable (must not hide bitmap).
  if (!ok) {
    console.error(`FAIL ${name}`, m, { expectBg: bg, expectFg: fg })
    failed = true
  } else {
    console.log(`PASS ${name} beats publisher .calibre + gray captions (bg=${m.pBg}, fg=${m.pFg})`)
  }
}

await browser.close()
if (failed) {
  console.error('SELFTEST FAILED')
  process.exit(1)
}
console.log('SELFTEST OK')
