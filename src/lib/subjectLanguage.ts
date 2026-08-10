// Whether a subject is one where a translation would destroy the question.
//
// A maths or physics question means the same thing in Urdu and in English, so
// keeping both is useful. A language subject is the opposite: "underline the
// correct spelling", a Tarjama tul Quran passage, an English comprehension —
// the language *is* the thing being examined, and translating the question
// removes it. Those subjects keep only what was printed.
//
// This is only ever a first guess at the moment a subject is created. The real
// answer is subjects.translate_questions, which a teacher can change; the same
// patterns backfill that column in 20260803000001_question_translations.sql,
// and the two lists are meant to stay in step.
const LANGUAGE_SUBJECT = [
  /urdu|اردو/i,
  /english|انگریزی/i,
  /arabic|عربی/i,
  /tarjama|tarjuma|tarjima|ترجمہ/i,
  /quran|qur'?an|قرآن/i,
  /nazra|ناظرہ/i,
  /islamiat|اسلامیات/i,
]

export function looksLikeLanguageSubject(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return LANGUAGE_SUBJECT.some((pattern) => pattern.test(trimmed))
}
