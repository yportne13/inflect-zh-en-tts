import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps the build working from a project GitHub Pages path.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
