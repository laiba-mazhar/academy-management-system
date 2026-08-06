import { loadPdf } from '@/lib/pdfText'
import { stripRunningHeaders } from '@/lib/questionParser'

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

export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'urd', label: 'Urdu' },
  { code: 'ara', label: 'Arabic' },
] as const

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code']

// Tesseract reports how sure it was, per page. Running the wrong model over a
// script it was not trained on does not fail — it matches letter shapes it
// does recognise and returns fluent-looking rubbish. A low mean confidence is
// what that looks like from the outside, so it is treated as a failure rather
// than passed on to the review grid.
const MIN_CONFIDENCE = 55

export class OcrGibberishError extends Error {
  constructor(public confidence: number, public language: OcrLanguage) {
    super(
      `The text came back unreadable (${Math.round(confidence)}% confidence). This usually means the page is in a different language than the one selected, or the scan is too faint.`
    )
    this.name = 'OcrGibberishError'
  }
}

export interface OcrProgress {
  page: number
  totalPages: number
  /** 0–1 within the current page, for a progress bar. */
  ratio: number
  note: string
}

export class OcrAssetsMissingError extends Error {
  constructor() {
    super(
      'Text recognition is not available in this deployment — its files are missing. Rebuild and redeploy the app, then try again.'
    )
    this.name = 'OcrAssetsMissingError'
  }
}

// The app answers index.html to any unknown path (the SPA rewrite), so a
// deployment built without the recognition assets returns a page of HTML with
// status 200 where Tesseract expects JavaScript. Checking first turns that
// into a sentence someone can act on instead of a stack trace from a worker.
async function assertAssetsPresent(assets: string) {
  try {
    const res = await fetch(`${assets}worker.min.js`, { method: 'GET' })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || type.includes('text/html')) throw new OcrAssetsMissingError()
  } catch (err) {
    if (err instanceof OcrAssetsMissingError) throw err
    throw new OcrAssetsMissingError()
  }
}

export async function ocrPdf(
  file: File,
  language: OcrLanguage,
  onProgress: (p: OcrProgress) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const doc = await loadPdf(file)

  onProgress({ page: 0, totalPages: doc.numPages, ratio: 0, note: 'Loading text recognition…' })

  // Served from our own origin (see scripts/copy-ocr-assets.mjs). Tesseract's
  // default is a public CDN, which simply fails on a network that blocks it —
  // and there is no reason a school's question papers should depend on one.
  const assets = `${import.meta.env.BASE_URL}tesseract/`
  await assertAssetsPresent(assets)

  const worker = await createWorker(language, 1, {
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
  const confidences: number[] = []
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
      confidences.push(data.confidence)

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

  const meanConfidence = confidences.length
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0
  if (meanConfidence < MIN_CONFIDENCE) throw new OcrGibberishError(meanConfidence, language)

  return stripRunningHeaders(pages).join('\n')
}
