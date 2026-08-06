import type { ExamPart, QuestionOption, QuestionType } from '@/types/database'

// Shared definition of a Maktab question paper, so the on-screen preview, the
// browser print output and the downloaded PDF all describe the same document
// instead of three drifting approximations of it.

export const SCHOOL_NAME = 'MAKTAB'
export const SCHOOL_TAGLINE = 'THE EDUCATIONAL INSTITUTE'
export const SCHOOL_ADDRESS =
  'ITTHAD PARK, USAMAN E GHANI ROAD, BANK STOP, CHUNGI AMAR SIDHU, LAHORE'

// Sampled from the letterhead the school already uses in Word: the rule under
// the crest and the serif tagline above it.
export const RULE_BLUE = '#4f81bd'
export const TAGLINE_NAVY = '#17365d'

export interface QuestionPart {
  /** "a)", "2)" … empty for a wrapped continuation of the previous part. */
  marker: string
  text: string
}

export interface ParsedQuestion {
  stem: string
  parts: QuestionPart[]
}

// Teachers type sub-parts as their own lines inside one question, exactly the
// way they appear on the printed paper:
//
//   Solve the following:
//   a) 4/7 - 5/14
//   b) -4/15 - 8/25
//
// so a leading "a)" / "1)" / "(i)" marker is what promotes a line to a part.
const PART_MARKER = /^\(?([A-Za-z]|[0-9]{1,2}|[ivxIVX]{1,4})[).]\s*(.*)$/

export function parseQuestionText(raw: string): ParsedQuestion {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const stem: string[] = []
  const parts: QuestionPart[] = []

  for (const line of lines) {
    const match = PART_MARKER.exec(line)
    if (match) {
      parts.push({ marker: `${match[1]})`, text: match[2] })
    } else if (parts.length === 0) {
      stem.push(line)
    } else {
      // An unmarked line after a part is that part running onto a second line.
      parts[parts.length - 1].text += ` ${line}`
    }
  }

  return { stem: stem.join(' '), parts }
}

// "TIME 1 HOUR" on the sample paper. Minutes are what the exam row stores.
export function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return ''
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  const chunks: string[] = []
  if (hours > 0) chunks.push(`${hours} ${hours === 1 ? 'HOUR' : 'HOURS'}`)
  if (mins > 0) chunks.push(`${mins} MIN`)
  return chunks.join(' ')
}

/** Only the parts of a bank question that end up printed on the paper. */
export interface PaperQuestion {
  question_text: string
  question_type?: QuestionType
  options?: QuestionOption[] | null
  marks?: number
  /** Sub-parts to print, as indexes into the parsed parts. Null = all. */
  partIndexes?: number[] | null
}

export interface PaperSection {
  title: string
  instruction: string | null
  /** Attempt-any-N. Null means every question must be attempted. */
  chooseCount: number | null
  questions: PaperQuestion[]
}

export interface PaperPart {
  part: ExamPart
  sections: PaperSection[]
}

export interface QuestionPaper {
  examName: string
  className: string
  subjectName: string
  totalMarks: number
  durationMinutes: number | null
  parts: PaperPart[]
}

// jsPDF can embed a Unicode font but cannot do the contextual letter-joining
// or right-to-left layout Arabic script needs, so an Urdu paper downloads as
// disconnected letters in the wrong order. The browser's print engine does all
// of that correctly, so those papers are pointed at Print instead.
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

export function usesArabicScript(parts: PaperPart[]): boolean {
  return parts.some((part) =>
    part.sections.some(
      (section) =>
        ARABIC_SCRIPT.test(section.title) ||
        ARABIC_SCRIPT.test(section.instruction ?? '') ||
        section.questions.some(
          (q) =>
            ARABIC_SCRIPT.test(q.question_text) ||
            (q.options ?? []).some((o) => ARABIC_SCRIPT.test(o.text))
        )
    )
  )
}

export const PART_LABELS: Record<ExamPart, string> = {
  objective: 'OBJECTIVE PART',
  subjective: 'SUBJECTIVE PART',
}

// The sub-parts a paper actually prints for a question. A teacher can put
// question 4 on the paper with only parts (a) and (c) of the four in the bank.
export function visibleParts(question: PaperQuestion): QuestionPart[] {
  const { parts } = parseQuestionText(question.question_text)
  if (!question.partIndexes) return parts
  const wanted = new Set(question.partIndexes)
  return parts.filter((_, i) => wanted.has(i))
}

// What a section contributes to the paper total. With "attempt any six of
// nine" a student can only earn the six best-marked ones, so counting all
// nine would overstate the paper by a third.
export function sectionMarks(section: PaperSection): number {
  const marks = section.questions.map((q) => q.marks ?? 0)
  if (section.chooseCount === null) return marks.reduce((sum, m) => sum + m, 0)
  return [...marks]
    .sort((a, b) => b - a)
    .slice(0, section.chooseCount)
    .reduce((sum, m) => sum + m, 0)
}

export function paperMarks(parts: PaperPart[]): number {
  return parts.reduce(
    (sum, part) => sum + part.sections.reduce((s, section) => s + sectionMarks(section), 0),
    0
  )
}

/** Continuous 1..N numbering across the whole paper, section headings aside. */
export function numberedQuestions(parts: PaperPart[]): Map<PaperQuestion, number> {
  const numbers = new Map<PaperQuestion, number>()
  let n = 0
  for (const part of parts) {
    for (const section of part.sections) {
      for (const question of section.questions) numbers.set(question, ++n)
    }
  }
  return numbers
}
