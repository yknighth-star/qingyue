/** Web Speech TTS with voice / pitch / sentence pacing */

export interface SpeakOptions {
  rate?: number
  pitch?: number
  /** Stored id from voiceIdOf(); empty → auto-pick */
  voiceURI?: string
  lang?: string
}

export interface TtsController {
  speak(text: string, opts?: SpeakOptions | number, onDone?: () => void): void
  stop(): void
  pause(): void
  resume(): void
  isSpeaking(): boolean
  getVoices(): SpeechSynthesisVoice[]
  listVoicesSorted(): SpeechSynthesisVoice[]
  onVoicesChanged(cb: () => void): () => void
}

type Chunk = { text: string; pauseAfter: number }

/**
 * Prefer lang+name — voiceURI is often empty, unstable, or unsafe in <option value>.
 * Also accepts legacy `uri:…` / `name:…` ids from earlier builds.
 */
export function voiceIdOf(v: SpeechSynthesisVoice): string {
  return `${v.lang}::${v.name}`
}

export function splitSpeechChunks(text: string): Chunk[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const chunks: Chunk[] = []
  const re = /[^。！？!?…；;\n，、,：:]+[。！？!?…；;\n，、,：:]?/g
  const parts = normalized.match(re) || [normalized]

  for (const raw of parts) {
    const t = raw.trim()
    if (!t) continue
    const last = t.slice(-1)
    let pauseAfter = 120
    if ('。！？!?…'.includes(last)) pauseAfter = 380
    else if ('；;'.includes(last)) pauseAfter = 260
    else if ('，、,：:'.includes(last)) pauseAfter = 160

    if (t.length > 180) {
      for (let i = 0; i < t.length; i += 160) {
        const slice = t.slice(i, i + 160).trim()
        if (!slice) continue
        const isLast = i + 160 >= t.length
        chunks.push({ text: slice, pauseAfter: isLast ? pauseAfter : 100 })
      }
    } else {
      chunks.push({ text: t, pauseAfter })
    }
  }

  return chunks
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const name = `${v.name} ${v.voiceURI}`.toLowerCase()
  const lang = v.lang.toLowerCase()
  let s = 0
  if (lang.startsWith('zh')) s += 100
  if (/zh-cn|zh_cn|cmn-hans|cmn_hans/.test(lang)) s += 25
  if (/neural|natural|online|premium|enhanced|wavenet|studio/.test(name)) s += 40
  if (/xiaoxiao|xiaoyi|yunxi|yunyang|huihui|kangkang|yaoyao/.test(name)) s += 15
  // Prefer local — remote voices often fail after cancel() or offline
  if (v.localService) s += 30
  return s
}

export function pickVoice(voiceId?: string): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  if (voiceId) {
    const hit = resolveVoiceId(voices, voiceId)
    if (hit) return hit
  }

  return [...voices].sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null
}

function resolveVoiceId(voices: SpeechSynthesisVoice[], voiceId: string): SpeechSynthesisVoice | null {
  // Current format: lang::name
  const byLangName = voices.find((v) => voiceIdOf(v) === voiceId)
  if (byLangName) return byLangName

  if (voiceId.includes('::')) {
    const idx = voiceId.indexOf('::')
    const lang = voiceId.slice(0, idx)
    const name = voiceId.slice(idx + 2)
    const hit = voices.find((v) => v.lang === lang && v.name === name)
    if (hit) return hit
    // lang variants zh-CN vs zh_CN
    const loose = voices.find(
      (v) => v.name === name && v.lang.replace(/_/g, '-').toLowerCase() === lang.replace(/_/g, '-').toLowerCase(),
    )
    if (loose) return loose
  }

  // Legacy formats
  if (voiceId.startsWith('uri:')) {
    const uri = voiceId.slice(4)
    const hit = voices.find((v) => v.voiceURI === uri)
    if (hit) return hit
  }
  if (voiceId.startsWith('name:')) {
    const rest = voiceId.slice(5)
    const [lang, ...nameParts] = rest.split('||')
    const name = nameParts.join('||')
    const hit = voices.find((v) => v.lang === lang && v.name === name)
    if (hit) return hit
  }

  return voices.find((v) => v.voiceURI === voiceId || v.name === voiceId) || null
}

