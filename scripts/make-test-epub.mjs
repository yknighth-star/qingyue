/**
 * Build a minimal multi-page EPUB for local reader testing.
 * Usage: node scripts/make-test-epub.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'fixtures')
const outPath = join(outDir, 'slide-test.epub')

const paragraphs = Array.from({ length: 40 }, (_, i) => {
  const n = i + 1
  return `<p>第${n}段。少年姓陈，名平安，父母早亡，寄人篱下。借此驱赶蛇蝎，用桃枝敲敲打打，试图让院落干净一些。被发现坐在一张小竹椅子上打盹，少年勉强填饱肚子，前几天听说几条街外开了新书肆。翻页测试标记 ALPHA-${n} 接续 BETA-${n}。</p>`
}).join('\n')

const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh">
<head>
  <title>翻页测试</title>
  <meta charset="utf-8"/>
</head>
<body>
  <h1>卷一 第一章 测试</h1>
  ${paragraphs}
</body>
</html>
`

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
    <dc:title>翻页测试</dc:title>
    <dc:language>zh</dc:language>
    <dc:identifier id="uid">qingyue-slide-test</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>`,
)
zip.folder('OEBPS')?.file('ch1.xhtml', chapter)
zip.folder('OEBPS')?.file(
  'toc.ncx',
  `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="qingyue-slide-test"/></head>
  <docTitle><text>翻页测试</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="ch1.xhtml"/></navPoint>
  </navMap>
</ncx>`,
)

mkdirSync(outDir, { recursive: true })
const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
writeFileSync(outPath, buf)
console.log('wrote', outPath, buf.length)
