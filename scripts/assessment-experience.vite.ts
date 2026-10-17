import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  root, plugins: [react()], base: '/__experience/',
  build: {
    outDir: resolve(root, 'artifacts/assessment-experience-client'), emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'scripts/assessment-experience.html') },
  },
});
