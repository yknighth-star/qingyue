import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// GitHub Pages project site: https://yknighth-star.github.io/qingyue/
const base = process.env.GITHUB_PAGES === 'true' ? '/qingyue/' : '/'

function copyFile(src: string, dest: string) {
  if (!existsSync(src)) return false
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  return true
}

const OCR_FILES: Record<string, { src: string; type: string }> = {
  'worker.min.js': {
    src: path.resolve('node_modules/tesseract.js/dist/worker.min.js'),
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core-simd-lstm.js': {
    src: path.resolve('node_modules/tesseract.js-core/tesseract-core-simd-lstm.js'),
    type: 'text/javascript; charset=utf-8',
  },
  'tesseract-core-simd-lstm.wasm': {
    src: path.resolve('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm'),
    type: 'application/wasm',
  },
}

function sendFile(res: ServerResponse, filePath: string, contentType: string) {
  const st = statSync(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', String(st.size))
  res.setHeader('Cache-Control', 'no-cache')
  createReadStream(filePath).pipe(res)
}

/** Serve / copy PDF.js worker + offline Tesseract runtime (dev middleware + dist). */
function staticAssetsPlugin(): Plugin {
  const pdfWorkerSrc = path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')

  const copyOcrRuntime = (destRoot: string) => {
    for (const [name, meta] of Object.entries(OCR_FILES)) {
      copyFile(meta.src, path.join(destRoot, 'ocr-runtime', name))
    }
  }

  const copyAll = (destRoot: string) => {
    copyFile(pdfWorkerSrc, path.join(destRoot, 'pdf.worker.min.mjs'))
    copyOcrRuntime(destRoot)
  }

  return {
    name: 'qingyue-static-assets',
    enforce: 'pre',
    configureServer(server) {
      // Always serve OCR runtime from node_modules — publicDir watch can miss
      // gitignored / late-created folders and fall through to index.html.
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const rawUrl = req.url || ''
        const qIdx = rawUrl.indexOf('?')
        const pathname = decodeURIComponent(qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl)
        const query = qIdx >= 0 ? rawUrl.slice(qIdx + 1) : ''

        // Plain Worker fetches only — never intercept Vite `?url` / `?import` transforms.
        if (
          (pathname.endsWith('/pdf.worker.min.mjs') || pathname === '/pdf.worker.min.mjs') &&
          !query
        ) {
          if (existsSync(pdfWorkerSrc)) {
            sendFile(res, pdfWorkerSrc, 'text/javascript; charset=utf-8')
            return
          }
        }

        const marker = '/ocr-runtime/'
        const idx = pathname.lastIndexOf(marker)
        if (idx < 0) return next()
        const name = pathname.slice(idx + marker.length)
        const meta = OCR_FILES[name]
        if (!meta || !existsSync(meta.src)) return next()
        sendFile(res, meta.src, meta.type)
      })
    },
    buildStart() {
      copyAll(path.resolve('public'))
    },
    closeBundle() {
      const outDir = path.resolve('dist')
      copyAll(outDir)
      for (const lang of ['eng', 'chi_sim']) {
        const src = path.resolve('public/tessdata', `${lang}.traineddata`)
        copyFile(src, path.join(outDir, 'tessdata', `${lang}.traineddata`))
      }
      writeFileSync(path.join(outDir, '.nojekyll'), '')
    },
  }
}

/**
 * epub.js uses window "unload" for manager destroy; Chrome denies unload via
 * Permissions-Policy and logs a violation. Map those registrations to pagehide.
 */
function epubJsPagehidePlugin(): Plugin {
  const re = /addEventListener\(\s*(["'])unload\1/g
  return {
    name: 'epubjs-pagehide',
    enforce: 'pre',
    transform(code, id) {
      const norm = id.replace(/\\/g, '/')
      if (!norm.includes('/epubjs/')) return
      if (!re.test(code)) return
      re.lastIndex = 0
      return {
        code: code.replace(re, 'addEventListener($1pagehide$1'),
        map: null,
      }
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    vue(),
    epubJsPagehidePlugin(),
    staticAssetsPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'pdf.worker.min.mjs',
        'ocr-runtime/worker.min.js',
        'ocr-runtime/tesseract-core-simd-lstm.js',
        'ocr-runtime/tesseract-core-simd-lstm.wasm',
        'tessdata/eng.traineddata',
        'tessdata/chi_sim.traineddata',
      ],
      manifest: {
        name: '轻阅',
        short_name: '轻阅',
        description: '本地阅读文档与电子书（EPUB / TXT / PDF）',
        theme_color: '#1a1f2e',
        background_color: '#1a1f2e',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cacheId: 'qingyue-v8',
        cleanupOutdatedCaches: true,
        globPatterns: [
          '**/*.{js,mjs,css,html,ico,png,svg,woff2,wasm,traineddata}',
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/_/,
          /\/assets\//,
          /\.mjs$/i,
          /pdf\.worker/i,
          /traineddata$/i,
          /ocr-runtime\//i,
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'pdfjs-dist', 'tesseract.js'],
    exclude: ['pdfjs-dist/build/pdf.worker.min.mjs'],
  },
  worker: {
    format: 'es',
  },
  build: {
    assetsInlineLimit: 0,
  },
})
