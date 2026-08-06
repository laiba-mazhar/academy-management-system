// Tesseract loads its worker, its wasm core and its language model at runtime,
// and by default fetches all three from a public CDN. That makes text
// recognition depend on a third party being reachable from wherever the school
// is sitting — and it fails outright on any network that blocks it.
//
// These files are already on disk as dependencies, so they are copied into
// public/ and served from our own origin instead. Copying rather than
// committing keeps ~11 MB of binaries out of the repository.
//
// vite.config.ts calls this on every build and dev start, so it cannot be
// missed by a deployment that invokes vite directly instead of `npm run
// build`. It stays runnable on its own (`npm run copy-ocr-assets`) too.
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const OCR_ASSET_DIR = join(root, 'public', 'tesseract')

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // Self-contained: the wasm is embedded in these files, so no separate .wasm
  // needs serving. All three variants ship because Tesseract picks between
  // them on what the browser reports — Chromium takes the relaxed-SIMD build,
  // and a browser without SIMD falls back to the plain one.
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  // The integerised "best" models: a third the size of the full ones for
  // materially better accuracy than the fast models on printed text.
  //
  // Urdu and Arabic are here because running the English model over Arabic
  // script does not fail — it matches Latin letter shapes to Arabic glyphs and
  // returns confident nonsense, which is far worse than an error.
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['@tesseract.js-data/urd/4.0.0_best_int/urd.traineddata.gz', 'urd.traineddata.gz'],
  ['@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'ara.traineddata.gz'],
]

export async function copyOcrAssets() {
  await mkdir(OCR_ASSET_DIR, { recursive: true })
  for (const [from, to] of files) {
    await copyFile(join(root, 'node_modules', from), join(OCR_ASSET_DIR, to))
  }
  return files.length
}

// Only when run as a script, not when imported by the Vite config.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const n = await copyOcrAssets()
  console.log(`Copied ${n} text-recognition assets into public/tesseract/`)
}
