/**
 * epub.js registers window "unload" for manager cleanup. Chrome's Permissions-Policy
 * now denies unload by default → console: "Permissions policy violation: unload…".
 * Rewrite those listeners to "pagehide" (bfcache-safe, still runs on real teardown).
 *
 * Only touches addEventListener("unload"…) — not section.unload() / hooks.unloaded.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const epubRoot = path.join(root, 'node_modules', 'epubjs')

const RE = /addEventListener\(\s*(["'])unload\1/g

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

if (!existsSync(epubRoot)) {
  console.log('[patch-epubjs-pagehide] epubjs not installed, skip')
  process.exit(0)
}

let patched = 0
for (const file of walk(epubRoot)) {
  const before = readFileSync(file, 'utf8')
  if (!RE.test(before)) continue
  RE.lastIndex = 0
  const after = before.replace(RE, 'addEventListener($1pagehide$1')
  if (after === before) continue
  writeFileSync(file, after)
  patched += 1
  console.log('[patch-epubjs-pagehide]', path.relative(root, file))
}

console.log(`[patch-epubjs-pagehide] done (${patched} file(s))`)
