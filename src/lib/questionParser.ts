import type { QuestionDifficulty, QuestionOption, QuestionType } from '@/types/database'

// Turns the text of a past paper — extracted from a PDF or pasted straight out
// of Word — into draft questions for the import review screen.
//
// It is deliberately allowed to be wrong. Every draft is shown to a teacher
// with its type in a dropdown before anything reaches the bank, so the parser
// optimises for "sensible guess, honest about uncertainty" rather than for
// being right every time.

export interface DraftQuestion {
  /** Client-side row key; drafts have no database id until they are saved. */
  key: string
  questionType: QuestionType
  text: string
  options: QuestionOption[]
  /** Kept as a string because it feeds an <input> in the review grid. */
  marks: string
  chapter: string
  difficulty: QuestionDifficulty | ''
  /** Why the parser picked this type — shown as a hint in the review grid. */
  reason: string
  /** The guess came from shape alone. These sort to the top for review. */
  uncertain: boolean
}

export interface ParseResult {
  drafts: DraftQuestion[]
  /** True when the document announced its own sections, i.e. a good parse. */
  sectionsFound: boolean
  /** True when only the exercises of a textbook were taken. */
  exercisesOnly: boolean
}

// A textbook is mostly not questions. Explanation, worked examples and
// definitions all sit above the exercise that actually asks something, and
// importing a chapter wholesale drags them in.
//
// So when a document announces exercises, only the exercises are read. A past
// paper announces none, and is read whole exactly as before — which is what
// keeps this from changing the case that already worked.
const EXERCISE_START = /^\s*(?:review\s+|practice\s+|unit\s+)?(?:exercise|exercises|worksheet)\b|^\s*مشق/i
// "2.4 Adding Rational Numbers" — a numbered chapter heading, not a question,
// which "4." at the start of a line would otherwise look like.
const SECTION_HEADING = /^\s*\d+\.\d+(?:\.\d+)?\s+\p{L}/u
// Prose blocks a textbook puts between exercises.
const PROSE_BLOCK =
  /^\s*(example|solution|summary|activity|key\s*points?|note|remember|definition|introduction|objectives)\b/i

function keepExercisesOnly(lines: string[]): { lines: string[]; filtered: boolean } {
  const startsAt = lines.findIndex((l) => EXERCISE_START.test(l))
  if (startsAt === -1) return { lines, filtered: false }

  const kept: string[] = []
  let inExercise = false
  for (const line of lines) {
    if (EXERCISE_START.test(line)) {
      inExercise = true
      continue // the heading itself is not a question
    }
    // A chapter heading or a worked example closes the exercise above it.
    if (inExercise && (SECTION_HEADING.test(line) || PROSE_BLOCK.test(line))) {
      inExercise = false
      continue
    }
    if (inExercise) kept.push(line)
  }
  return { lines: kept, filtered: true }
}

// "SECTION A", "OBJECTIVE", "Short Questions" … A paper that labels its own
// sections tells us the types outright, which beats every other signal.
const SECTION_PATTERNS: { type: QuestionType; re: RegExp }[] = [
  { type: 'mcq', re: /\b(objective|mcqs?|multiple\s*choice|choose\s+the\s+correct|encircle)\b/i },
  { type: 'long', re: /\b(long|detailed|extensive|essay)\s*(answer|question|type)/i },
  { type: 'short', re: /\b(short)\s*(answer|question|type)/i },
]

// "SECTION A" / "PART-I" on their own carry no type, but they do reset the
// numbering, and in board papers A/I is objective, B/II short, C/III long.
const LETTERED_SECTION = /^\s*(?:section|part)\s*[-–—:]?\s*([abc]|i{1,3})\b/i
const LETTERED_SECTION_TYPE: Record<string, QuestionType> = {
  a: 'mcq',
  i: 'mcq',
  b: 'short',
  ii: 'short',
  c: 'long',
  iii: 'long',
}

