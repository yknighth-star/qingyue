import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * Vite-friendly worker URL (`?url`) so pdf.js module workers load in
 * `npm run dev` and production builds (avoids `/pdf.worker.min.mjs?import` failures).
 */
export const PDF_WORKER_SRC = pdfWorkerUrl
