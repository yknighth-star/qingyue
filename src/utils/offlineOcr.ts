import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import { compactCjkGaps } from '@/utils/searchText'

export type OcrProgress = {
  page: number
  total: number
  status: string
}

let workerPromise: Promise<Worker> | null = null
/** Bumped on terminate so in-flight createWorker discards the result. */
let workerGen = 0

function assetBase() {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** Absolute URL so Worker importScripts works under any base path. */
function absUrl(pathFromRoot: string) {
  const path = pathFromRoot.replace(/^\//, '')
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(`${assetBase()}${path}`, window.location.origin).href
  }
  return `${assetBase()}${path}`
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

/** Rejects when signal aborts (or immediately if already aborted). */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

/** Lazy singleton Tesseract worker — Simplified Chinese, fully local assets. */
export function getOcrWorker(signal?: AbortSignal): Promise<Worker> {
  throwIfAborted(signal)

  if (!workerPromise) {
    const gen = workerGen
    workerPromise = (async () => {
      // chi_sim only: eng+chi often emits noisy "Detected N diacritics" on Chinese scans
      const worker = await createWorker('chi_sim', OEM.LSTM_ONLY, {
        workerPath: absUrl('ocr-runtime/worker.min.js'),
        corePath: absUrl('ocr-runtime/tesseract-core-simd-lstm.js'),
        langPath: absUrl('tessdata').replace(/\/$/, ''),
        gzip: false,
        workerBlobURL: false,
        logger: () => {
          /* suppress tesseract.js progress logs */
        },
      })
      if (gen !== workerGen) {
        try {
          await worker.terminate()
        } catch {
          /* */
        }
        throw abortError()
      }
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      if (gen !== workerGen) {
        try {
          await worker.terminate()
        } catch {
          /* */
        }
        throw abortError()
      }
      return worker
    })().catch((err) => {
      if (workerPromise && gen === workerGen) workerPromise = null
      throw err
    })
  }

  const pending = workerPromise
  if (!signal) return pending
  return Promise.race([pending, whenAborted(signal)])
}

export async function recognizeImage(
  image: HTMLCanvasElement | Blob | string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)

  const run = async () => {
    const worker = await getOcrWorker(signal)
    throwIfAborted(signal)
    const { data } = await worker.recognize(image)
    throwIfAborted(signal)
    return normalizeOcrText(data.text || '')
  }

  const runP = run()
  // Avoid unhandledrejection when race loses to abort
  void runP.catch(() => {})

  try {
    if (!signal) return await runP
    return await Promise.race([runP, whenAborted(signal)])
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      // Kill in-flight recognize / createWorker so cancel is immediate
      void terminateOcrWorker()
      throw abortError()
    }
    throw err
  }
}

/** Collapse "螃 蟹" style gaps left by OCR. */
export function normalizeOcrText(text: string): string {
  return compactCjkGaps(text.replace(/\s+/g, ' ').trim())
}

/** Force-stop OCR worker so in-flight recognize/createWorker can unblock. */
export async function terminateOcrWorker() {
  const promise = workerPromise
  workerPromise = null
  workerGen += 1
  if (!promise) return
  try {
    const w = await promise
    await w.terminate()
  } catch {
    /* create may have failed or already aborted */
  }
}

/** Heuristic: embedded PDF text too sparse to search. */
export function isSparseText(text: string, minChars = 24): boolean {
  const compact = text.replace(/\s+/g, '')
  return compact.length < minChars
}
