/** Pluggable dictionary provider slot */

export interface DictionaryResult {
  word: string
  phonetic?: string
  meanings: string[]
}

export interface DictionaryProvider {
  name: string
  lookup(word: string): Promise<DictionaryResult | null>
}

/** Built-in stub — replace with local JSON lexicon later */
export const stubDictionary: DictionaryProvider = {
  name: '本地词典（占位）',
  async lookup(word: string) {
    const w = word.trim()
    if (!w) return null
    return {
      word: w,
      meanings: ['（词典接口已预留，可接入本地 JSON 词库）'],
    }
  },
}

let active: DictionaryProvider = stubDictionary

export function setDictionaryProvider(p: DictionaryProvider) {
  active = p
}

export function getDictionaryProvider() {
  return active
}
