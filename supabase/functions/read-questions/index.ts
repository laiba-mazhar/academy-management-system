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

// Asked for only where a translation is meaningful. The academy teaches the
// same maths to Urdu-medium and English-medium classes, so one question is
// wanted in both; a language subject is the opposite case and is excluded by
// the caller, because translating "underline the correct spelling" removes the
// thing being examined.
//
// The original is never displaced by this: "text" stays exactly as printed and
// the other language goes in its own field.
const TRANSLATION_RULES = `
Translating:
- Set "language" to the language the question is printed in: "ur" for Urdu, "en" for English.
- Put the same question in the other language in "translation" — English if the page is Urdu, Urdu if the page is English. Never change "text" itself.
- Translate the meaning as a teacher would set the same question to the other medium, not word by word. Keep every number, symbol, unit and proper noun exactly as it is.
- For an mcq, translate the choices too, into "options_translated", using the same labels in the same order as "options".
- If a question cannot be carried into the other language without changing what it tests — it is about grammar, spelling, poetry, or a passage in the printed language itself — leave "translation" out rather than forcing one.`

function prompt(exercisesOnly: boolean, translate: boolean): string {
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

Splitting — this matters more than anything else here:
- A question printed with enumerated parts — (i), (ii), (iii), or (a), (b), (c), or 1., 2., 3. — becomes ONE ENTRY PER PART. Always. A stem with six parts is six questions, not one.
- Carry the shared instruction into every part, so each one stands alone. "Find the value of x in each of the following:" over "(i) log₂ 1024 = x" becomes the single entry "Find the value of x: log₂ 1024 = x". Do this even when the part is meaningless without the stem — especially then.
- Do not put the part marker in the text. The bank numbers questions itself.
- The only exception is a part that needs another part's answer — "using your result from (i)". Those stay together as one entry.
- A bare marker on its own line — "(i)" with the question on the lines below it — belongs with the text that follows it, as one question.

Do not include the question's own number or label at the start of the text — "Q3.", "Qno: 4", "Question 5:", "3.", "٣". The bank numbers questions itself when it prints them, and a number carried over would be printed twice. Sub-part markers inside a question that stays whole are kept.

Leave out entirely:
- Letterheads, school names, logos, page numbers, headers and footers.
- Instructions and rubrics: "Attempt any five", "Time: 2 hours", "Total marks: 75", "All questions carry equal marks".
- Answer keys, marking schemes and worked solutions.
- Names of sections on their own.
${exercisesOnly ? '- Lesson text, worked examples, definitions and summaries. Take questions ONLY from exercise, review, practice, activity and مشق sections — the parts that ask the student to do something.\n' : ''}
Put the printed marks in "marks" when the page shows them for that question, as a number. Leave "marks" out when the page does not say.

Say which chapter each question belongs to, in "chapter", as "Chapter 5". Work it out from whatever the page shows, in this order of preference:
- A chapter heading on the page: "Chapter 5", "Unit 5", "باب ٥".
- The running head along the top or bottom of the page, which usually repeats the chapter.
- The exercise number: "Exercise 5.1" and "مشق ٥٫١" both mean Chapter 5.
Use the digits as a plain number even when the page prints them in Urdu or Arabic numerals, so "باب ٥" becomes "Chapter 5". If nothing on the page says which chapter it is, leave "chapter" out rather than guessing — the app carries the chapter forward from the pages before it.
${translate ? TRANSLATION_RULES : ''}
If there are no questions on these pages, return an empty list.`
}

const OPTION_LIST = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { key: { type: 'STRING' }, text: { type: 'STRING' } },
    required: ['key', 'text'],
    propertyOrdering: ['key', 'text'],
  },
}

// Built per request: asking for translation fields on a language subject would
// invite the model to fill them in anyway.
function responseSchema(translate: boolean) {
  const properties: Record<string, unknown> = {
    type: { type: 'STRING' },
    text: { type: 'STRING' },
    options: OPTION_LIST,
    marks: { type: 'NUMBER' },
    chapter: { type: 'STRING' },
  }
  const ordering = ['type', 'text', 'options', 'marks', 'chapter']

  if (translate) {
    properties.language = { type: 'STRING' }
    properties.translation = { type: 'STRING' }
    properties.options_translated = OPTION_LIST
    ordering.push('language', 'translation', 'options_translated')
  }

  return {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties,
      required: ['type', 'text'],
      propertyOrdering: ordering,
    },
  }
}

interface RequestBody {
  pages?: ImagePart[]
  exercisesOnly?: boolean
  /** Off for language subjects, where a translation replaces what is examined. */
  translate?: boolean
}

interface RawQuestion {
  type?: unknown
  text?: unknown
  options?: unknown
  marks?: unknown
  chapter?: unknown
  language?: unknown
  translation?: unknown
  options_translated?: unknown
}

type QuestionLanguage = 'ur' | 'en'

export interface ExtractedQuestion {
  type: QuestionType
  text: string
  options: { key: string; text: string }[]
  marks: number | null
  chapter: string | null
  language: QuestionLanguage | null
  translation: string | null
  optionsTranslated: { key: string; text: string }[]
}

// Arabic script is the tell for Urdu. Used when the model does not label the
// language, so a row is never left unlabelled just because a field was missed.
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

function optionList(raw: unknown): { key: string; text: string }[] {
  const list: { key: string; text: string }[] = []
  if (!Array.isArray(raw)) return list
  for (const entry of raw) {
    const option = entry as { key?: unknown; text?: unknown }
    const text = typeof option.text === 'string' ? option.text.trim() : ''
    if (!text) continue
    const key = typeof option.key === 'string' && option.key.trim() ? option.key.trim() : ''
    list.push({ key: key || String.fromCharCode(65 + list.length), text })
  }
  return list
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

// Chapters are wanted in one shape — "Chapter 5" — so the bank groups and
// prints tidily instead of scattering the same chapter across "Ch 5",
// "Exercise 5.1", "Unit 5" and "٥". Urdu and Arabic digits are folded to
// Western ones first, because a textbook prints them in its own script.
const EASTERN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

function normaliseChapter(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[٠-٩۰-۹]/g, (d) => EASTERN_DIGITS[d] ?? d).trim()
  if (!text) return null

  // "Chapter 5", "Ch. 5", "Unit 5", "باب 5", "Exercise 5.1", or a bare "5" —
  // in every case the leading number is the chapter.
  const match = /(\d{1,2})/.exec(text)
  if (!match) return text // a named chapter with no number: keep it as written
  return `Chapter ${Number(match[1])}`
}

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

  const options = optionList(raw.options)
  // A question the model labelled mcq but gave no choices for is a short
  // question as far as the paper builder is concerned — an mcq with no options
  // prints as an empty list.
  if (type === 'mcq' && options.length < 2) type = 'short'

  const marksNumber = typeof raw.marks === 'number' ? raw.marks : Number(raw.marks)
  const marks = Number.isFinite(marksNumber) && marksNumber > 0 ? marksNumber : null

  const chapter = normaliseChapter(raw.chapter)

  const languageWord = typeof raw.language === 'string' ? raw.language.trim().toLowerCase() : ''
  const language: QuestionLanguage =
    languageWord === 'ur' || languageWord === 'urdu'
      ? 'ur'
      : languageWord === 'en' || languageWord === 'english'
        ? 'en'
        : ARABIC_SCRIPT.test(text)
          ? 'ur'
          : 'en'

  // A translation identical to the original is the model echoing rather than
  // translating, which is worth nothing and only clutters the review screen.
  const translationText = typeof raw.translation === 'string' ? raw.translation.trim() : ''
  const translation = translationText && translationText !== text ? translationText : null

  return {
    type,
    text,
    options,
    marks,
    chapter,
    language,
    translation,
    // Choices without a translated stem would print half in each language.
    optionsTranslated: translation ? optionList(raw.options_translated) : [],
  }
}

// Splitting enumerated parts, again, in code.
//
// The prompt asks for it and mostly gets it, but "one entry per part" is a
// judgement the model can talk itself out of — a part like "log₂ 1024 = x"
// reads as meaningless without its stem, so it keeps the six together and a
// teacher gets one question where they wanted six. A prompt cannot be relied
// on for something this structural, so it is enforced here too.
//
// Only a run of markers that actually counts up is split. A stray "(i)" in a
// sentence, or a reference to "(ii)" in a later part, does not form a sequence
// and is left alone.
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']
const LETTERS = 'abcdefghijkl'.split('')
const PART_LINE = /^\s*[(\[]?\s*([ivx]{1,4}|[a-l]|\d{1,2})\s*[).\]]\s*(.+)$/i
// "using your answer from (i)" — the one case where parts truly cannot stand
// apart, so they stay as they were printed.
const DEPENDS_ON_EARLIER = /\b(above|previous|part\s*\(?[ivxa-l\d]|your\s+(answer|result))\b/i

/** Whether the markers are the opening run of one of the schemes we know. */
function isSequence(markers: string[]): boolean {
  if (markers.length < 2) return false
  const lower = markers.map((m) => m.toLowerCase())
  const schemes = [ROMAN, LETTERS, Array.from({ length: 12 }, (_, i) => String(i + 1))]
  return schemes.some((scheme) => lower.every((m, i) => m === scheme[i]))
}

function splitEnumeratedParts(text: string): string[] {
  if (DEPENDS_ON_EARLIER.test(text)) return [text]

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 3) return [text]

  const stem: string[] = []
  const markers: string[] = []
  const bodies: string[] = []
  for (const line of lines) {
    const match = PART_LINE.exec(line)
    if (match && (markers.length > 0 || stem.length > 0)) {
      markers.push(match[1])
      bodies.push(match[2].trim())
    } else if (markers.length === 0) {
      stem.push(line)
    } else {
      // A continuation line under a part belongs to that part.
      bodies[bodies.length - 1] += ' ' + line
    }
  }

  if (!isSequence(markers)) return [text]

  // The stem is repeated into each part so every question stands alone, which
  // is the whole point — the part on its own is not answerable.
  const lead = stem.join(' ').trim()
  return bodies.map((body) => (lead ? `${lead} ${body}` : body).replace(/\s+/g, ' ').trim())
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

  const translate = body.translate === true
  const result = await callGemini(prompt(body.exercisesOnly === true, translate), pages, {
    maxOutputTokens: 32768,
    responseSchema: responseSchema(translate),
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
    .flatMap((q) => {
      // An mcq's choices live in options, so its text never carries a marker
      // list; splitting one would take it apart at its own answer options.
      if (q.type === 'mcq') return [q]
      const parts = splitEnumeratedParts(q.text)
      if (parts.length < 2) return [q]

      // The translation was written for the whole thing, so it is split the
      // same way and paired up part for part. Only when it yields the same
      // number of parts, though — pairing a six-part question against a
      // four-part translation would attach the wrong English to the wrong
      // Urdu, which is worse than having none.
      const translatedParts = q.translation ? splitEnumeratedParts(q.translation) : []
      const paired = translatedParts.length === parts.length

      // Marks stay as printed rather than being divided: a paper writing
      // "(6x2=12)" already gives the per-part figure, and halving a guess is
      // no better than keeping it.
      return parts.map((text, i) => ({
        ...q,
        text,
        translation: paired ? translatedParts[i] : null,
        optionsTranslated: [],
      }))
    })

  return jsonResponse({ questions })
})
