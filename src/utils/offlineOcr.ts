import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import { compactCjkGaps } from '@/utils/searchText'

export type OcrProgress = {
  page: number
  total: number
  status: string
}

let workerPromise: Promise<Worker> | null = null

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

/** Lazy singleton Tesseract worker — Simplified Chinese, fully local assets. */
export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
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
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      return worker
    })().catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

export async function recognizeImage(
  image: HTMLCanvasElement | Blob | string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const worker = await getOcrWorker()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const { data } = await worker.recognize(image)
  return normalizeOcrText(data.text || '')
}

/** Collapse "螃 蟹" style gaps left by OCR. */
export function normalizeOcrText(text: string): string {
  return compactCjkGaps(text.replace(/\s+/g, ' ').trim())
}

export async function terminateOcrWorker() {
  if (!workerPromise) return
  try {
    const w = await workerPromise
    await w.terminate()
  } catch {
    /* */
  } finally {
    workerPromise = null
  }
}

/** Heuristic: embedded PDF text too sparse to search. */
export function isSparseText(text: string, minChars = 24): boolean {
  const compact = text.replace(/\s+/g, '')
  return compact.length < minChars
}
