import type { QuestionOption, QuestionType } from '@/types/database'

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
}

export interface QuestionPaper {
  examName: string
  className: string
  subjectName: string
  totalMarks: number
  durationMinutes: number | null
  questions: PaperQuestion[]
}
