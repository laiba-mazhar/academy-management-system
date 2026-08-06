// Tesseract loads its worker, its wasm core and its language model at runtime,
// and by default fetches all three from a public CDN. That makes text
// recognition depend on a third party being reachable from wherever the school
// is sitting — and it fails outright on any network that blocks it.
//
// These files are already on disk as dependencies, so they are copied into
// public/ at build time and served from our own origin instead. Copying rather
// than committing keeps ~10 MB of binaries out of the repository while still
// removing the CDN from the runtime path.
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'tesseract')

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // Self-contained: the wasm is embedded in these files, so no separate .wasm
  // needs serving. All three variants ship because Tesseract picks between
  // them on what the browser reports — Chromium takes the relaxed-SIMD build,
  // and a browser without SIMD falls back to the plain one.
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  // The integerised "best" model: a third the size of the full one for
  // materially better accuracy than the fast model on printed text.
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]

await mkdir(out, { recursive: true })
for (const [from, to] of files) {
  await copyFile(join(root, 'node_modules', from), join(out, to))
}
console.log(`Copied ${files.length} text-recognition assets into public/tesseract/`)
