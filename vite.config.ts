import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps the build working from a project GitHub Pages path.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // Two entries: the main TTS app and the vocoder demo page. The vocoder page
    // imports onnxruntime-web like the app does, so Vite bundles the runtime
    // WASM as a hashed same-origin asset instead of needing a public copy (the
    // repo gitignores public/ort/, so a static page could not load it).
    rollupOptions: {
      input: {
        main: 'index.html',
        vocoder: 'vocoder.html',
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
