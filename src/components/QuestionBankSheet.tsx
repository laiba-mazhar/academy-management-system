import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from '@/assets/maktab_logo_transparent.png'
import { RULE_BLUE, SCHOOL_ADDRESS, SCHOOL_NAME, SCHOOL_TAGLINE, TAGLINE_NAVY } from '@/lib/examPaper'
import { chapterKey, chapterOrder } from '@/lib/chapters'
import { bySection } from '@/lib/questionTypes'
import type { Question } from '@/types/database'

// The question bank as a printed booklet: the same letterhead, rule and
// washed-out crest as a question paper, so a chapter handed to a teacher looks
// like it came from the same school as the exam.
//
// Grouped by chapter, because that is how a teacher works through a syllabus
// and how the questions were filed on the way in. Everything is in millimetres
// against A4 for the same reason as the exam sheet — the preview is the printed
// size, and printing needs no scaling.

export interface QuestionBankSheetProps {
  questions: Question[]
  subjectName: string
  className: string
}

export function QuestionBankSheet({ questions, subjectName, className }: QuestionBankSheetProps) {
  // Chapter first, then a section per kind of question within it, the way a
  // paper is laid out — objective before written. A teacher building a paper
  // reads down to the section they need rather than sifting a mixed list.
  const chapters = useMemo(() => {
    const groups = new Map<string, Question[]>()
    for (const q of questions) {
      const key = chapterKey(q.chapter)
      const list = groups.get(key)
      if (list) list.push(q)
      else groups.set(key, [q])
    }
    return [...groups.entries()]
      .sort((a, b) => chapterOrder(a[0]) - chapterOrder(b[0]) || a[0].localeCompare(b[0]))
      .map(([chapter, list]) => ({ chapter, total: list.length, sections: bySection(list) }))
  }, [questions])

  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0)

  return (
    <div
      className="exam-paper relative mx-auto bg-white text-black"
      style={{ width: '210mm', minHeight: '297mm', padding: '12mm 5mm 14mm' }}
    >
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        className="exam-watermark pointer-events-none absolute left-1/2 select-none"
        style={{ top: '64mm', width: '183mm', transform: 'translateX(-50%)', opacity: 0.1 }}
      />

      <header className="relative">
        <img
          src={logoUrl}
          alt="Maktab - The Educational Institute crest"
          className="absolute left-0 top-0"
          style={{ height: '20mm' }}
        />
        <p className="text-center font-bold leading-tight" style={{ fontSize: '18pt' }}>
          {SCHOOL_NAME}
        </p>
        <p
          className="text-center leading-tight"
          style={{ fontSize: '16pt', color: TAGLINE_NAVY, fontFamily: 'Cambria, Georgia, "Times New Roman", serif' }}
        >
          {SCHOOL_TAGLINE}
        </p>
        <div style={{ height: '1pt', background: RULE_BLUE, marginLeft: '30mm', marginTop: '1mm' }} />
        <p className="text-center" style={{ fontSize: '8.5pt', marginTop: '2.5mm', paddingLeft: '26mm' }}>
          {SCHOOL_ADDRESS}
        </p>
      </header>

      <div
        className="relative flex items-baseline justify-between font-bold"
        style={{ fontSize: '10pt', marginTop: '4mm' }}
      >
        <span>{className}</span>
        <span>QUESTION BANK — {subjectName.toUpperCase()}</span>
        <span>{questions.length} QUESTIONS</span>
      </div>
      <div style={{ height: '0.5pt', background: '#000', marginTop: '1.5mm' }} />

      {questions.length === 0 ? (
        <p className="relative text-center" style={{ fontSize: '11pt', marginTop: '20mm' }}>
          No questions match the current filters.
        </p>
      ) : (
        chapters.map(({ chapter, total, sections }) => (
          // break-inside-avoid on the headings alone, not the whole chapter: a
          // chapter can easily be longer than a page, and avoiding a break
          // across it would push the whole thing onto a fresh sheet and leave
          // most of the previous one blank.
          <section key={chapter} className="relative" style={{ marginTop: '6mm' }}>
            <h2
              className="font-bold"
              style={{ fontSize: '11.5pt', breakAfter: 'avoid', breakInside: 'avoid' }}
            >
              {chapter}
              <span className="font-normal" style={{ fontSize: '9pt' }}>
                {'  '}· {total} question{total === 1 ? '' : 's'}
              </span>
            </h2>
            <div style={{ height: '0.5pt', background: RULE_BLUE, marginTop: '1mm', marginBottom: '2mm' }} />

            {sections.map((section) => (
            <div key={section.type} style={{ marginBottom: '3mm' }}>
            <h3
              className="font-bold uppercase"
              style={{ fontSize: '9.5pt', letterSpacing: '0.02em', breakAfter: 'avoid', breakInside: 'avoid', marginBottom: '1.5mm' }}
            >
              {section.title}
              <span className="font-normal normal-case" style={{ fontSize: '8.5pt' }}>
                {'  '}({section.items.length})
              </span>
            </h3>
            <ol style={{ fontSize: '10.5pt' }}>
              {section.items.map((q, i) => (
                <li key={q.id} style={{ marginBottom: '2.5mm', breakInside: 'avoid' }}>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 font-bold" style={{ minWidth: '8mm' }}>
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* dir="auto" so an Urdu question sets itself right to
                          left on the page, as it is written. */}
                      <p dir="auto" className="whitespace-pre-line">
                        {q.question_text}
                      </p>

                      {q.options && q.options.length > 0 && (
                        <div className="flex flex-wrap" style={{ gap: '0 6mm', marginTop: '0.5mm' }}>
                          {q.options.map((o) => (
                            <span key={o.key} dir="auto">
                              ({o.key}) {o.text}
                            </span>
                          ))}
                        </div>
                      )}

                      {q.translation && (
                        <p dir="auto" className="whitespace-pre-line" style={{ marginTop: '0.5mm' }}>
                          {q.translation}
                        </p>
                      )}
                      {q.options_translated && q.options_translated.length > 0 && (
                        <div className="flex flex-wrap" style={{ gap: '0 6mm' }}>
                          {q.options_translated.map((o) => (
                            <span key={o.key} dir="auto">
                              ({o.key}) {o.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* The kind of question is the section heading now, so
                        only the marks are worth repeating per row. */}
                    <span className="shrink-0 whitespace-nowrap" style={{ fontSize: '8.5pt' }}>
                      {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            </div>
            ))}
          </section>
        ))
      )}

      {questions.length > 0 && (
        <p className="relative" style={{ fontSize: '9pt', marginTop: '6mm' }}>
          {chapters.length} chapter{chapters.length === 1 ? '' : 's'} · {questions.length} questions · {totalMarks} marks
          in total
        </p>
      )}
    </div>
  )
}

// Prints through a portal at the end of <body>, for the same reason the exam
// paper does: a fixed-position print area only ever renders its first page, so
// a bank running to twenty sheets would come out as one.
export function QuestionBankPrintTarget(props: QuestionBankSheetProps) {
  useEffect(() => {
    document.body.classList.add('has-exam-paper')
    return () => document.body.classList.remove('has-exam-paper')
  }, [])

  return createPortal(
    <div className="exam-paper-print">
      <QuestionBankSheet {...props} />
    </div>,
    document.body
  )
}
