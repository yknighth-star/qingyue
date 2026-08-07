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

/** Built-in stub — used until mini lexicon finishes loading */
export const stubDictionary: DictionaryProvider = {
  name: '本地词典（加载中）',
  async lookup(word: string) {
    const w = word.trim()
    if (!w) return null
    return {
      word: w,
      meanings: ['词库加载中，请稍后重试'],
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

/** Format popup text from a lookup result */
export function formatDictionaryResult(res: DictionaryResult): string {
  const ph = res.phonetic ? ` ${res.phonetic}` : ''
  return `${res.word}${ph}：${res.meanings.join('；')}`
}
