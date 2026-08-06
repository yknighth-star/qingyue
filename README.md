# 轻阅（qingyue）

本地文档与电子书阅读 PWA（Vite + Vue 3 + TypeScript）。支持 EPUB / TXT / PDF，数据存 IndexedDB，桌面端可关联文件夹（如 `E:\Projects\Books`）。

> 本地目录 / npm 包名 / GitHub 仓库：`qingyue`（`E:\Projects\qingyue`）

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

Site URL: https://yknighth-star.github.io/qingyue/

**重要：若出现 `/src/main.ts` 404，说明 Pages 指到了源码分支，请改设置：**

1. 打开 https://github.com/yknighth-star/qingyue/settings/pages  
2. Source 选 **Deploy from a branch**  
3. 任选其一（推荐 A）：
   - **A.** Branch = **`gh-pages`**，Folder = **`/ (root)`**
   - **B.** Branch = **`main`**，Folder = **`/docs`**
4. Save 后等 1–2 分钟，强制刷新页面（清站点数据）

正确页面源码应包含 `/qingyue/assets/...js`，而不是 `/src/main.ts`。

## Library folder

Place files in the sibling folder: `E:\Projects\Books` (same level as this project). On desktop Chrome/Edge, use “关联文件夹” to grant access.
