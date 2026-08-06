import { supabase } from '@/lib/supabase'
import { loadPdf } from '@/lib/pdfText'
import type { Crop, SourceBookPage } from '@/types/database'

export const BOOK_BUCKET = 'book-pages'

// Wide enough that a snipped question stays sharp when printed at close to its
// original size, without making a 200-page book unreasonable to store.
const PAGE_WIDTH = 1400
const JPEG_QUALITY = 0.82

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

      const { error: pageError } = await supabase.from('source_book_pages').insert({
        book_id: book.id,
        page_number: n,
        storage_path: path,
        width: canvas.width,
        height: canvas.height,
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
