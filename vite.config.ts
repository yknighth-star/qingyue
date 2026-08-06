import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

// GitHub Pages project site: https://yknighth-star.github.io/qingyue/
const base = process.env.GITHUB_PAGES === 'true' ? '/qingyue/' : '/'

/** Copy PDF.js worker + .nojekyll after all other plugins write dist. */
function pdfWorkerAndPagesPlugin(): Plugin {
  const workerSrc = path.resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs')

  const copyWorker = (destDir: string) => {
    if (!existsSync(workerSrc)) return
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    copyFileSync(workerSrc, path.join(destDir, 'pdf.worker.min.mjs'))
  }

  return {
    name: 'pdf-worker-and-pages',
    enforce: 'post',
    buildStart() {
      copyWorker(path.resolve('public'))
    },
    closeBundle() {
      const outDir = path.resolve('dist')
      copyWorker(outDir)
      writeFileSync(path.join(outDir, '.nojekyll'), '')
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    vue(),
    pdfWorkerAndPagesPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pdf.worker.min.mjs'],
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
        cacheId: 'qingyue-v2',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/_/, /\/assets\//, /\.mjs$/i, /pdf\.worker/i],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['epubjs', 'pdfjs-dist'],
    exclude: ['pdfjs-dist/build/pdf.worker.min.mjs'],
  },
  worker: {
    format: 'es',
  },
  build: {
    assetsInlineLimit: 0,
  },
})
