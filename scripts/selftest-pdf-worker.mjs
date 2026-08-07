/**
 * Self-test PDF.js worker URL under Vite.
 * Usage (dev server already running on 5173):
 *   node scripts/selftest-pdf-worker.mjs
 */
const base = process.env.VITE_BASE || 'http://127.0.0.1:5173'

async function check(url, expectJsExport = false) {
  const res = await fetch(url)
  const text = await res.text()
  const ok =
    res.ok &&
    (expectJsExport
      ? /export\s+default\s+["'].*pdf\.worker/.test(text)
      : text.includes('Mozilla') || text.includes('pdfjs') || text.length > 100000)
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${url} status=${res.status} len=${text.length}` +
      (expectJsExport ? ` export=${/export default "[^"]+"/.exec(text)?.[0] || '?'}` : ''),
  )
  return ok
}

let all = true
all = (await check(`${base}/pdf.worker.min.mjs`)) && all
all = (await check(`${base}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`)) && all
all = (await check(`${base}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url`, true)) && all

// The broken path that caused "fake worker failed" — must NOT be required anymore.
const bad = await fetch(`${base}/pdf.worker.min.mjs?import`)
console.log(
  `INFO pdf.worker.min.mjs?import status=${bad.status} (expected fail/avoid; app must use ?url)`,
)

if (!all) {
  console.error('SELFTEST FAILED')
  process.exit(1)
}
console.log('SELFTEST OK — restart Vite if it was already running, then reopen the PDF')
