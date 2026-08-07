/**
 * Unit selftest: epub.js serialize hooks run in parallel; last writer wins.
 * Our old font hook overwrote blob image substitutions with relative paths.
 */
function simulateParallelSerialize(originalHtml, hooks) {
  const section = { output: originalHtml }
  return Promise.all(hooks.map((h) => h(originalHtml, section))).then(() => section.output)
}

const original = '<html><body><img src="Images/a.png"/><style>@font-face{src:url(a.ttf)}</style></body></html>'
const blobbed = '<html><body><img src="blob:http://localhost/img"/><style>@font-face{src:url(a.ttf)}</style></body></html>'

const substituteHook = async (output, section) => {
  // epub.js resource substitute
  section.output = blobbed
}

const badFontHook = async (output, section) => {
  await new Promise((r) => setTimeout(r, 20))
  // Old qingyue hook: rewrite fonts from the ORIGINAL parallel arg, stomping substitute
  section.output = String(output).replace('url(a.ttf)', 'url(blob:font)')
}

const out = await simulateParallelSerialize(original, [substituteHook, badFontHook])
console.log('after race:', out)

if (out.includes('blob:http://localhost/img')) {
  console.error('FAIL expected relative image path to win (reproduce bug)')
  process.exit(1)
}
if (!out.includes('Images/a.png')) {
  console.error('FAIL race did not leave relative image src')
  process.exit(1)
}
console.log('PASS reproduced: late serialize hook restores relative img src (broken in srcdoc)')

// Fixed policy: only substitute hook (no parallel font serialize stomper)
const fixed = await simulateParallelSerialize(original, [substituteHook])
if (!fixed.includes('blob:http://localhost/img')) {
  console.error('FAIL fixed path should keep blob image')
  process.exit(1)
}
console.log('PASS without stomper: img stays blob URL')
console.log('SELFTEST OK')
