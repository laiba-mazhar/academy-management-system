// Reads questions off a PDF by looking at its pages, rather than by matching
// the shape of its text.
//
// The regex parser is exact and free, and stays the first choice for a paper
// exported from Word. This path exists for the two documents it cannot handle:
// a scan, which has no text to match against at all, and a paper in Urdu or
// Arabic, whose numbering and reading order are not the ones the parser knows.
//
// Nothing here decides what enters the bank. Every question comes back as a
// draft and goes through the same review screen as an imported past paper.
import { supabase } from '@/lib/supabase'
import { edgeFunctionError } from '@/lib/errors'
import { loadPdf } from '@/lib/pdfText'
import { dedupeKey, defaultMarks, type DraftQuestion } from '@/lib/questionParser'
import type { QuestionLanguage, QuestionOption, QuestionType } from '@/types/database'

// Wide enough for a model to read Urdu diacritics and a subscript, without
// making the upload the slow part.
const RENDER_WIDTH = 1600
const JPEG_QUALITY = 0.85
// Pages per request. Four is what the function accepts, and for a textbook of
// several hundred pages the request count is what decides whether the job fits
// in a day's allowance at all: four pages a call turns a 300-page book from 150
// requests into 75. It also gives the model more context for a question that
// runs over a page break.
const PAGES_PER_CALL = 4
// The free tier caps requests per minute. One retry, after a wait long enough
// for the window to roll over, turns a burst limit into a pause rather than a
// failed import.
const RATE_LIMIT_WAIT_MS = 25_000
// Free-tier allowances are per minute as well as per day, and the two models
// worth using sit at 15 and 5 requests a minute. Rather than pick one and be
// wrong for the other, the gap starts at the faster pace and backs off when the
// limit is actually hit — a run against the slower model settles itself down
// after one stumble instead of tripping on every batch.
const BASE_GAP_MS = 4_500
const MAX_GAP_MS = 20_000

export interface AiReadProgress {
  page: number
  totalPages: number
  note: string
}

export interface PageRange {
  from: number
  to: number
}

export interface AiReadResult {
  drafts: DraftQuestion[]
  pagesRead: number
  /** Set when the run stopped before the last page: quota, size or network. */
  stoppedEarly: string | null
  /**
   * The first page not read, when the run stopped early. A book of several
   * hundred pages will not always finish in one go, and starting again from
   * page one would both waste the day's allowance and duplicate the bank.
   */
  resumeFrom: number | null
}

interface ExtractedQuestion {
  type: QuestionType
  text: string
  options: QuestionOption[]
  marks: number | null
  chapter: string | null
  language: QuestionLanguage | null
  translation: string | null
  optionsTranslated: QuestionOption[]
}

export interface AiReadOptions {
  exercisesOnly: boolean
  /**
   * Ask for the question in the other language as well. Off for language
   * subjects, where a translation would replace the thing being examined —
   * see subjects.translate_questions.
   */
  translate: boolean
}

