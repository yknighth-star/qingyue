/** 仿真翻页（竞品同款思路）：书脊铰链翻折 → 换页 → 新页落定 */

const CURL_CLASSES = [
  'curl-out-next',
  'curl-out-prev',
  'curl-in-next',
  'curl-in-prev',
  'curl-hold',
] as const

/** 对齐市面阅读器：整段约 0.7s，偏干脆 */
const OUT_MS = 380
const IN_MS = 300

function wait(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms))
}

export async function playCurlOut(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove(...CURL_CLASSES)
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'curl-out-next' : 'curl-out-prev')
  await wait(OUT_MS)
  // 换页瞬间保持不可见，避免复位闪一下
  el.classList.add('curl-hold')
  el.classList.remove('curl-out-next', 'curl-out-prev')
}

export async function playCurlIn(el: HTMLElement | null, dir: 'next' | 'prev'): Promise<void> {
  if (!el) return
  el.classList.remove('curl-hold', 'curl-out-next', 'curl-out-prev', 'curl-in-next', 'curl-in-prev')
  void el.offsetWidth
  el.classList.add(dir === 'next' ? 'curl-in-next' : 'curl-in-prev')
  await wait(IN_MS)
  el.classList.remove(...CURL_CLASSES)
}
