// How questions are grouped into chapters, shared by the bank's print dialog
// and the printed sheet so the two always agree on what a chapter is.

/** Questions with no chapter recorded are grouped under this, and sort last. */
export const UNFILED = 'Unfiled'

/** The key a question groups under. Blank and whitespace both mean unfiled. */
export function chapterKey(chapter: string | null): string {
  return chapter?.trim() || UNFILED
}

/**
 * Chapters sort by their number, so Chapter 10 follows Chapter 9 rather than
 * Chapter 1. A chapter with a name but no number sorts after the numbered
 * ones, and Unfiled after everything.
 */
export function chapterOrder(name: string): number {
  if (name === UNFILED) return Number.MAX_SAFE_INTEGER
  const match = /(\d+)/.exec(name)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER - 1
}
