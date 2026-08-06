import { stripRunningHeaders } from '@/lib/questionParser'
// Reads the text out of a past paper PDF, entirely in the browser — the file
// is never uploaded anywhere.
//
// pdf.js hands back positioned text fragments, not lines, so the fragments are
// regrouped by their y coordinate. Without that step a two-column paper comes
// out interleaved and the parser sees nonsense.

export class ScannedPdfError extends Error {
  constructor() {
    super(
      'This PDF has no text in it — it looks like a scan or a photo. Use the "Paste text" tab instead, or export the paper from Word as a PDF.'
    )
    this.name = 'ScannedPdfError'
  }
}

// Fragments within this many points of each other vertically are one line.
const LINE_TOLERANCE = 3
// A PDF writer often splits one word across fragments ("D" + "efin"), which
// join with no gap between them. Only a real horizontal gap is a space.
const SPACE_GAP = 1
// Below this, a PDF is a picture of a paper rather than a paper.
const MIN_CHARS_PER_PAGE = 40

interface Fragment {
  text: string
  x: number
  y: number
  width: number
}

// Shared by the text reader and the OCR reader, so both open a PDF the same
// way and neither has to know how the worker is wired up.
export async function loadPdf(file: File) {
  const pdfjs = await import('pdfjs-dist')
  // Vite resolves this to a hashed asset URL and pdf.js runs it as a worker,
  // keeping the parse off the main thread.
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  const buffer = await file.arrayBuffer()
  return pdfjs.getDocument({ data: buffer }).promise
}

export async function extractPdfText(file: File): Promise<string> {
  const doc = await loadPdf(file)

  const pages: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()

      const fragments: Fragment[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        fragments.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: 'width' in item ? item.width : 0,
        })
      }
      pages.push(toLines(fragments))
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }

  const text = stripRunningHeaders(pages).join('\n')
  if (text.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE * doc.numPages) {
    throw new ScannedPdfError()
  }
  return text
}

function toLines(fragments: Fragment[]): string {
  if (fragments.length === 0) return ''

  // Descending y: PDF coordinates start at the bottom of the page.
  const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Fragment[][] = []
  for (const fragment of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - fragment.y) <= LINE_TOLERANCE) line.push(fragment)
    else lines.push([fragment])
  }

  return lines
    .map((line) => joinFragments(line.sort((a, b) => a.x - b.x)))
    .filter(Boolean)
    .join('\n')
}

function joinFragments(line: Fragment[]): string {
  let out = ''
  let cursor: number | null = null
  for (const fragment of line) {
    if (cursor !== null) {
      const gap = fragment.x - cursor
      const alreadySpaced = /\s$/.test(out) || /^\s/.test(fragment.text)
      if (!alreadySpaced && gap > SPACE_GAP) out += ' '
    }
    out += fragment.text
    cursor = fragment.x + fragment.width
  }
  return out.replace(/\s+/g, ' ').trim()
}
