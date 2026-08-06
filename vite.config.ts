import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { copyOcrAssets } from './scripts/copy-ocr-assets.mjs'

// The text-recognition assets are copied out of node_modules rather than
// committed, so something has to put them in public/ before a build. Doing it
// here rather than only in a prebuild script means it happens however the
// build is invoked — including a deployment configured to run `vite build`
// directly, which would otherwise ship without them and leave the SPA rewrite
// answering index.html to Tesseract's fetches.
function ocrAssets(): Plugin {
  return {
    name: 'maktab-ocr-assets',
    async buildStart() {
      await copyOcrAssets()
    },
  }
}

export default defineConfig({
  plugins: [react(), ocrAssets()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
