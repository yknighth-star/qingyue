import fs from 'node:fs'
import { execSync } from 'node:child_process'

const mono = execSync('git show b3f5eb0:src/styles/main.css', { encoding: 'utf8' })

const patched = mono.replace(
  `.pdf-bookmark-flag {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #c4a574;
  color: #1a1f2e;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}`,
  `.pdf-bookmark-flag {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #c4a574;
  color: #1a1f2e;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  z-index: 3;
}

.pdf-text-layer mark.annot {
  color: transparent;
  border-radius: 2px;
  mix-blend-mode: multiply;
}`,
)

const lines = patched.split(/\n/)

function lineOf(pred) {
  let depth = 0
  let inComment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match section starts before counting this line's braces
    if (depth === 0 && !inComment && pred(line.trim(), i)) return i

    let j = 0
    while (j < line.length) {
      if (!inComment && line[j] === '/' && line[j + 1] === '*') {
        inComment = true
        j += 2
        continue
      }
      if (inComment && line[j] === '*' && line[j + 1] === '/') {
        inComment = false
        j += 2
        continue
      }
      if (!inComment) {
        if (line[j] === '{') depth++
        else if (line[j] === '}') depth = Math.max(0, depth - 1)
      }
      j++
    }
  }
  throw new Error('line not found: ' + pred.toString())
}

const names = [
  'tokens.css',
  'base.css',
  'shelf.css',
  'reader.css',
  'engines.css',
  'panels.css',
  'curl.css',
]

const sectionStarts = [
  0,
  lineOf((t) => t.startsWith('.app-shell')),
  lineOf((t) => t.startsWith('.shelf-toolbar')),
  lineOf((t) => t === '.reader-page {'),
  lineOf((t) => t.startsWith('.txt-reader,')),
  lineOf((t) => t === '.panel {'),
  lineOf((t) => t.includes('仿真翻页')),
]

for (let i = 0; i < names.length; i++) {
  const a = sectionStarts[i]
  const b = i + 1 < sectionStarts.length ? sectionStarts[i + 1] : lines.length
  const body = lines.slice(a, b).join('\n').replace(/\s+$/, '') + '\n'
  let d = 0
  let inComment = false
  for (let k = 0; k < body.length; k++) {
    const ch = body[k]
    const next = body[k + 1]
    if (!inComment && ch === '/' && next === '*') {
      inComment = true
      k++
      continue
    }
    if (inComment && ch === '*' && next === '/') {
      inComment = false
      k++
      continue
    }
    if (!inComment) {
      if (ch === '{') d++
      else if (ch === '}') d--
    }
  }
  if (d !== 0) {
    console.error(names[i], 'brace imbalance', d, 'lines', a + 1, '-', b)
    process.exit(1)
  }
  fs.writeFileSync(`src/styles/${names[i]}`, body)
  console.log(names[i], b - a, 'lines')
}

fs.writeFileSync(
  'src/styles/main.css',
  [
    '/* Qingyue styles — split for maintainability */',
    "@import './tokens.css';",
    "@import './base.css';",
    "@import './shelf.css';",
    "@import './reader.css';",
    "@import './engines.css';",
    "@import './panels.css';",
    "@import './curl.css';",
    '',
  ].join('\n'),
)

for (const f of ['main.full.css']) {
  try {
    fs.unlinkSync(`src/styles/${f}`)
  } catch {
    /* */
  }
}
console.log('ok')
