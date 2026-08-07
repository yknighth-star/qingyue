import { createTts, pickVoice, voiceIdOf } from '@/utils/tts'
import type { TtsApi } from '../types'

export function createWebTtsApi(): TtsApi {
  return {
    create: createTts,
    voiceIdOf,
    pickVoice,
  }
}
