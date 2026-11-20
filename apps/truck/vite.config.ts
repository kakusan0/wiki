import { defineConfig } from 'vite';
// 字体を待つため、最初に await を使う（es2022 以降の書き方）
export default defineConfig({ base: './', build: { target: 'es2022', chunkSizeWarningLimit: 1200 } });
