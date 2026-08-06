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

Pushes to `main` trigger GitHub Actions deployment.

Site URL:

https://yknighth-star.github.io/h5-ebook-reader/

First-time setup (repo Settings → Pages):

1. Source: **GitHub Actions**
2. Wait for the `Deploy GitHub Pages` workflow to finish

## Library folder

Place books in the sibling folder: `E:\Projects\Books` (same level as this project). On desktop Chrome/Edge, use “关联书库文件夹” to grant access.
