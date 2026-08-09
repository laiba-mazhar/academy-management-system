// Pulls structured questions off pictures of paper pages.
//
// Deploy: supabase functions deploy read-questions
//
// The regex parser in the app reads a paper by its shape — "Q3.", "(a)", a
// marks bracket — and that works well for an English paper exported from Word.
// It has two limits this covers: a scan has no text to shape-match in the first
// place, and Urdu papers number their questions with Urdu digits and run
// right-to-left, so the shapes are not the ones it knows.
//
// A vision model reads the page the way a person does, which is why it is
// language-agnostic in a way the parser cannot be. What it must not do is
// rewrite anything, so the prompt below is written almost entirely as
// prohibitions, and every question still goes through the review screen before
// it reaches the bank.
//
// See _shared/gemini.ts for the API key setup.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callGemini, checkConfigured, requireStaff, type ImagePart } from '../_shared/gemini.ts'

const QUESTION_TYPES = ['mcq', 'short', 'long', 'fill_blank', 'true_false'] as const
type QuestionType = (typeof QUESTION_TYPES)[number]

// At most this many page images in one call. More context helps a question that
// runs over a page break, but the answer has to fit in one response, and a
// truncated JSON array silently loses the last questions on the page.
const MAX_PAGES = 4
// Roughly 6 MB of image data once decoded. Past this the request is more likely
// to time out than to succeed.
const MAX_TOTAL_BASE64 = 8_000_000

function prompt(exercisesOnly: boolean): string {
  return `You are reading ${exercisesOnly ? 'pages of a textbook' : 'pages of an exam paper or question sheet'}. List every question printed on them.

Reproducing the text:
- Output the question exactly as printed, in its own script and language. Urdu stays in Urdu, Arabic in Arabic, English in English. Never translate, transliterate or romanise, whatever language this instruction is written in.
- Preserve mathematical notation using Unicode symbols such as √ π ≤ ≥ ≠ ∫ ² ³ ½ ° θ Δ.
- Do not correct spelling or grammar, do not rephrase, do not shorten, do not add words that are not printed.
- Never answer a question, and never invent one that is not on the page.

Classifying each question, in the "type" field:
- "mcq" — printed with a set of choices to pick from.
- "true_false" — asks whether a statement is true or false.
- "fill_blank" — has a blank, a dash or dots to complete.
- "short" — a few lines of answer: define, state, name, convert, solve one step.
- "long" — an essay, a proof, a derivation, or a question worth many marks.
Use the paper's own section headings when it has them ("Objective", "Short answer", "Attempt any five long questions") — they are more reliable than the wording of a single question.

For an mcq, put the choices in "options", each with the label as printed ("A", "a", "i", "١") and its text. If a question is not an mcq, leave "options" out.

Splitting:
- A numbered question whose parts are each independently answerable — (i), (ii), (iii), or (a), (b), (c) each asking a separate thing — becomes one entry per part. Repeat the shared instruction at the start of each part only if the part cannot be understood without it.
- A question whose parts build on one another, or one stem followed by parts that only make sense together, stays as a single entry with its parts on separate lines.
- A bare marker on its own line — "(i)" with the question on the lines below it — belongs with the text that follows it, as one question.

Do not include the question's own number or label at the start of the text — "Q3.", "Qno: 4", "Question 5:", "3.", "٣". The bank numbers questions itself when it prints them, and a number carried over would be printed twice. Sub-part markers inside a question that stays whole are kept.

Leave out entirely:
- Letterheads, school names, logos, page numbers, headers and footers.
- Instructions and rubrics: "Attempt any five", "Time: 2 hours", "Total marks: 75", "All questions carry equal marks".
- Answer keys, marking schemes and worked solutions.
- Names of sections on their own.
${exercisesOnly ? '- Lesson text, worked examples, definitions and summaries. Take questions ONLY from exercise, review, practice, activity and مشق sections — the parts that ask the student to do something.\n' : ''}
Put the printed marks in "marks" when the page shows them for that question, as a number. Leave "marks" out when the page does not say. Put the chapter or exercise number in "chapter" when the page shows one, like "2.3" or "Exercise 5.1".

If there are no questions on these pages, return an empty list.`
}

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      type: { type: 'STRING' },
      text: { type: 'STRING' },
      options: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { key: { type: 'STRING' }, text: { type: 'STRING' } },
          required: ['key', 'text'],
          propertyOrdering: ['key', 'text'],
        },
      },
      marks: { type: 'NUMBER' },
      chapter: { type: 'STRING' },
    },
    required: ['type', 'text'],
    propertyOrdering: ['type', 'text', 'options', 'marks', 'chapter'],
  },
}

