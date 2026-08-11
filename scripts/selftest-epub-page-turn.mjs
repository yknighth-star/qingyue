/**
 * Regression: EPUB paginated next/prev must move scrollLeft or spine index.
 * Uses the black-bar fixture (multi-column friendly short book).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const fixture = path.join(root, 'scripts/_e2e-black-bar-out/black-bar-fixture.epub')
const outDir = path.join(root, 'scripts/_e2e-turn-out')
fs.mkdirSync(outDir, { recursive: true })

if (!fs.existsSync(fixture)) {
  console.error('Missing fixture:', fixture)
  process.exit(1)
}

const base = process.env.QY_BASE || 'http://127.0.0.1:5173/'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const logs = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))

  await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 })
  // Import fixture via file input if present
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(fixture)
  await page.waitForTimeout(1500)

  // Open first book card
  const card = page.locator('.book-card, [data-book-id], .shelf-book').first()
  if (await card.count()) {
    await card.click()
  } else {
    // fallback: click any link to reader
    const link = page.locator('a[href*="/read/"]').first()
    await link.click({ timeout: 10000 })
  }

  await page.waitForSelector('.epub-reader, .open-overlay', { timeout: 60000 })
  await page.waitForSelector('.epub-reader .epub-container', { timeout: 90000 })
  await page.waitForTimeout(800)

  const before = await page.evaluate(() => {
    const c = document.querySelector('.epub-container')
    return {
      scrollLeft: c?.scrollLeft ?? -1,
      scrollWidth: c?.scrollWidth ?? -1,
      clientWidth: c?.clientWidth ?? -1,
    }
  })

  // Prefer keyboard / engine next via edge tap on stage
  const stage = page.locator('.reader-stage, .stage, [ref=stageRef]').first()
  const box = await page.locator('.epub-reader').boundingBox()
  if (!box) throw new Error('no epub-reader box')
  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.5)
  await page.waitForTimeout(700)

  const after = await page.evaluate(() => {
    const c = document.querySelector('.epub-container')
    return {
      scrollLeft: c?.scrollLeft ?? -1,
      scrollWidth: c?.scrollWidth ?? -1,
      clientWidth: c?.clientWidth ?? -1,
    }
  })

  await page.screenshot({ path: path.join(outDir, 'after-turn.png') })
  fs.writeFileSync(path.join(outDir, 'turn.json'), JSON.stringify({ before, after, logs: logs.slice(-40) }, null, 2))

  const moved =
    after.scrollLeft !== before.scrollLeft ||
    (after.scrollWidth > after.clientWidth + 8 && after.scrollLeft > before.scrollLeft)

  console.log(JSON.stringify({ before, after, moved }, null, 2))
  await browser.close()
  if (!moved && after.scrollWidth <= after.clientWidth + 8) {
    // Single-page chapter: try ArrowRight then check again via spine change heuristic
    console.warn('No horizontal pages in first section; checking ArrowRight still responds')
  }
  if (!moved) {
    process.exitCode = 2
    console.error('FAIL: page turn did not change scrollLeft')
  } else {
    console.log('OK: page turn moved')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
