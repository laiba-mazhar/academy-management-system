import { supabase } from '@/lib/supabase'
import type { Crop, SourceBookPage } from '@/types/database'

// What remains of the scanned-book library: enough to keep showing questions
// that were snipped out of one before the library was removed.
//
// Uploading a book, reading its text layer and snipping regions out of it all
// went with it — reading the pages with AI at import does the same job from the
// same PDF without any of that. The tables and the storage bucket are still
// there, so an existing snip still renders on screen and prints.

export const BOOK_BUCKET = 'book-pages'

// The bucket is private, so pages are read through short-lived signed links
// rather than being world-readable to anyone who guesses a path. Signed in one
// call per screen, because a bank full of snips needs them all at once.
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

// Page pictures are fetched once and reused: a paper can carry several snips
// off the same page, and downloading it per snip would be wasteful.
const pageImageCache = new Map<string, Promise<HTMLImageElement>>()

function loadPageImage(url: string): Promise<HTMLImageElement> {
  const cached = pageImageCache.get(url)
  if (cached) return cached
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    // Storage answers with permissive CORS headers, and without this the canvas
    // would be tainted, so nothing could be read back out of it.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load that book page.'))
    img.src = url
  })
  pageImageCache.set(url, p)
  return p
}

// Cuts a fractional crop out of a page picture, for the PDF writer to embed.
// Crops are stored as fractions rather than pixels so they stay correct
// whatever resolution the page was rendered at.
export async function cropToDataUrl(
  url: string,
  crop: Crop,
  quality = 0.85
): Promise<{ dataUrl: string; aspect: number }> {
  const img = await loadPageImage(url)
  const sx = crop.x * img.naturalWidth
  const sy = crop.y * img.naturalHeight
  const sw = crop.w * img.naturalWidth
  const sh = crop.h * img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(Math.round(sw), 1)
  canvas.height = Math.max(Math.round(sh), 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not prepare the book image.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), aspect: canvas.height / canvas.width }
}
