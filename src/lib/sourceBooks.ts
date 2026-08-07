import { supabase } from '@/lib/supabase'
import { loadPdf } from '@/lib/pdfText'
import type { Crop, PageTextItem, SourceBookPage } from '@/types/database'

export const BOOK_BUCKET = 'book-pages'

// Wide enough that a snipped question stays sharp when printed at close to its
// original size, without making a 200-page book unreasonable to store.
const PAGE_WIDTH = 1400
const JPEG_QUALITY = 0.82

// Most books that look scanned are really digital PDFs whose text is right
// there in the file. Capturing it at upload means snipping a region can hand
// back the real characters — exact Urdu, exact notation — with no recognition
// step to corrupt them. Positions are fractions of the page so a crop dragged
// at any display size can be matched against them.
async function pageTextItems(page: {
  getTextContent: () => Promise<{ items: unknown[] }>
  getViewport: (o: { scale: number }) => { width: number; height: number }
}): Promise<PageTextItem[]> {
  const view = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: PageTextItem[] = []

  for (const raw of content.items) {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number }
    if (!item.str?.trim() || !item.transform) continue
    const x = item.transform[4]
    // PDF y counts up from the bottom; everything else here counts down.
    const yTop = view.height - item.transform[5] - (item.height ?? 0)
    items.push({
      t: item.str,
      x: x / view.width,
      y: yTop / view.height,
      w: (item.width ?? 0) / view.width,
      h: (item.height ?? 0) / view.height,
    })
  }
  return items
}

// Lines are rebuilt by vertical position, and read right-to-left when the line
// is Arabic script — joining those left-to-right would reverse the words.
const LINE_TOLERANCE = 0.006
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

export function textInCrop(items: PageTextItem[] | null, crop: Crop): string {
  if (!items || items.length === 0) return ''

  // An item counts as inside when its middle is, so a box drawn slightly tight
  // around a line still catches it.
  const inside = items.filter((it) => {
    const cx = it.x + it.w / 2
    const cy = it.y + it.h / 2
    return cx >= crop.x && cx <= crop.x + crop.w && cy >= crop.y && cy <= crop.y + crop.h
  })
  if (inside.length === 0) return ''

  const lines: PageTextItem[][] = []
  for (const item of [...inside].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - item.y) <= LINE_TOLERANCE) line.push(item)
    else lines.push([item])
  }

  return lines
    .map((line) => {
      const rtl = line.some((it) => ARABIC.test(it.t))
      const ordered = [...line].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x))
      return ordered
        .map((it) => it.t)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    })
    .filter(Boolean)
    .join('\n')
}

export interface UploadProgress {
  page: number
  totalPages: number
  note: string
}

// Uploads a scanned book as pictures of its pages. Nothing is transcribed, so
// Urdu, Arabic, mathematical notation and diagrams all survive exactly as
// printed — which is the whole point of storing a scan this way rather than
// running it through recognition.
export async function uploadBook(
  params: { file: File; title: string; subjectId: string; classId: string },
  onProgress: (p: UploadProgress) => void
): Promise<string> {
  const { file, title, subjectId, classId } = params
  const doc = await loadPdf(file)

  const { data: book, error: bookError } = await supabase
    .from('source_books')
    .insert({ subject_id: subjectId, class_id: classId, title: title.trim(), page_count: doc.numPages })
    .select()
    .single()
  if (bookError || !book) throw new Error(bookError?.message ?? 'Could not create the book.')

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress({ page: n, totalPages: doc.numPages, note: `Uploading page ${n} of ${doc.numPages}…` })

      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width })

      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not render the PDF pages.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
      )
      if (!blob) throw new Error(`Could not turn page ${n} into an image.`)

      const path = `${book.id}/${String(n).padStart(4, '0')}.jpg`
      const { error: uploadError } = await supabase.storage
        .from(BOOK_BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw new Error(uploadError.message)

      const textItems = await pageTextItems(page)
      const { error: pageError } = await supabase.from('source_book_pages').insert({
        book_id: book.id,
        page_number: n,
        storage_path: path,
        width: canvas.width,
        height: canvas.height,
        // Null rather than an empty array marks a true scan, which is a
        // different thing from a page that happens to have no words on it.
        text_items: textItems.length > 0 ? textItems : null,
      })
      if (pageError) throw new Error(pageError.message)

      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
  } catch (err) {
    // A half-uploaded book is worse than none — it would sit in the library
    // with pages missing and no sign of which.
    await supabase.from('source_books').delete().eq('id', book.id)
    throw err
  } finally {
    await doc.destroy()
  }

  return book.id
}

// The bucket is private, so pages are read through short-lived signed links
// rather than being world-readable to anyone who guesses a path. Signed in one
// call per screen, because a book viewer asks for a page at a time.
export async function signPages(pages: SourceBookPage[], seconds = 3600): Promise<Map<string, string>> {
  if (pages.length === 0) return new Map()
  const { data, error } = await supabase.storage
    .from(BOOK_BUCKET)
    .createSignedUrls(pages.map((p) => p.storage_path), seconds)
  if (error) throw new Error(error.message)

  const urls = new Map<string, string>()
  data?.forEach((entry, i) => {
    if (entry.signedUrl) urls.set(pages[i].id, entry.signedUrl)
  })
  return urls
}

// Crops are stored as fractions of the page, so they stay correct whatever
// resolution the page was rendered at. This turns one back into the CSS needed
// to show just that region, scaled to a given rendered width.
export function cropStyle(crop: Crop, imageUrl: string, renderedWidth: number) {
  const pageWidth = renderedWidth / crop.w
  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: `${pageWidth}px auto`,
    backgroundPosition: `-${pageWidth * crop.x}px -${pageWidth * crop.y}px`,
    backgroundRepeat: 'no-repeat' as const,
    width: `${renderedWidth}px`,
    // Height follows from the crop's aspect against the page's, applied by the
    // caller which knows the page dimensions.
  }
}
