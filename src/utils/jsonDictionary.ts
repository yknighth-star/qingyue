import type { DictionaryProvider, DictionaryResult } from './dictionary'

type LexEntry = { phonetic?: string; meanings: string[] }
type Lexicon = Record<string, LexEntry>

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'「」『』《》【】（）()[\]{}<>]+|[\s"'「」『』《》【】（）()[\]{}<>.,!?;:，。！？；：、]+$/g, '')
    .toLowerCase()
}

/** Longest-prefix match for CJK compounds against lexicon keys. */
function longestCjkMatch(text: string, lex: Lexicon): string | null {
  const max = Math.min(text.length, 8)
  for (let len = max; len >= 1; len--) {
    const slice = text.slice(0, len)
    if (lex[slice]) return slice
  }
  return null
}

export function createJsonDictionaryProvider(
  lex: Lexicon,
  name = '本地精简词库',
): DictionaryProvider {
  return {
    name,
    async lookup(word: string): Promise<DictionaryResult | null> {
      const raw = word.trim()
      if (!raw) return null
      const key = normalizeKey(raw)
      if (!key) return null

      let hit = lex[key] || lex[raw]
      let matched = key

      if (!hit && /[\u4e00-\u9fff]/.test(key)) {
        const cjk = longestCjkMatch(key, lex)
        if (cjk) {
          hit = lex[cjk]
          matched = cjk
        }
      }

      // English: try first token
      if (!hit && /^[a-z]/.test(key)) {
        const token = key.split(/[\s\-_/]+/)[0]
        if (lex[token]) {
          hit = lex[token]
          matched = token
        }
      }

      if (!hit?.meanings?.length) return null
      return {
        word: matched,
        phonetic: hit.phonetic,
        meanings: hit.meanings,
      }
    },
  }
}

let loadPromise: Promise<DictionaryProvider> | null = null

/** Lazy-load bundled mini lexicon (static import chunk). */
export async function loadMiniLexiconProvider(): Promise<DictionaryProvider> {
  if (!loadPromise) {
    loadPromise = import('@/data/lexicon-mini.json').then((mod) =>
      createJsonDictionaryProvider(mod.default as Lexicon, '本地精简词库'),
    )
  }
  return loadPromise
}
