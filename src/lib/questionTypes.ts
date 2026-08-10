import type { QuestionType } from '@/types/database'

// Shared so the question bank, the import review grid and the paper builder
// all name a type the same way.
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'MCQ',
  short: 'Short',
  long: 'Long',
  fill_blank: 'Fill in the blank',
  true_false: 'True / False',
}

export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]

// Which types belong in which half of a paper. The objective part is the one a
// student answers by picking or filling, and the subjective part the one they
// write out — so offering a five-mark long question for an MCQ section is
// always a mistake, not a preference.
export const OBJECTIVE_TYPES: QuestionType[] = ['mcq', 'true_false', 'fill_blank']
export const SUBJECTIVE_TYPES: QuestionType[] = ['short', 'long']

export function typesForPart(part: 'objective' | 'subjective'): QuestionType[] {
  return part === 'objective' ? OBJECTIVE_TYPES : SUBJECTIVE_TYPES
}

// Section headings, as a paper would name them. The short labels above are for
// badges and dropdowns, where "Multiple Choice Questions" would not fit.
export const QUESTION_TYPE_SECTIONS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice Questions',
  true_false: 'True or False',
  fill_blank: 'Fill in the Blanks',
  short: 'Short Questions',
  long: 'Long Questions',
}

// The order sections appear in, objective before written, matching the two
// halves of a printed paper. Used by the bank on screen and in print so a
// teacher reading one recognises the other.
export const SECTION_ORDER: QuestionType[] = ['mcq', 'true_false', 'fill_blank', 'short', 'long']

/** Splits questions into sections in SECTION_ORDER, dropping empty ones. */
export function bySection<T extends { question_type: QuestionType }>(
  questions: T[]
): { type: QuestionType; title: string; items: T[] }[] {
  return SECTION_ORDER.map((type) => ({
    type,
    title: QUESTION_TYPE_SECTIONS[type],
    items: questions.filter((q) => q.question_type === type),
  })).filter((section) => section.items.length > 0)
}
