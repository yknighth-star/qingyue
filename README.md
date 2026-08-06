# H5 Local Ebook Reader

Vite + Vue 3 + TypeScript PWA ebook reader. Supports EPUB / TXT / PDF with local IndexedDB storage and optional desktop folder library (`E:\Projects\Books`).

## Setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output is in `dist/`.

## Deploy (GitHub Pages)

Pushes to `main` publish the site to the `gh-pages` branch.

Site URL:

https://yknighth-star.github.io/h5-ebook-reader/

### First-time: enable Pages (required)

1. Open https://github.com/yknighth-star/h5-ebook-reader/settings/pages
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**
3. Branch must be **gh-pages** / **/ (root)** → Save  
   **Do not** select `main` — that publishes the Vite source `index.html` and breaks PDF/assets.
4. Wait for Actions `Deploy GitHub Pages` to finish
5. Hard-refresh the site (or clear site data) so the old Service Worker is dropped

Workflow: https://github.com/yknighth-star/h5-ebook-reader/actions

## Library folder

Place books in the sibling folder: `E:\Projects\Books` (same level as this project). On desktop Chrome/Edge, use “关联书库文件夹” to grant access.
