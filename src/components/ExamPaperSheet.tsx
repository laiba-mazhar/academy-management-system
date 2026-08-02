import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from '@/assets/maktab_logo_transparent.png'
import {
  formatDuration,
  parseQuestionText,
  RULE_BLUE,
  SCHOOL_ADDRESS,
  SCHOOL_NAME,
  SCHOOL_TAGLINE,
  TAGLINE_NAVY,
  type QuestionPaper,
} from '@/lib/examPaper'

// The question paper as it comes off the printer: fixed A4 width, its own
// letterhead, and no dark-mode variants anywhere — this is paper, and a dark
// question paper neither prints nor photocopies.
//
// Dimensions are in millimetres so the on-screen preview is literally the
// printed size, and so `window.print()` needs no scaling to reproduce it.
export function ExamPaperSheet({ paper }: { paper: QuestionPaper }) {
  const duration = formatDuration(paper.durationMinutes)

  return (
    <div
      className="exam-paper relative mx-auto bg-white text-black"
      style={{ width: '210mm', minHeight: '297mm', padding: '12mm 5mm 14mm' }}
    >
      {/* Watermark. Sits behind the questions and is knocked right back so the
          text over it stays readable on a photocopy. */}
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
        {/* Clears the crest on its left: the line is centred on the sheet, so
            at the narrower printed width it would otherwise run into it. */}
        <p className="text-center" style={{ fontSize: '8.5pt', marginTop: '2.5mm', paddingLeft: '26mm' }}>
          {SCHOOL_ADDRESS}
        </p>
      </header>

      <div className="relative flex items-baseline justify-between font-bold" style={{ fontSize: '10pt', marginTop: '4mm' }}>
        <span>{duration ? `TIME ${duration}` : ''}</span>
        <span>{paper.examName}</span>
        <span>TOTAL MARKS {paper.totalMarks}</span>
      </div>

      {/* Particulars grid. NAME, ROLL NO, DATE and SUBJECT TEACHER are left
          empty on purpose — they are filled in by hand at the desk. */}
      <table
        className="relative w-full border-collapse font-bold"
        style={{ marginTop: '2mm', tableLayout: 'fixed' }}
      >
        <tbody>
          {(
            [
              ['NAME', '', 'CLASS', paper.className],
              ['ROLL NO', '', 'DATE', ''],
              ['SUBJECT', paper.subjectName, 'SUBJECT TEACHER', ''],
            ] as const
          ).map((row, i) => (
            <tr key={i}>
              {row.map((cell, col) => (
                <td
                  key={col}
                  className="border border-black align-middle"
                  style={{
                    fontSize: col % 2 === 0 ? '10pt' : '11.5pt',
                    height: '6.1mm',
                    padding: '0 2mm',
                    width: ['12.7%', '32%', '20.4%', '34.9%'][col],
                    // Labels are fixed strings; letting "SUBJECT TEACHER" wrap
                    // would push that row taller than the two above it.
                    whiteSpace: col % 2 === 0 ? 'nowrap' : 'normal',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="relative list-none" style={{ marginTop: '4mm' }}>
        {paper.questions.map((question, index) => {
          const { stem, parts } = parseQuestionText(question.question_text)
          const options = question.question_type === 'mcq' ? (question.options ?? []) : []
          return (
            <li key={index} className="font-bold" style={{ fontSize: '12pt', marginBottom: '3.5mm' }}>
              <p style={{ lineHeight: 1.6 }}>
                Qno: {index + 1}&nbsp;&nbsp;{stem}
              </p>
              {/* MCQ choices sit on one wrapped row, the way they are printed
                  on a board paper rather than as a vertical list. */}
              {options.length > 0 && (
                <div className="flex flex-wrap" style={{ marginTop: '1.5mm', paddingLeft: '6mm', gap: '2mm 8mm' }}>
                  {options.map((option) => (
                    <span key={option.key} style={{ lineHeight: 1.5 }}>
                      ({option.key.toLowerCase()}) {option.text}
                    </span>
                  ))}
                </div>
              )}
              {parts.length > 0 && (
                <div style={{ marginTop: '2mm', paddingLeft: '6mm' }}>
                  {parts.map((part, p) => (
                    <p key={p} className="flex gap-2" style={{ lineHeight: 1.6 }}>
                      <span className="shrink-0">{part.marker}</span>
                      <span>{part.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {paper.questions.length === 0 && (
        <p className="relative" style={{ fontSize: '11pt', marginTop: '6mm' }}>
          No questions selected yet.
        </p>
      )}
    </div>
  )
}

// The printed copy of the paper.
//
// The app's usual print mechanism hides everything except `.print-area` and
// pins that to the page with `position: fixed`. A fixed box only ever renders
// on the first sheet, which is fine for the single-page printouts it was built
// for but silently truncates a question paper that runs to two or three pages.
//
// So the paper prints from its own portal at the end of <body>, in normal flow
// where the browser can paginate it, and a body class takes every other
// top-level child out of the layout for the duration. Marking them `display:
// none` rather than `visibility: hidden` is the point — hidden-but-laid-out
// siblings would pad the document with blank sheets before the paper starts.
export function ExamPaperPrintTarget({ paper }: { paper: QuestionPaper }) {
  useEffect(() => {
    document.body.classList.add('has-exam-paper')
    return () => document.body.classList.remove('has-exam-paper')
  }, [])

  return createPortal(
    <div className="exam-paper-print">
      <ExamPaperSheet paper={paper} />
    </div>,
    document.body
  )
}
