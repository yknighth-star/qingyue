/**
 * Manual self-test: EPUB curl turn front plate must carry readable text (not solid color).
 * Run: npx playwright test --config=playwright.epub-turn.config.ts
 * Or: node scripts/epub-turn-selftest.mjs
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const epubPath = path.join(root, 'fixtures', 'slide-test.epub')
const outDir = path.join(root, 'fixtures', 'selftest-turn')
fs.mkdirSync(outDir, { recursive: true })

const BASE = process.env.QY_BASE || 'http://localhost:5173/'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  if (!fs.existsSync(epubPath)) throw new Error(`missing ${epubPath}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)

  const logs = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(outDir, '01-shelf.png') })

  // Import EPUB via file input if present
  const fileInputs = page.locator('input[type=file]')
  const n = await fileInputs.count()
  if (n === 0) {
    // try open import UI
    const importBtn = page.getByRole('button', { name: /导入|添加|本地/ }).first()
    if (await importBtn.count()) await importBtn.click()
  }
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles(epubPath)
  await sleep(1500)
  await page.screenshot({ path: path.join(outDir, '02-after-import.png') })

  // Open first book card / link
  const book = page.locator('a[href*="/read"], .book-card, .shelf-card, [data-book-id]').first()
  if (await book.count()) {
    await book.click()
  } else {
    // click any title-like item
    await page.locator('main, .shelf, #app').locator('a, button').first().click()
  }
  await sleep(2500)
  await page.screenshot({ path: path.join(outDir, '03-reader.png') })

  // Ensure curl mode via settings store if possible
  await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('qingyue-settings')
      const obj = raw ? JSON.parse(raw) : {}
      obj.pageTurn = 'curl'
      localStorage.setItem('qingyue-settings', JSON.stringify(obj))
    } catch {
      /* */
    }
  })
  // Also try UI
  const tapCenter = async () => {
    const box = await page.locator('.reader-stage, .reader-page, #app').first().boundingBox()
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  await tapCenter()
  await sleep(400)
  const settingsBtn = page.getByRole('button', { name: /排版|设置/ }).first()
  if (await settingsBtn.count()) {
    await settingsBtn.click()
    await sleep(400)
    const curlOpt = page.getByText(/仿真/, { exact: false }).first()
    if (await curlOpt.count()) await curlOpt.click()
    await sleep(300)
    // close panel
    await tapCenter()
  }
  await sleep(800)
  await page.screenshot({ path: path.join(outDir, '04-curl-ready.png') })

  // Probe: build ghost via page function if exposed — else trigger next and inspect DOM
  const probe = await page.evaluate(async () => {
    const surface = document.querySelector('.epub-reader')
    if (!surface) return { ok: false, reason: 'no .epub-reader' }
    const iframe = surface.querySelector('iframe')
    const scroller = surface.querySelector('.epub-container')
    let iframeText = 0
    try {
      iframeText = (iframe?.contentDocument?.body?.textContent || '').replace(/\s+/g, '').length
    } catch {
      iframeText = -1
    }
    return {
      ok: true,
      hasIframe: !!iframe,
      iframeW: iframe?.offsetWidth || 0,
      iframeH: iframe?.offsetHeight || 0,
      scrollLeft: scroller?.scrollLeft ?? null,
      clientW: scroller?.clientWidth ?? null,
      iframeText,
      readerBg: getComputedStyle(surface).getPropertyValue('--reader-bg').trim(),
      surfaceFilter: surface.style.filter || getComputedStyle(surface).filter,
    }
  })
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2))

  // Hook MutationObserver to capture turn plate when it appears
  await page.evaluate(() => {
    window.__qyTurnProbe = { plates: [], maxText: 0 }
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return
          if (
            n.classList?.contains('page-epub-turn-paper') ||
            n.classList?.contains('page-epub-turn-cover') ||
            n.classList?.contains('page-slide-ghost')
          ) {
            const text = (n.textContent || '').replace(/\s+/g, '')
            window.__qyTurnProbe.plates.push({
              cls: n.className,
              textLen: text.length,
              textSample: text.slice(0, 40),
              bg: n.style.background || '',
            })
            window.__qyTurnProbe.maxText = Math.max(window.__qyTurnProbe.maxText, text.length)
            n.setAttribute('data-qy-probe', '1')
          }
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    window.__qyTurnMo = mo
  })

  // Trigger next via edge or engine
  const turned = await page.evaluate(async () => {
    // Prefer clicking right edge zone
    const edge = document.querySelector('.edge-zone.right')
    if (edge) {
      edge.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return 'edge-click'
    }
    // fallback: keyboard
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    return 'key'
  })
  // Mid-animation screenshots
  await sleep(80)
  await page.screenshot({ path: path.join(outDir, '05-turn-t80.png') })
  await sleep(120)
  await page.screenshot({ path: path.join(outDir, '06-turn-t200.png') })
  // Capture plate screenshot if present
  const plate = page.locator('[data-qy-probe="1"]').first()
  if (await plate.count()) {
    await plate.screenshot({ path: path.join(outDir, '07-plate.png') }).catch(() => {})
  }
  await sleep(500)
  await page.screenshot({ path: path.join(outDir, '08-after-turn.png') })

  const turnProbe = await page.evaluate(() => window.__qyTurnProbe)
  fs.writeFileSync(
    path.join(outDir, 'turn-probe.json'),
    JSON.stringify({ turned, probe, turnProbe, logs: logs.slice(-30) }, null, 2),
  )

  const maxText = turnProbe?.maxText ?? 0
  const usedCover = (turnProbe?.plates || []).some((p) => String(p.cls).includes('page-epub-turn-cover'))
  const usedPaper = (turnProbe?.plates || []).some((p) => String(p.cls).includes('page-epub-turn-paper'))

  console.log(JSON.stringify({ probe, turnProbe, turned, usedCover, usedPaper, maxText }, null, 2))

  await browser.close()

  if (usedCover && maxText < 12) {
    console.error('FAIL: solid color cover used without text')
    process.exit(2)
  }
  if (usedPaper && maxText < 12) {
    console.error('FAIL: paper plate present but almost no text')
    process.exit(3)
  }
  if (!usedPaper && !usedCover) {
    console.warn('WARN: no turn plate observed (animation may have been skipped)')
    // Not necessarily fail if plain swap — but for curl we expect a plate when clone works
  }
  if (usedPaper && maxText >= 12) {
    console.log('PASS: text-bearing turn plate observed')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
