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
