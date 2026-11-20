import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
  worker: { format: 'es' },
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), rules: resolve(__dirname, 'rules.html') } } },
});
