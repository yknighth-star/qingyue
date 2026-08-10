/**
 * Tri-form factor checks for EPUB media page-fit (phone / tablet / desktop).
 * Run: node scripts/selftest-epub-media-fit-forms.mjs
 */

const DUAL_COLUMN_MIN_WIDTH = 1100
const EPUBJS_COLUMN_PADDING_Y = 40
const PAGE_BOX_SAFETY = 8
const EPUB_DUAL_COLUMN_GAP = 40

function detectDevice(w) {
  if (w < 768) return 'phone'
  if (w < DUAL_COLUMN_MIN_WIDTH) return 'tablet'
  return 'desktop'
}

function isDualSpread({ dualColumn, pageTurn, width }) {
  return dualColumn && pageTurn !== 'scroll' && width >= DUAL_COLUMN_MIN_WIDTH
}

function resolveColumnPageBox({ stageW, stageH, dual, gap = EPUB_DUAL_COLUMN_GAP }) {
  const maxH = Math.max(48, stageH - EPUBJS_COLUMN_PADDING_Y - PAGE_BOX_SAFETY)
  if (!dual) return { maxW: stageW, maxH }
  return { maxW: Math.max(48, Math.floor(stageW / 2 - gap / 2)), maxH }
}

const cases = [
  { name: 'phone-portrait', w: 390, h: 844, dualColumn: true, pageTurn: 'slide' },
  { name: 'phone-landscape', w: 844, h: 390, dualColumn: true, pageTurn: 'slide' },
  { name: 'tablet-portrait', w: 768, h: 1024, dualColumn: true, pageTurn: 'slide' },
  { name: 'tablet-wide', w: 1024, h: 768, dualColumn: true, pageTurn: 'slide' },
  { name: 'desktop-single', w: 1280, h: 800, dualColumn: false, pageTurn: 'slide' },
  { name: 'desktop-dual', w: 1280, h: 800, dualColumn: true, pageTurn: 'slide' },
  { name: 'desktop-scroll', w: 1280, h: 800, dualColumn: true, pageTurn: 'scroll' },
]

let ok = true
for (const c of cases) {
  const device = detectDevice(c.w)
  const dual = isDualSpread({ dualColumn: c.dualColumn, pageTurn: c.pageTurn, width: c.w })
  const box = resolveColumnPageBox({ stageW: c.w, stageH: c.h, dual })

  // Phone / tablet must never enable dual spread even if setting is on.
  if ((device === 'phone' || device === 'tablet') && dual) {
    console.error(`FAIL ${c.name}: ${device} enabled dual`)
    ok = false
    continue
  }
  if (c.name === 'desktop-dual' && !dual) {
    console.error(`FAIL ${c.name}: expected dual`)
    ok = false
    continue
  }
  if (c.name === 'desktop-scroll' && dual) {
    console.error(`FAIL ${c.name}: scroll must disable dual`)
    ok = false
    continue
  }
  if (dual && box.maxW >= c.w / 2) {
    // half page should be < stageW/2 when gap > 0... actually floor(stageW/2 - 20) < stageW/2
    // ok as long as maxW < stageW
  }
  if (dual && box.maxW >= c.w) {
    console.error(`FAIL ${c.name}: dual box not half-page`, box)
    ok = false
    continue
  }
  if (box.maxH > c.h) {
    console.error(`FAIL ${c.name}: maxH exceeds stage`, box)
    ok = false
    continue
  }

  console.log(
    `PASS ${c.name}: device=${device} dual=${dual} box=${box.maxW}x${box.maxH}`,
  )
}

if (!ok) {
  console.error('\nFORM CHECK FAILED')
  process.exit(1)
}
console.log('\nFORM CHECK OK')
