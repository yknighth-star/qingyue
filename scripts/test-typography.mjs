/**
 * Self-test: EPUB/TXT typography settings (font size, family, line-height, margins).
 * Usage: node scripts/test-typography.mjs
 * Requires: npm run dev on http://127.0.0.1:5173
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'fixtures')
const epubPath = join(outDir, 'typo-test.epub')
const base = process.env.QY_BASE || 'http://localhost:5173'

async function buildHostileEpub() {
  const paras = Array.from({ length: 12 }, (_, i) => {
    return `<p class="content">排版测试段${i + 1}。字体字号行距段距边距应可被阅读器设置覆盖。</p>`
  }).join('\n')

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh">
<head>
  <title>排版测试</title>
  <meta charset="utf-8"/>
  <style>
    /* Simulate CN EPUB publisher CSS that used to beat body-only theme rules */
    body { font-size: 14px !important; font-family: simsun, serif !important; line-height: 1.2 !important; }
    p, .content { font-size: 14px !important; font-family: simsun, serif !important; line-height: 1.2 !important; margin: 0 0 0.2em !important; }
  </style>
</head>
<body>
  <h1>排版测试章</h1>
  ${paras}
</body>
</html>`

  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.folder('META-INF')?.file(
    'container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  )
  zip.folder('OEBPS')?.file(
    'content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>排版测试</dc:title>
    <dc:language>zh</dc:language>
    <dc:identifier id="uid">qingyue-typo-test</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`,
  )
  zip.folder('OEBPS')?.file('ch1.xhtml', chapter)
  zip.folder('OEBPS')?.file(
    'toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="qingyue-typo-test"/></head>
  <docTitle><text>排版测试</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>章</text></navLabel><content src="ch1.xhtml"/></navPoint>
  </navMap>
</ncx>`,
  )
  mkdirSync(outDir, { recursive: true })
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  writeFileSync(epubPath, buf)
  return epubPath
}

function approx(a, b, tol = 0.06) {
  return Math.abs(a - b) <= tol
}

async function readEpubMetrics(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.epub-reader')
    if (!host) return { error: 'no host' }
    const cs = getComputedStyle(host)
    const iframe = host.querySelector('iframe')
    const doc = iframe?.contentDocument
    const p = doc?.querySelector('p')
    const body = doc?.body
    if (!p || !body) return { error: 'no iframe content', hostPadX: cs.paddingLeft }
    const pcs = doc.defaultView.getComputedStyle(p)
    const bcs = doc.defaultView.getComputedStyle(body)
    return {
      hostPadX: parseFloat(cs.paddingLeft),
      hostPadY: parseFloat(cs.paddingTop),
      pFontSize: parseFloat(pcs.fontSize),
      pLineHeight: parseFloat(pcs.lineHeight) / parseFloat(pcs.fontSize),
      pMarginBottom: pcs.marginBottom,
      pFontFamily: pcs.fontFamily,
      bodyFontSize: parseFloat(bcs.fontSize),
      cssVarX: host.style.getPropertyValue('--reader-margin-x').trim(),
      cssVarSize: host.style.getPropertyValue('--reader-font-size').trim(),
    }
  })
}

async function patchSettings(page, patch) {
  await page.evaluate(async (p) => {
    // Pinia store is on the app; trigger via panel if present, else dispatch through open settings API
    const { useSettingsStore } = await import('/src/stores/settings.ts')
    const store = useSettingsStore()
    await store.update(p)
  }, patch)
  await page.waitForTimeout(450)
}

async function main() {
  await buildHostileEpub()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const fails = []

  try {
    await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(500)

    // Import EPUB via hidden file input on shelf
    const input = page.locator('input[type=file]').first()
    await input.setInputFiles(epubPath)
    await page.waitForTimeout(1200)

    // Open the book card titled 排版测试
    const card = page.getByText('排版测试', { exact: false }).first()
    await card.click({ timeout: 10000 })
    await page.waitForSelector('.epub-reader iframe', { timeout: 15000 })
    await page.waitForTimeout(800)

    const before = await readEpubMetrics(page)
    console.log('before', before)
    if (before.error) throw new Error(before.error)

    await patchSettings(page, {
      fontSize: 28,
      lineHeight: 2.2,
      paragraphGap: 1.6,
      marginX: 48,
      marginY: 36,
      fontFamily: 'Georgia, "Times New Roman", Times, serif',
      pageTurn: 'slide',
    })

    const after = await readEpubMetrics(page)
    console.log('after', after)

    if (!approx(after.pFontSize, 28, 1)) fails.push(`fontSize: got ${after.pFontSize}, want ~28`)
    if (!approx(after.pLineHeight, 2.2, 0.15)) fails.push(`lineHeight: got ${after.pLineHeight}, want ~2.2`)
    if (!approx(after.hostPadX, 48, 1)) fails.push(`marginX: host pad ${after.hostPadX}, want 48`)
    if (!approx(after.hostPadY, 36, 1)) fails.push(`marginY: host pad ${after.hostPadY}, want 36`)
    if (!/georgia/i.test(after.pFontFamily)) fails.push(`fontFamily: got ${after.pFontFamily}`)
    const mb = parseFloat(after.pMarginBottom)
    // 1.6em * 28px ≈ 44.8
    if (!approx(mb, 28 * 1.6, 4)) fails.push(`paragraphGap margin-bottom: got ${mb}, want ~${28 * 1.6}`)

    // Screenshot for manual glance
    await page.screenshot({ path: join(outDir, 'typo-after.png'), fullPage: false })

    if (fails.length) {
      console.error('FAIL\n' + fails.join('\n'))
      process.exitCode = 1
    } else {
      console.log('PASS typography settings apply on hostile EPUB CSS')
    }
  } catch (err) {
    console.error('ERROR', err)
    await page.screenshot({ path: join(outDir, 'typo-error.png') }).catch(() => {})
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
