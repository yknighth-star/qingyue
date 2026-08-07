import { toRaw } from 'vue'

/** Strip Vue proxies so IndexedDB structured-clone can store the value. */
function deepToRaw<T>(value: T): T {
  const v = toRaw(value as object) as T
  if (Array.isArray(v)) {
    return v.map((item) => deepToRaw(item)) as T
  }
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v)
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        out[key] = deepToRaw(val)
      }
      return out as T
    }
  }
  return v
}

/**
 * Prepare a plain data value for IDB put/update.
 * Prefer structuredClone; fall back to JSON for odd host objects.
 * Do not use for Blobs / FileSystemHandle.
 */
export function cloneForIdb<T>(value: T): T {
  const raw = deepToRaw(value)
  try {
    return structuredClone(raw)
  } catch {
    return JSON.parse(JSON.stringify(raw)) as T
  }
}
