/**
 * Prove epubjs paginated next() moves scrollLeft with full blobUrl replacements.
 * Also builds a long-text fixture so there are multiple column pages.
 */
import { chromium } from 'playwright'
import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const epubjsEntry = pathToFileURL(require.resolve('epubjs/dist/epub.min.js')).href
const outDir = path.resolve('scripts/_e2e-turn-out')
fs.mkdirSync(outDir, { recursive: true })

async function buildLongEpub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.folder('META-INF').file(
    'container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  const paras = Array.from({ length: 80 }, (_, i) => `<p>第${i + 1}段。轻阅分页自测文字，用于验证左右翻页能否推进。重复填充内容保证多栏多页。一二三四五六七八九十。</p>`).join('\n')
  zip.folder('OEBPS').file(
    'content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>翻页夹具</dc:title><dc:language>zh</dc:language>
    <dc:identifier id="uid">qy-turn-fixture</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`,
  )
  zip.folder('OEBPS').file(
    'chap1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>
<style>body{margin:0;font-size:18px;line-height:1.7;padding:12px}</style>
</head><body>${paras}</body></html>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

const html = `<!doctype html><html><body>
<div id="host" style="width:360px;height:640px;border:1px solid #ccc"></div>
<script src="${epubjsEntry}"></script>
<script>
window.__run = async (buf) => {
  const book = ePub(buf, { replacements: 'blobUrl' })
  await book.opened
  await book.ready
  const host = document.getElementById('host')
  const rendition = book.renderTo(host, { width: '100%', height: '100%', flow: 'paginated', overflow: 'hidden' })
  await rendition.display()
  await new Promise(r => setTimeout(r, 300))
  const c = host.querySelector('.epub-container')
  const before = { left: c.scrollLeft, sw: c.scrollWidth, cw: c.clientWidth }
  await rendition.next()
  await new Promise(r => setTimeout(r, 400))
  const after = { left: c.scrollLeft, sw: c.scrollWidth, cw: c.clientWidth }
  book.destroy()
  return { before, after, moved: after.left !== before.left }
}
</script>
</body></html>`

const pagePath = path.join(outDir, 'harness.html')
fs.writeFileSync(pagePath, html)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const buf = await buildLongEpub()
await page.goto(pathToFileURL(pagePath).href)
const result = await page.evaluate(async (arr) => {
  const u8 = Uint8Array.from(arr)
  return window.__run(u8.buffer)
}, [...buf])
fs.writeFileSync(path.join(outDir, 'epubjs-turn.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await browser.close()
if (!result.moved) {
  console.error('FAIL: epubjs blobUrl next() did not move')
  process.exit(2)
}
console.log('OK: epubjs blobUrl next() moves scrollLeft')
