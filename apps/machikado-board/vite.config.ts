import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // 画面に出す版（ビルドした日時）。公開が最新になったかを見分けるため
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  // 開発中は /api を wrangler dev（npm run dev:api）へ転送する
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), rules: resolve(__dirname, 'rules.html') },
    },
  },
});