// "Qno: 1", "Q.1", "Question 3" — an explicit marker, unambiguous.
const EXPLICIT_Q = /^\s*(?:q(?:uestion)?\s*\.?\s*(?:no)?\s*[.:-]?\s*)(\d{1,2})\s*[).:-]?\s*(.*)$/i
// "1." / "1)" with no Q — only treated as a question when the paper never
// uses explicit markers, otherwise these are sub-parts.
const BARE_NUMBER_Q = /^\s*(\d{1,2})\s*[).]\s*(.+)$/
// "a)", "(b)", "iii." — an option or a sub-part, decided by context.
const OPTION_LETTER = /^\s*\(?([a-hA-H]|i{1,3}v?|iv|v)\)\s*(.*)$/
// "1)" / "2." as a sub-part. Only consulted when bare numbers are not
// starting questions, otherwise every question would swallow the next one.
const OPTION_NUMBER = /^\s*\(?(\d{1,2})[).]\s*(.+)$/
// Markers sharing a line, either as MCQ choices — "(a) 4 (b) 5 (c) 6 (d) 7" —
// or as sub-questions a PDF has run together: "i) Why …? (ii) Why …?". Roman
// numerals are included because that is how sub-questions are usually lettered.
const INLINE_MARKERS = /(?:^|\s)\(?((?:i{1,3}v?|iv|vi{0,3}|ix|xi{0,3}|x|[a-hA-H]))\)\s+/gi
// A trailing "(5)" / "[2 marks]".
const TRAILING_MARKS = /[([]\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*[)\]]\s*$/i
// "Attempt any six questions" — an instruction, not a question.
const INSTRUCTION = /^\s*(attempt|answer)\s+(any|all)\b/i
// "Name: Roll#: Class: Inter Part-II Subject: English-12 Date: Time:" — the
// particulars strip off the top of a paper. Several "Label:" pairs on one line
// is what distinguishes it from a question that merely contains a colon, and
// matching on that rather than on position means it is dropped even when a PDF
// holds several papers back to back, each with its own header.
const PARTICULARS = /(?:\b[A-Za-z#]+\s*:\s*){3,}/
// The same strip when a PDF puts each field on its own line — "Name:",
// "Roll#:", "Class: Inter Part-II". One or two words before the colon is what
// separates a form label from a stem: "Solve the following:" has three.
const FORM_FIELD = /^([^:]{1,24}):\s*\S{0,24}$/
// "(3x2=6)" — three parts worth two marks each. The per-part figure is what a
// split sub-question should carry.
const MARKS_PRODUCT = /\(\s*(\d{1,2})\s*[x×*]\s*(\d+(?:\.\d+)?)\s*=\s*\d+(?:\.\d+)?\s*\)/i
// A stem whose only job is to introduce its sub-parts. When the parts are
// split out, nothing of value is lost by dropping it.
const DIRECTIVE_STEM = /\b(answer|attempt|solve|do|write)\b.{0,40}\b(given|following|these)\b/i

function isFormField(line: string): boolean {
  const match = FORM_FIELD.exec(line)
  return match !== null && match[1].trim().split(/\s+/).length <= 2
}

function normalise(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function detectSection(line: string): QuestionType | null {
  for (const { type, re } of SECTION_PATTERNS) {
    if (re.test(line)) return type
  }
  const lettered = LETTERED_SECTION.exec(line)
  if (lettered) return LETTERED_SECTION_TYPE[lettered[1].toLowerCase()] ?? null
  return null
}

// A line is only a section header if it is short — "Choose the correct answer"
// as a heading, not a sentence that happens to contain the word "objective".
function isSectionHeader(line: string): boolean {
  return line.length <= 70 && detectSection(line) !== null
}

function splitInlineOptions(line: string): QuestionOption[] | null {
  const markers = [...line.matchAll(INLINE_MARKERS)]
  if (markers.length === 0) return null

  // Three or more is unambiguous. Two is only trusted when the line opens with
  // a marker — that is a list, whereas prose merely mentioning "(a) or (b)"
  // does not start with one.
  const opensWithMarker = markers[0].index === 0
  if (markers.length < 3 && !(markers.length === 2 && opensWithMarker)) return null

  const options: QuestionOption[] = []
  markers.forEach((m, i) => {
    const start = m.index! + m[0].length
    const end = i + 1 < markers.length ? markers[i + 1].index! : line.length
    const text = line.slice(start, end).trim()
    if (text) options.push({ key: m[1].toUpperCase(), text })
  })
  return options.length >= 2 ? options : null
}

// Splitting suits sub-parts that are whole questions ("Why is the universe so
// frightening?"). It does not suit the parts of a maths question — "4/7 - 5/14"
// on its own has lost the "Solve" that gave it meaning. Length and a question
// mark separate the two reliably.
function partsLookLikeQuestions(options: QuestionOption[]): boolean {
  const questionMarks = options.filter((o) => o.text.trim().endsWith('?')).length
  const meanLength = options.reduce((sum, o) => sum + o.text.length, 0) / options.length
  return questionMarks >= options.length / 2 || meanLength >= 25
}

// "i) ii) iii)" numbers sub-questions; "a) b) c) d)" offers alternatives. A
// roman sequence is never a set of MCQ choices, and treating it as one both
// mistyped the question and threw its sub-parts away.
function isRomanSequence(options: QuestionOption[]): boolean {
  return options.some((o) => /^(?:II|III|IV|VI{0,3}|IX)$/i.test(o.key))
}

// MCQ choices are a handful of short alternatives. Sub-parts of a maths
// question ("a) 4/7 - 5/14") share the same shape, so length and count are
// what separate them when no section header settled it.
function looksLikeMcqOptions(options: QuestionOption[]): boolean {
  if (options.length < 3 || options.length > 5) return false
  if (isRomanSequence(options)) return false
  return options.every((o) => o.text.length <= 60)
}

interface Building {
  lines: string[]
  options: QuestionOption[]
  marks: string
  sectionType: QuestionType | null
}

export function parseQuestions(raw: string): ParseResult {
  const { lines, filtered: exercisesOnly } = keepExercisesOnly(normalise(raw))
  // A paper that writes "Qno:" uses bare "1)" for sub-parts, so bare numbers
  // must not start questions there. Decided once for the whole document.
  const usesExplicitMarkers = lines.some((l) => EXPLICIT_Q.test(l))

  const drafts: DraftQuestion[] = []
  let sectionType: QuestionType | null = null
  let sectionsFound = false
  let current: Building | null = null
  let started = false

  function flush() {
    if (!current) return
    drafts.push(...finish(current, drafts.length))
    current = null
  }

  for (const line of lines) {
    if (isSectionHeader(line)) {
      flush()
      sectionType = detectSection(line)
      sectionsFound = true
      started = true
      continue
    }

    if (INSTRUCTION.test(line) || PARTICULARS.test(line) || isFormField(line)) {
      flush()
      continue
    }

    // Inside an objective section every numbered item is its own MCQ, even in
    // a paper that otherwise writes "Q.1" — board papers restart the numbering
    // per section. Anywhere else, a bare number under an explicit-marker paper
    // is a sub-part of the question above it.
    const bareStartsQuestion = !usesExplicitMarkers || sectionType === 'mcq'
    const explicit = usesExplicitMarkers ? EXPLICIT_Q.exec(line) : null
    const bare = bareStartsQuestion ? BARE_NUMBER_Q.exec(line) : null
    const start = explicit ?? bare
    if (start) {
      flush()
      started = true
      current = { lines: start[2] ? [start[2]] : [], options: [], marks: '', sectionType }
      const marks = TRAILING_MARKS.exec(line)
      if (marks) {
        current.marks = marks[1]
        current.lines = current.lines.map((l) => l.replace(TRAILING_MARKS, '').trim())
      }
      continue
    }

    // Everything above the first question or section header is letterhead —
    // school name, address, the NAME/ROLL NO grid. Dropping by position
    // rather than by pattern means it works for any school's template.
    if (!started) continue
    if (!current) continue

    const inline = splitInlineOptions(line)
    if (inline) {
      current.options.push(...inline)
      continue
    }

    const option = OPTION_LETTER.exec(line) ?? (bareStartsQuestion ? null : OPTION_NUMBER.exec(line))
    if (option && option[2]) {
      current.options.push({ key: option[1].toUpperCase(), text: option[2].trim() })
      continue
    }

    const marks = TRAILING_MARKS.exec(line)
    if (marks && !current.marks) current.marks = marks[1]
    current.lines.push(line.replace(TRAILING_MARKS, '').trim())
  }

  flush()
  return { drafts, sectionsFound, exercisesOnly }
}

function finish(building: Building, index: number): DraftQuestion[] {
  const text = building.lines.join(' ').trim()
  if (!text && building.options.length === 0) return []

  const product = MARKS_PRODUCT.exec(text)
  // "Answer the given questions from Book-II Part-II. (3x2=6)" with nothing
  // under it — a group this paper left empty. It introduces sub-parts that do
  // not exist, so it is not a question.
  if (building.options.length === 0 && product && DIRECTIVE_STEM.test(text)) return []

  const { type, reason, uncertain } = classify(building, text)
  const isMcq = type === 'mcq'

  // "Answer the given questions… i) … ii) … iii)" is three questions wearing
  // one number. A bank wants them apart: each is independently reusable, and a
  // paper can group them again through a section. Only split when the stem is
  // pure scaffolding, so a maths question keeps "Solve the following:" over
  // its parts.
  const splittable =
    !isMcq &&
    building.options.length >= 2 &&
    (product !== null || DIRECTIVE_STEM.test(text)) &&
    partsLookLikeQuestions(building.options)

  if (splittable) {
    const perPart = product ? product[2] : building.marks || defaultMarks(type)
    // The whole question's type described the whole question. Two marks apiece
    // makes each split part a short question, whatever the parent looked like.
    const partType = typeForMarks(Number(perPart), type)
    return building.options.map((part, i) => ({
      key: `draft-${index}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      questionType: partType,
      text: part.text,
      options: [],
      marks: perPart,
      chapter: '',
      difficulty: '',
      reason: product ? `Split — ${product[2]} marks each` : 'Split from a list',
      uncertain: false,
    }))
  }

  // Not split: the parts fold back into the text as the newline form the exam
  // paper renderer already understands.
  const body =
    isMcq || building.options.length === 0
      ? text
      : [text, ...building.options.map((o) => `${o.key.toLowerCase()}) ${o.text}`)].filter(Boolean).join('\n')

  return [
    {
      key: `draft-${index}-${Math.random().toString(36).slice(2, 8)}`,
      questionType: type,
      text: body,
      options: isMcq ? building.options : [],
      marks: building.marks || defaultMarks(type),
      chapter: '',
      difficulty: '',
      reason,
      uncertain,
    },
  ]
}

function classify(building: Building, text: string): { type: QuestionType; reason: string; uncertain: boolean } {
  const mcqShaped = looksLikeMcqOptions(building.options)

  // A section header is the strongest signal in the document.
  if (building.sectionType) {
    // …but a maths question with two sub-parts sitting in a "short questions"
    // section is still a short question, so only trust the MCQ label when the
    // shape agrees.
    if (building.sectionType !== 'mcq' || mcqShaped || building.options.length === 0) {
      return { type: building.sectionType, reason: 'From section heading', uncertain: false }
    }
  }

  if (mcqShaped) {
    return { type: 'mcq', reason: `${building.options.length} short options`, uncertain: !building.sectionType }
  }

  if (building.marks) {
    const marks = Number(building.marks)
    if (marks <= 1) return { type: 'mcq', reason: '1 mark', uncertain: true }
    if (marks >= 5) return { type: 'long', reason: `${marks} marks`, uncertain: false }
    return { type: 'short', reason: `${marks} marks`, uncertain: false }
  }

  if (/^(true|false)\b/i.test(text) || /\btrue\s*\/\s*false\b/i.test(text)) {
    return { type: 'true_false', reason: 'Mentions true/false', uncertain: true }
  }

  if (/_{3,}|\.{4,}/.test(text)) {
    return { type: 'fill_blank', reason: 'Contains a blank', uncertain: true }
  }

  if (building.options.length > 0 || text.length > 160) {
    return { type: 'long', reason: 'Has sub-parts or is long', uncertain: true }
  }

  return { type: 'short', reason: 'Short single question', uncertain: true }
}

function typeForMarks(marks: number, fallback: QuestionType): QuestionType {
  if (!Number.isFinite(marks) || marks <= 0) return fallback
  if (marks <= 1) return 'short'
  if (marks >= 5) return 'long'
  return 'short'
}

function defaultMarks(type: QuestionType): string {
  if (type === 'mcq' || type === 'true_false' || type === 'fill_blank') return '1'
  if (type === 'long') return '5'
  return '2'
}

// A textbook repeats a running head or foot on every page — "Mathematics 7 45",
// "Chapter 2 — Rational Numbers". OCR has no idea those are furniture, so they
// end up glued to whatever question sits nearest the edge of the page.
//
// They are recognised by repetition rather than by pattern: a short line at the
// top or bottom of two or more pages, identical once its page number is
// removed, is furniture. That cannot misfire on a one-off line, which a real
// question always is.
const MAX_RUNNING_HEAD = 60

function headKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[0-9]+/g, '')
    .replace(/[^a-z\u0600-\u06FF]+/g, '')
}

export function stripRunningHeaders(pages: string[]): string[] {
  if (pages.length < 2) return pages

  const seen = new Map<string, number>()
  const edgesOf = (page: string) => {
    const lines = page.split('\n').map((l) => l.trim()).filter(Boolean)
    return [...lines.slice(0, 2), ...lines.slice(-2)]
  }

  for (const page of pages) {
    // Per page, so a head appearing twice on one page still counts once.
    const keys = new Set(
      edgesOf(page)
        .filter((l) => l.length <= MAX_RUNNING_HEAD)
        .map(headKey)
        .filter((k) => k.length >= 3)
    )
    for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  const furniture = new Set([...seen].filter(([, n]) => n >= 2).map(([key]) => key))
  if (furniture.size === 0) return pages

  return pages.map((page) => {
    const lines = page.split('\n').map((l) => l.trim()).filter(Boolean)
    const isFurniture = (i: number) =>
      (i < 2 || i >= lines.length - 2) &&
      lines[i].length <= MAX_RUNNING_HEAD &&
      furniture.has(headKey(lines[i]))
    return lines.filter((_, i) => !isFurniture(i)).join('\n')
  })
}

// Text recognition on a page it cannot read does not return nothing — it
// returns plausible-looking wreckage: "Teer pi ——— 'eo, Po if(units <= 200)".
// Tesseract's own confidence does not catch this on a mixed page, because the
// bits it *can* read (English code in an Urdu computing book, say) score well
// and pull the average up.
//
// Measured against real samples, what separates wreckage from prose is not
// spelling but shape: recognition failure shatters words into one- and
// two-character fragments and litters them with stray symbols. A page of real
// questions sits far below both thresholds even when it is full of source
// code, which is the closest legitimate text gets to looking like noise.
//
// This only ever raises a warning — the recognised text is shown for a human
// to judge either way, because no threshold survives every kind of paper.
const GIBBERISH_MIN_WORDS = 25
const SHORT_TOKEN_LIMIT = 0.45
const MIXED_SHORT_LIMIT = 0.35
const SYMBOL_TOKEN_LIMIT = 0.18

export function looksLikeGibberish(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < GIBBERISH_MIN_WORDS) return false // too little to judge fairly

  const short = words.filter((w) => w.length <= 2).length / words.length
  // A token carrying both letters and punctuation — "AE.T-P", "#-C(Code".
  const symbolly =
    words.filter((w) => /\p{L}/u.test(w) && /[^\p{L}\p{N}]/u.test(w)).length / words.length

  return short > SHORT_TOKEN_LIMIT || (short > MIXED_SHORT_LIMIT && symbolly > SYMBOL_TOKEN_LIMIT)
}

// Two questions imported from ten years of past papers are very often the same
// question with different spacing or punctuation. Comparing on a stripped form
// catches those without needing anything cleverer.
export function dedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '')
    .slice(0, 120)
}