export function createTts(): TtsController {
  let active = false
  let generation = 0
  let queueTimer: number | null = null
  let startTimer: number | null = null

  function clearTimers() {
    if (queueTimer != null) {
      window.clearTimeout(queueTimer)
      queueTimer = null
    }
    if (startTimer != null) {
      window.clearTimeout(startTimer)
      startTimer = null
    }
  }

  function hardStopSynth() {
    clearTimers()
    if (!window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
  }

  function speakChunk(
    chunk: Chunk,
    opts: {
      rate: number
      pitch: number
      lang: string
      voiceURI?: string
      /** After a voice failure, speak with lang only */
      forceDefault?: boolean
    },
    gen: number,
    onChunkDone: (err?: boolean) => void,
  ) {
    if (!window.speechSynthesis || gen !== generation) {
      onChunkDone(true)
      return
    }

    const u = new SpeechSynthesisUtterance(chunk.text)
    u.rate = opts.rate
    u.pitch = opts.pitch

    let usedVoice: SpeechSynthesisVoice | null = null
    if (!opts.forceDefault) {
      usedVoice = pickVoice(opts.voiceURI)
      if (usedVoice) {
        // Assign voice only — setting lang alongside breaks some Chrome builds
        u.voice = usedVoice
      } else {
        u.lang = opts.lang
      }
    } else {
      u.lang = opts.lang
    }

    const last = chunk.text.trim().slice(-1)
    if (last === '？' || last === '?') u.pitch = Math.min(2, opts.pitch * 1.08)
    else if (last === '！' || last === '!') u.pitch = Math.min(2, opts.pitch * 1.04)

    let settled = false
    const done = (err?: boolean) => {
      if (settled || gen !== generation) return
      settled = true
      onChunkDone(err)
    }

    u.onstart = () => {
      if (gen === generation) active = true
    }
    u.onend = () => done(false)
    u.onerror = (ev) => {
      if (gen !== generation || settled) return
      const typ = (ev as SpeechSynthesisErrorEvent).error
      if (typ === 'interrupted' || typ === 'canceled') {
        done(true)
        return
      }
      // Selected / auto voice failed → retry once with lang only (still audible)
      if (!opts.forceDefault) {
        settled = true
        speakChunk(chunk, { ...opts, forceDefault: true }, gen, onChunkDone)
        return
      }
      done(true)
    }

    try {
      // Chromium can stay paused after cancel and then produce silence
      if (window.speechSynthesis.paused) window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
    } catch {
      if (!opts.forceDefault && !settled) {
        settled = true
        speakChunk(chunk, { ...opts, forceDefault: true }, gen, onChunkDone)
        return
      }
      done(true)
    }
  }

  function speakQueue(chunks: Chunk[], opts: SpeakOptions, gen: number, onDone?: () => void) {
    let i = 0
    const rate = opts.rate ?? 1
    const pitch = opts.pitch ?? 1
    const lang = opts.lang ?? 'zh-CN'
    const voiceURI = opts.voiceURI || undefined

    const finish = () => {
      if (gen !== generation) return
      active = false
      clearTimers()
      onDone?.()
    }

    const next = () => {
      if (gen !== generation) {
        finish()
        return
      }
      if (i >= chunks.length) {
        finish()
        return
      }
      const chunk = chunks[i++]
      active = true
      speakChunk(chunk, { rate, pitch, lang, voiceURI }, gen, (err) => {
        if (gen !== generation) return
        if (err) {
          finish()
          return
        }
        if (i >= chunks.length) {
          finish()
          return
        }
        queueTimer = window.setTimeout(() => {
          queueTimer = null
          next()
        }, chunk.pauseAfter)
      })
    }

    next()
  }

  function beginSpeak(text: string, opts: SpeakOptions, onDone?: () => void) {
    const trimmed = (text || '').trim()
    if (!trimmed || !window.speechSynthesis) {
      onDone?.()
      return
    }

    const gen = ++generation
    hardStopSynth()

    const chunks = splitSpeechChunks(trimmed)
    if (!chunks.length) {
      onDone?.()
      return
    }

    active = true

    const start = () => {
      if (gen !== generation) return
      const voices = window.speechSynthesis.getVoices()
      if (!voices.length) {
        const once = () => {
          window.speechSynthesis.removeEventListener('voiceschanged', once)
          if (gen !== generation) return
          speakQueue(chunks, opts, gen, onDone)
        }
        window.speechSynthesis.addEventListener('voiceschanged', once)
        startTimer = window.setTimeout(() => {
          startTimer = null
          window.speechSynthesis.removeEventListener('voiceschanged', once)
          if (gen === generation) speakQueue(chunks, opts, gen, onDone)
        }, 600)
        return
      }
      speakQueue(chunks, opts, gen, onDone)
    }

    // cancel() then immediate speak often drops audio on Chromium
    startTimer = window.setTimeout(() => {
      startTimer = null
      start()
    }, 40)
  }

  return {
    speak(text, optsOrRate = {}, onDone) {
      const opts: SpeakOptions =
        typeof optsOrRate === 'number' ? { rate: optsOrRate } : optsOrRate || {}
      beginSpeak(text, opts, onDone)
    },

    stop() {
      generation += 1
      active = false
      hardStopSynth()
    },

    pause() {
      window.speechSynthesis?.pause()
    },

    resume() {
      window.speechSynthesis?.resume()
    },

    isSpeaking() {
      return active || Boolean(window.speechSynthesis?.speaking) || queueTimer != null || startTimer != null
    },

    getVoices() {
      return window.speechSynthesis?.getVoices() ?? []
    },

    listVoicesSorted() {
      const voices = window.speechSynthesis?.getVoices() ?? []
      const zh = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'))
      const pool = zh.length ? zh : voices
      return [...pool].sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name, 'zh'))
    },

    onVoicesChanged(cb) {
      if (!window.speechSynthesis) return () => {}
      const handler = () => cb()
      window.speechSynthesis.addEventListener('voiceschanged', handler)
      void window.speechSynthesis.getVoices()
      return () => window.speechSynthesis.removeEventListener('voiceschanged', handler)
    },
  }
}
