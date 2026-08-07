/**
 * Download offline Tesseract language packs (tessdata_fast) into public/tessdata.
 * Safe to re-run; skips existing files.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const OUT = path.resolve('public/tessdata')
const LANGS = ['eng', 'chi_sim']
// tessdata_fast — smaller, good enough for search OCR
const BASE =
  'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0'

mkdirSync(OUT, { recursive: true })

async function fetchOne(lang) {
  const dest = path.join(OUT, `${lang}.traineddata`)
  if (existsSync(dest) && statSync(dest).size > 100_000) {
    console.log('skip', lang, `(${Math.round(statSync(dest).size / 1024)} KB)`)
    return
  }
  const url = `${BASE}/${lang}.traineddata`
  console.log('fetch', url)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${lang}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  console.log('saved', dest, Math.round(statSync(dest).size / 1024), 'KB')
}

for (const lang of LANGS) {
  await fetchOne(lang)
}
console.log('tessdata ready')
