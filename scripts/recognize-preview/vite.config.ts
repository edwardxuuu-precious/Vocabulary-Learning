import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: false,
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../../artifacts/recognize-picture-preview/dist', import.meta.url)), emptyOutDir: true },
});
