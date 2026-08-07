import { computed, ref } from 'vue'
import { getPlatform } from '@/platform'
import { useSettingsStore } from '@/stores/settings'

export function useReaderTts(opts: {
  flashStatus: (msg: string) => void
  getSpeakText: () => string
  clearSelectionBar?: () => void
  openTtsPanel: () => void
}) {
  const platform = getPlatform()
  const settingsStore = useSettingsStore()
  const tts = platform.tts.create()
  const ttsSpeaking = ref(false)
  const ttsVoices = ref<SpeechSynthesisVoice[]>([])
  let unsubTtsVoices: (() => void) | null = null
  let ttsLongPressTimer: number | null = null
  let ttsLongPressFired = false

  const settings = computed(() => settingsStore.settings)

  const ttsVoiceLabel = computed(() => {
    const id = settings.value.ttsVoiceURI
    if (!id) return '自动（优选中文神经语音）'
    const hit = ttsVoices.value.find((v) => platform.tts.voiceIdOf(v) === id)
    return hit ? `${hit.name} (${hit.lang})` : '自动（优选中文神经语音）'
  })

  function voiceOptionLabel(v: SpeechSynthesisVoice) {
    const neural = /neural|natural|online|premium|enhanced|wavenet|studio/i.test(v.name)
    const tag = neural ? ' ★' : v.localService ? ' · 本地' : ''
    return `${v.name} · ${v.lang}${tag}`
  }

  function ttsSpeakOpts() {
    return {
      rate: settings.value.ttsRate,
      pitch: settings.value.ttsPitch,
      voiceURI: settings.value.ttsVoiceURI || undefined,
    }
  }

  function refreshTtsVoices() {
    ttsVoices.value = tts.listVoicesSorted()
    const id = settingsStore.settings.ttsVoiceURI
    if (!id) return
    if (ttsVoices.value.some((v) => platform.tts.voiceIdOf(v) === id)) return
    const found = platform.tts.pickVoice(id)
    void settingsStore.update({ ttsVoiceURI: found ? platform.tts.voiceIdOf(found) : '' })
  }

  function mountVoices() {
    refreshTtsVoices()
    unsubTtsVoices = tts.onVoicesChanged(refreshTtsVoices)
  }

  function unmountVoices() {
    unsubTtsVoices?.()
    unsubTtsVoices = null
    tts.stop()
    if (ttsLongPressTimer) {
      window.clearTimeout(ttsLongPressTimer)
      ttsLongPressTimer = null
    }
  }

  async function onTtsVoiceChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value
    void settingsStore.update({ ttsVoiceURI: value })
    settingsStore.settings.ttsVoiceURI = value
    const sample = opts.getSpeakText().trim().slice(0, 40) || '你好，这是当前朗读音色的试听。'
    ttsSpeaking.value = true
    opts.flashStatus('试听新音色…')
    tts.speak(
      sample,
      {
        rate: settings.value.ttsRate,
        pitch: settings.value.ttsPitch,
        voiceURI: value || undefined,
      },
      () => {
        ttsSpeaking.value = false
        opts.flashStatus('试听结束')
      },
    )
  }

  function speakSelection() {
    const text = opts.getSpeakText()
    if (!text.trim()) {
      opts.flashStatus('没有可朗读的内容，请先选中文字或打开有正文的页面')
      return
    }
    ttsSpeaking.value = true
    opts.flashStatus('正在朗读…')
    tts.speak(text, ttsSpeakOpts(), () => {
      ttsSpeaking.value = false
      opts.flashStatus('朗读结束')
    })
  }

  function stopReadingAloud() {
    const wasSpeaking = tts.isSpeaking() || ttsSpeaking.value
    const wasScrolling = settings.value.autoScrollSpeed > 0
    tts.stop()
    ttsSpeaking.value = false
    if (wasScrolling) {
      void settingsStore.update({ autoScrollSpeed: 0 })
    }
    if (wasSpeaking || wasScrolling) {
      opts.flashStatus(
        wasSpeaking && wasScrolling
          ? '已停止朗读并关闭自动滚屏'
          : wasSpeaking
            ? '已停止朗读'
            : '已关闭自动滚屏',
      )
    } else {
      opts.flashStatus('当前没有在朗读')
    }
  }

  function toggleTtsPlay() {
    if (tts.isSpeaking() || ttsSpeaking.value) {
      stopReadingAloud()
      return
    }
    opts.clearSelectionBar?.()
    speakSelection()
  }

  function onTtsPlayPointerDown() {
    ttsLongPressFired = false
    if (ttsLongPressTimer) window.clearTimeout(ttsLongPressTimer)
    ttsLongPressTimer = window.setTimeout(() => {
      ttsLongPressTimer = null
      ttsLongPressFired = true
      opts.openTtsPanel()
    }, 450)
  }

  function onTtsPlayPointerUp() {
    if (ttsLongPressTimer) {
      window.clearTimeout(ttsLongPressTimer)
      ttsLongPressTimer = null
    }
  }

  function onTtsPlayPointerCancel() {
    if (ttsLongPressTimer) {
      window.clearTimeout(ttsLongPressTimer)
      ttsLongPressTimer = null
    }
  }

  function onTtsPlayClick(e: Event) {
    if (ttsLongPressFired) {
      e.preventDefault()
      ttsLongPressFired = false
      return
    }
    toggleTtsPlay()
  }

  return {
    tts,
    ttsSpeaking,
    ttsVoices,
    ttsVoiceLabel,
    voiceIdOf: platform.tts.voiceIdOf,
    voiceOptionLabel,
    mountVoices,
    unmountVoices,
    onTtsVoiceChange,
    speakSelection,
    stopReadingAloud,
    toggleTtsPlay,
    onTtsPlayPointerDown,
    onTtsPlayPointerUp,
    onTtsPlayPointerCancel,
    onTtsPlayClick,
  }
}