export async function countPdfPages(file: File): Promise<number> {
  const doc = await loadPdf(file)
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

// Accepts "3", "2-9" or blank for everything. Returns null when the input is
// not a range the document actually has, so the caller can say so.
export function parsePageRange(input: string, max: number): PageRange | null {
  const trimmed = input.trim()
  if (!trimmed) return { from: 1, to: max }

  const match = /^(\d{1,4})\s*(?:[-–]\s*(\d{1,4}))?$/.exec(trimmed)
  if (!match) return null

  const from = Number(match[1])
  const to = match[2] ? Number(match[2]) : from
  if (from < 1 || to < from || from > max) return null
  return { from, to: Math.min(to, max) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// When the last call went out, so the next one can be held back if it would
// land inside the free tier's per-minute window, and how long that gap
// currently is. Both persist across runs in a session: a key that is rate
// limited now will still be rate limited for the next book.
let lastCallAt = 0
let callGapMs = BASE_GAP_MS

async function callReadQuestions(
  pages: { imageBase64: string }[],
  options: AiReadOptions
): Promise<ExtractedQuestion[]> {
  const since = Date.now() - lastCallAt
  if (lastCallAt > 0 && since < callGapMs) {
    await sleep(callGapMs - since)
  }
  lastCallAt = Date.now()

  const { data, error } = await supabase.functions.invoke('read-questions', {
    body: { pages, exercisesOnly: options.exercisesOnly, translate: options.translate },
  })
  if (error) throw new Error(await edgeFunctionError(error, 'Could not read those pages.'))

  const result = data as { questions?: ExtractedQuestion[]; error?: string } | null
  if (result?.error) throw new Error(result.error)
  return result?.questions ?? []
}

// A rate limit is the one failure worth absorbing: it means "not yet", not
// "no". Everything else is passed up so the caller can keep the pages it
// already has and say where it stopped.
async function callWithOneRetry(
  pages: { imageBase64: string }[],
  options: AiReadOptions,
  onWait: () => void
): Promise<ExtractedQuestion[]> {
  try {
    return await callReadQuestions(pages, options)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    const rateLimited = /quota|rate|too many|resource_exhausted/i.test(message)
    if (!rateLimited) throw err
    // Hitting the limit means the pace is wrong for this key, not just that
    // this one call was unlucky, so the rest of the run slows down too.
    callGapMs = Math.min(callGapMs * 2, MAX_GAP_MS)
    onWait()
    await sleep(RATE_LIMIT_WAIT_MS)
    return await callReadQuestions(pages, options)
  }
}

export async function readQuestionsWithAi(
  file: File,
  range: PageRange,
  options: AiReadOptions,
  onProgress: (p: AiReadProgress) => void
): Promise<AiReadResult> {
  const doc = await loadPdf(file)
  const totalPages = range.to - range.from + 1
  const drafts: DraftQuestion[] = []
  // A question printed across a page break can be read twice, once from each
  // batch. Exact repeats are dropped here rather than left for the teacher.
  const seen = new Set<string>()
  let pagesRead = 0
  let stoppedEarly: string | null = null
  let resumeFrom: number | null = null

  try {
    for (let start = range.from; start <= range.to; start += PAGES_PER_CALL) {
      const end = Math.min(start + PAGES_PER_CALL - 1, range.to)
      const done = start - range.from

      const batch: { imageBase64: string }[] = []
      for (let n = start; n <= end; n++) {
        onProgress({ page: done + (n - start), totalPages, note: `Preparing page ${n}…` })
        batch.push({ imageBase64: await renderPageJpegBase64(doc, n) })
      }

      onProgress({
        page: done,
        totalPages,
        note: start === end ? `Reading page ${start}…` : `Reading pages ${start}–${end}…`,
      })

      let questions: ExtractedQuestion[]
      try {
        questions = await callWithOneRetry(batch, options, () =>
          onProgress({ page: done, totalPages, note: 'Free-tier limit reached — waiting to carry on…' })
        )
      } catch (err) {
        // Whatever was read up to here is still worth keeping: importing the
        // first eight pages of a paper beats losing all of it to page nine.
        if (drafts.length === 0) throw err
        stoppedEarly = err instanceof Error ? err.message : 'Reading stopped early.'
        resumeFrom = start
        break
      }

      for (const question of questions) {
        const key = dedupeKey(question.text)
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        drafts.push(toDraft(question, start, drafts.length))
      }

      pagesRead = end - range.from + 1
      onProgress({ page: pagesRead, totalPages, note: `Read ${pagesRead} of ${totalPages} pages…` })
    }
  } finally {
    await doc.destroy()
  }

  return { drafts, pagesRead, stoppedEarly, resumeFrom }
}

function toDraft(question: ExtractedQuestion, page: number, index: number): DraftQuestion {
  return {
    key: `ai-${page}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    questionType: question.type,
    text: question.text,
    options: question.options,
    // A textbook exercise carries no marks at all, so the type's usual value
    // stands in and the review screen's bulk field corrects it in one go.
    marks: question.marks !== null ? String(question.marks) : defaultMarks(question.type),
    chapter: question.chapter ?? '',
    difficulty: '',
    language: question.language,
    translation: question.translation ?? '',
    optionsTranslated: question.optionsTranslated ?? [],
    reason: question.marks !== null ? 'Read by AI' : 'Read by AI — marks not printed',
    uncertain: false,
  }
}

async function renderPageJpegBase64(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not render the PDF pages.')
    // A scan is often grey or transparent at the edges; a white backdrop keeps
    // the contrast the model reads best.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    canvas.width = 0
    canvas.height = 0
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  } finally {
    page.cleanup()
  }
}
