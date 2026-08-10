/**
 * Quick node assert for colorContrast helpers (no playwright).
 * Run: node --experimental-strip-types scripts/selftest-color-contrast.mjs
 * or: npx tsx scripts/selftest-color-contrast.mjs
 */
import {
  colorsFromBackgroundImage,
  contrastTextForBackground,
  isDarkDecorativeBackground,
  isFigureTitleLike,
  parseCssColor,
  relativeLuminance,
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

const black = parseCssColor('rgb(0, 0, 0)')
assert(black && relativeLuminance(black.r, black.g, black.b) < 0.01, 'black luminance ~0')

assert(isDarkDecorativeBackground('rgb(0, 0, 0)'), 'black is decorative dark')
assert(isDarkDecorativeBackground('#111111'), '#111 is decorative dark')
assert(!isDarkDecorativeBackground('#f3ead3'), 'sepia bg is not dark')

const onBlack = contrastTextForBackground('rgb(0, 0, 0)', '#3b2f2f', '#f3ead3')
assert(onBlack === '#ffffff', `dark bar → pure white text (got ${onBlack})`)

const onLight = contrastTextForBackground('#f3ead3', '#3b2f2f', '#f3ead3')
assert(onLight === '#3b2f2f', `light surface → theme fg (got ${onLight})`)

const onTransparent = contrastTextForBackground('rgba(0, 0, 0, 0)', '#3b2f2f', '#f3ead3')
assert(onTransparent === null, 'transparent → inherit')

const grad = colorsFromBackgroundImage('linear-gradient(to bottom, #000000, #222222)')
assert(grad.length >= 2, `gradient stops extracted (got ${grad.join(',')})`)
assert(grad.some((c) => isDarkDecorativeBackground(c)), 'gradient has dark stop')

assert(!colorsFromBackgroundImage('url("cover.png")').length, 'plain url() ignored')

if (failed) {
  console.error('SELFTEST FAILED')
  process.exit(1)
}
console.log('SELFTEST OK')
void isFigureTitleLike