interface RequestBody {
  pages?: ImagePart[]
  exercisesOnly?: boolean
}

interface RawQuestion {
  type?: unknown
  text?: unknown
  options?: unknown
  marks?: unknown
  chapter?: unknown
}

export interface ExtractedQuestion {
  type: QuestionType
  text: string
  options: { key: string; text: string }[]
  marks: number | null
  chapter: string | null
}

// The schema constrains the shape but not the values — "type" is still free
// text, and a model can answer "multiple choice" or "MCQ". Everything is
// narrowed here so the client only ever sees the app's own vocabulary.
// The paper's own numbering must not survive into the bank: the paper builder
// numbers questions itself, so "Qno: 1 Define a natural number" would print as
// "Qno: 3 Qno: 1 Define a natural number". The prompt asks for it to be left
// off; this is the guard for when it is not.
//
// Only an explicitly labelled number is removed. A bare "1)" is left alone
// because it is far more likely to be a sub-part marker, or the start of a
// list of values like "1/4, 3/5".
const OWN_NUMBER = /^\s*q(?:uestion)?\s*\.?\s*(?:no)?\s*[.:\-–]?\s*\d{1,3}\s*[).:\-–]?\s*/i

function normalise(raw: RawQuestion): ExtractedQuestion | null {
  const text = typeof raw.text === 'string' ? raw.text.replace(OWN_NUMBER, '').trim() : ''
  if (!text) return null

  const typeWord = typeof raw.type === 'string' ? raw.type.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
  let type: QuestionType = 'short'
  if ((QUESTION_TYPES as readonly string[]).includes(typeWord)) {
    type = typeWord as QuestionType
  } else if (typeWord.includes('multiple') || typeWord.includes('choice')) {
    type = 'mcq'
  } else if (typeWord.includes('true') || typeWord.includes('false')) {
    type = 'true_false'
  } else if (typeWord.includes('blank') || typeWord.includes('fill')) {
    type = 'fill_blank'
  } else if (typeWord.includes('long') || typeWord.includes('essay')) {
    type = 'long'
  }

  const options: { key: string; text: string }[] = []
  if (Array.isArray(raw.options)) {
    for (const entry of raw.options) {
      const option = entry as { key?: unknown; text?: unknown }
      const optionText = typeof option.text === 'string' ? option.text.trim() : ''
      if (!optionText) continue
      const key = typeof option.key === 'string' && option.key.trim() ? option.key.trim() : ''
      options.push({ key: key || String.fromCharCode(65 + options.length), text: optionText })
    }
  }
  // A question the model labelled mcq but gave no choices for is a short
  // question as far as the paper builder is concerned — an mcq with no options
  // prints as an empty list.
  if (type === 'mcq' && options.length < 2) type = 'short'

  const marksNumber = typeof raw.marks === 'number' ? raw.marks : Number(raw.marks)
  const marks = Number.isFinite(marksNumber) && marksNumber > 0 ? marksNumber : null

  const chapter = typeof raw.chapter === 'string' && raw.chapter.trim() ? raw.chapter.trim() : null

  return { type, text, options, marks, chapter }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const configured = checkConfigured()
  if (!configured.ok) return configured.response

  const staff = await requireStaff(req)
  if (!staff.ok) return staff.response

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const pages = Array.isArray(body.pages) ? body.pages : []
  if (pages.length === 0) {
    return jsonResponse({ error: 'pages is required' }, 400)
  }
  if (pages.length > MAX_PAGES) {
    return jsonResponse({ error: `Send at most ${MAX_PAGES} pages at a time.` }, 400)
  }

  let total = 0
  for (const page of pages) {
    if (!page?.imageBase64) return jsonResponse({ error: 'Every page needs an imageBase64.' }, 400)
    total += page.imageBase64.length
  }
  if (total > MAX_TOTAL_BASE64) {
    return jsonResponse({ error: 'Those pages are too large to read at once. Try fewer pages.' }, 413)
  }

  const result = await callGemini(prompt(body.exercisesOnly === true), pages, {
    maxOutputTokens: 32768,
    responseSchema: RESPONSE_SCHEMA,
  })
  if (!result.ok) return result.response

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    // Structured output makes this unlikely, but a malformed answer must not
    // look like a page with no questions on it.
    return jsonResponse({ error: 'The AI service returned something unreadable. Try those pages again.' }, 502)
  }

  if (!Array.isArray(parsed)) {
    return jsonResponse({ questions: [] })
  }

  const questions = parsed
    .map((entry) => normalise(entry as RawQuestion))
    .filter((q): q is ExtractedQuestion => q !== null)

  return jsonResponse({ questions })
})
