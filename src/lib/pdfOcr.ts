import { loadPdf } from '@/lib/pdfText'

// Reading a scanned past paper — a photocopy or a photograph, with no text
// layer for pdfText to find. Each page is rendered to a canvas and put through
// Tesseract, and the text it recognises goes into the same parser and the same
// review screen as a normal import.
//
// It is deliberately behind a button rather than automatic: recognition takes
// several seconds a page and downloads a language model the first time, so a
// teacher opts into that cost only when the fast path has already failed.

// Scans are usually 150–200 dpi; rendering above the page's natural size gives
// Tesseract the pixels it needs to separate characters. Higher is slower for
// steadily less gain, and 2x is where that curve flattens.
const RENDER_SCALE = 2

export interface OcrProgress {
  page: number
  totalPages: number
  /** 0–1 within the current page, for a progress bar. */
  ratio: number
  note: string
}

export async function ocrPdf(file: File, onProgress: (p: OcrProgress) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const doc = await loadPdf(file)

  onProgress({ page: 0, totalPages: doc.numPages, ratio: 0, note: 'Loading text recognition…' })

  // Served from our own origin (see scripts/copy-ocr-assets.mjs). Tesseract's
  // default is a public CDN, which simply fails on a network that blocks it —
  // and there is no reason a school's question papers should depend on one.
  const assets = `${import.meta.env.BASE_URL}tesseract/`

  const worker = await createWorker('eng', 1, {
    workerPath: `${assets}worker.min.js`,
    corePath: assets,
    langPath: assets,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') return // reported per page below
      onProgress({ page: 0, totalPages: doc.numPages, ratio: m.progress, note: 'Loading text recognition…' })
    },
  })

  const pages: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress({ page: n, totalPages: doc.numPages, ratio: 0, note: `Reading page ${n} of ${doc.numPages}…` })

      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not render the PDF page for recognition.')

      // A scan is often grey; a white backdrop keeps the contrast Tesseract
      // wants rather than compositing onto transparency.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise

      const { data } = await worker.recognize(canvas)
      pages.push(data.text)

      // Free the bitmap before the next page — a 20-page paper at 2x would
      // otherwise hold every rendered sheet in memory at once.
      canvas.width = 0
      canvas.height = 0
      page.cleanup()

      onProgress({ page: n, totalPages: doc.numPages, ratio: 1, note: `Read page ${n} of ${doc.numPages}` })
    }
  } finally {
    await worker.terminate()
    await doc.destroy()
  }

  return pages.join('\n')
}
