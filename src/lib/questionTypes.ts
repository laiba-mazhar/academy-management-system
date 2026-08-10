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
