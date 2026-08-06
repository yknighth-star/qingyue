# 轻阅（qingyue）

本地文档与电子书阅读 PWA（Vite + Vue 3 + TypeScript）。支持 EPUB / TXT / PDF，数据存 IndexedDB，桌面端可关联文件夹（如 `E:\Projects\Books`）。

> npm 包名 / 本地目录：`qingyue`（`E:\Projects\qingyue`）。GitHub 仓库 / Pages 路径仍为 `h5-ebook-reader`（改仓库名会影响线上地址）。

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

Place files in the sibling folder: `E:\Projects\Books` (same level as this project). On desktop Chrome/Edge, use “关联文件夹” to grant access.
