import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { ExamPaperPrintTarget, ExamPaperSheet } from '@/components/ExamPaperSheet'
import { McqOptionsEditor } from '@/components/McqOptionsEditor'
import { PaperBuilder } from '@/components/PaperBuilder'
import { SymbolPad } from '@/components/SymbolPad'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from '@/lib/questionTypes'
import { formatDate, percentage } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import { downloadQuestionPaperPdf } from '@/lib/pdf'
import { paperMarks, usesArabicScript, type PaperPart, type QuestionPaper } from '@/lib/examPaper'
import { signPages } from '@/lib/sourceBooks'
import type {
  Class,
  Exam,
  ExamQuestion,
  ExamSection,
  SourceBookPage,
  ExamResult,
  Question,
  QuestionOption,
  QuestionType,
  Student,
  Subject,
} from '@/types/database'

export function ExamDetailPage({ basePath }: { basePath: string }) {
  const { examId } = useParams()
  const { show } = useToast()
  const [tab, setTab] = useState<'paper' | 'marks'>('paper')
  const [exam, setExam] = useState<Exam | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [klass, setKlass] = useState<Class | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([])
  const [sections, setSections] = useState<ExamSection[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [results, setResults] = useState<Record<string, string>>({})
  const [savedResults, setSavedResults] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingMarks, setSavingMarks] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [newQuestion, setNewQuestion] = useState<{
    question_text: string
    marks: string
    chapter: string
    question_type: QuestionType
    options: QuestionOption[]
  }>({ question_text: '', marks: '', chapter: '', question_type: 'short', options: [] })
  const [addQuestionError, setAddQuestionError] = useState<string | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [downloadingPaper, setDownloadingPaper] = useState(false)
  const newQuestionRef = useRef<HTMLTextAreaElement>(null)
  const [snipPages, setSnipPages] = useState<Map<string, SourceBookPage>>(new Map())
  const [snipUrls, setSnipUrls] = useState<Map<string, string>>(new Map())

  const marksDirty = JSON.stringify(results) !== JSON.stringify(savedResults)

  async function load() {
    if (!examId) return
    setLoading(true)
    const examRes = await supabase.from('exams').select('*').eq('id', examId).single()
    if (examRes.error || !examRes.data) {
      show(examRes.error?.message ?? 'Exam not found.', 'error')
      setLoading(false)
      return
    }
    const examRow = examRes.data as Exam
    setExam(examRow)

    const [subjectRes, classRes, questionsRes, examQuestionsRes, sectionsRes, studentsRes, resultsRes] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', examRow.subject_id).single(),
      supabase.from('classes').select('*').eq('id', examRow.class_id).single(),
      supabase.from('questions').select('*').eq('subject_id', examRow.subject_id),
      supabase.from('exam_questions').select('*').eq('exam_id', examId),
      supabase.from('exam_sections').select('*').eq('exam_id', examId).order('position'),
      supabase.from('students').select('*').eq('class_id', examRow.class_id).eq('enrollment_status', 'enrolled'),
      supabase.from('exam_results').select('*').eq('exam_id', examId),
    ])
    if (subjectRes.data) setSubject(subjectRes.data as Subject)
    if (classRes.data) setKlass(classRes.data as Class)
    if (questionsRes.data) {
      const rows = questionsRes.data as Question[]
      setQuestions(rows)
      // Questions snipped from a book are pictures; the paper needs the page
      // rows and a signed link before it can draw them.
      const pageIds = [...new Set(rows.map((q) => q.source_page_id).filter((id): id is string => !!id))]
      if (pageIds.length > 0) {
        const { data: pageRows } = await supabase.from('source_book_pages').select('*').in('id', pageIds)
        const pages = (pageRows ?? []) as SourceBookPage[]
        setSnipPages(new Map(pages.map((p) => [p.id, p])))
        try {
          setSnipUrls(await signPages(pages))
        } catch {
          setSnipUrls(new Map())
        }
      }
    }
    if (examQuestionsRes.data) setExamQuestions(examQuestionsRes.data as ExamQuestion[])
    if (sectionsRes.data) setSections(sectionsRes.data as ExamSection[])
    if (studentsRes.data) setStudents(studentsRes.data as Student[])
    if (resultsRes.data) {
      const map: Record<string, string> = {}
      for (const r of resultsRes.data as ExamResult[]) {
        map[r.student_id] = String(r.marks_obtained)
      }
      setResults(map)
      setSavedResults(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!marksDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [marksDirty])

  function handleBackClick(e: MouseEvent) {
    if (marksDirty && !window.confirm('You have unsaved marks. Leave without saving?')) {
      e.preventDefault()
    }
  }

  // The paper's structure, assembled once from the sections and the rows that
  // point at them. Both the preview and the PDF read this, so neither can
  // disagree with what the builder shows.
  const paperParts: PaperPart[] = useMemo(() => {
    const bankById = new Map(questions.map((q) => [q.id, q]))
    const rows = new Map<string | null, ExamQuestion[]>()
    for (const row of examQuestions) {
      const list = rows.get(row.section_id) ?? []
      list.push(row)
      rows.set(row.section_id, list)
    }
    for (const list of rows.values()) list.sort((a, b) => a.position - b.position)

    const toQuestions = (list: ExamQuestion[]) =>
      list.flatMap((row) => {
        const q = bankById.get(row.question_id)
        if (!q) return []
        const page = q.source_page_id ? snipPages.get(q.source_page_id) : undefined
        return [
          {
            ...q,
            marks: q.marks,
            partIndexes: row.part_indexes,
            snip:
              page && q.crop
                ? { url: snipUrls.get(page.id), page: { width: page.width, height: page.height }, crop: q.crop }
                : null,
          },
        ]
      })

    const result: PaperPart[] = []
    for (const part of ['objective', 'subjective'] as const) {
      const built = sections
        .filter((s) => s.part === part)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          title: s.title,
          instruction: s.instruction,
          chooseCount: s.choose_count,
          questions: toQuestions(rows.get(s.id) ?? []),
        }))
        .filter((s) => s.questions.length > 0)
      if (built.length > 0) result.push({ part, sections: built })
    }

    // Questions with no section still have to print. An empty title keeps a
    // paper that predates sections looking exactly as it did.
    const loose = toQuestions(rows.get(null) ?? [])
    if (loose.length > 0) {
      const subjective = result.find((p) => p.part === 'subjective')
      const section = { title: '', instruction: null, chooseCount: null, questions: loose }
      if (subjective) subjective.sections.push(section)
      else result.push({ part: 'subjective', sections: [section] })
    }
    return result
  }, [questions, sections, examQuestions, snipPages, snipUrls])

  // What the paper is actually worth. A section with a choice contributes only
  // the questions a student can attempt, not every one printed.
  const selectedMarksTotal = useMemo(() => paperMarks(paperParts), [paperParts])

  // Urdu and Arabic need letter-joining and right-to-left layout that the PDF
  // writer cannot do; the browser's print engine can. Rather than hand back a
  // broken file, the desk is told which button to use.
  const arabicScript = useMemo(() => usesArabicScript(paperParts), [paperParts])

  // Marks Entry stays reachable once results already exist, even if every
  // paper question later gets deselected — otherwise previously saved marks
  // become invisible without actually being deleted.
  const hasPaperOrResults = examQuestions.length > 0 || Object.keys(savedResults).length > 0

  // Lets a teacher add a question straight from the paper builder instead of
  // detouring to the Question Bank page. It's saved into the same questions
  // table (so it's reusable later) and immediately selected onto this paper.
  async function handleAddQuestion() {
    if (!exam) return
    if (!newQuestion.question_text.trim()) {
      setAddQuestionError('Question text is required.')
      return
    }
    const marks = Number(newQuestion.marks)
    if (Number.isNaN(marks) || marks <= 0) {
      setAddQuestionError('Marks must be a positive number.')
      return
    }
    setAddingQuestion(true)
    const { data, error } = await supabase
      .from('questions')
      .insert({
        subject_id: exam.subject_id,
        class_id: exam.class_id,
        chapter: newQuestion.chapter.trim() || null,
        question_text: newQuestion.question_text.trim(),
        marks,
        question_type: newQuestion.question_type,
        options:
          newQuestion.question_type === 'mcq' && newQuestion.options.length > 0 ? newQuestion.options : null,
      })
      .select()
      .single()
    if (error || !data) {
      setAddingQuestion(false)
      setAddQuestionError(friendlyError(error?.message ?? 'Failed to add question.'))
      return
    }
    // The question row now exists in the bank no matter what happens next —
    // reflect that immediately and close the form so a link failure below can
    // never leave it invisible, and a retry can never re-insert a duplicate.
    const question = data as Question
    setQuestions((prev) => [question, ...prev])
    setNewQuestion({ question_text: '', marks: '', chapter: '', question_type: 'short', options: [] })
    setAddQuestionError(null)
    setShowAddQuestion(false)

    const { error: linkError } = await supabase
      .from('exam_questions')
      .insert({ exam_id: exam.id, question_id: question.id })
    setAddingQuestion(false)
    if (linkError) {
      show(
        "Question added to the bank, but couldn't be put on this paper automatically — add it to a section below.",
        'error'
      )
      return
    }
    show('Question added to the bank and this paper.')
    load()
  }

  async function handleSaveMarks() {
    if (!exam) return
    if (selectedMarksTotal !== exam.total_marks) {
      show(
        `Selected questions total ${selectedMarksTotal} marks but the exam is set to ${exam.total_marks} — adjust the paper or the exam's total marks before saving.`,
        'error'
      )
      return
    }
    const invalid = students.find((s) => {
      const val = results[s.id]
      if (val === undefined || val === '') return false
      const num = Number(val)
      return Number.isNaN(num) || num < 0 || num > exam.total_marks
    })
    if (invalid) {
      show(`Marks for ${invalid.full_name} must be between 0 and ${exam.total_marks}.`, 'error')
      return
    }
    const rows = students
      .filter((s) => results[s.id] !== undefined && results[s.id] !== '')
      .map((s) => ({
        exam_id: exam.id,
        student_id: s.id,
        marks_obtained: Number(results[s.id]),
      }))
    if (rows.length === 0) {
      show('Enter at least one mark before saving.', 'error')
      return
    }
    setSavingMarks(true)
    const { error } = await supabase.from('exam_results').upsert(rows, { onConflict: 'exam_id,student_id' })
    setSavingMarks(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    setSavedResults(results)
    show('Marks saved.')
  }


  // The single description of the paper, handed to both the on-screen sheet
  // and the PDF writer so the download can never drift from the preview.
  const paper: QuestionPaper = {
    examName: exam?.name ?? '',
    className: klass?.name ?? '',
    subjectName: subject?.name ?? '',
    totalMarks: exam?.total_marks ?? 0,
    durationMinutes: exam?.duration_minutes ?? null,
    parts: paperParts,
  }

  async function handleDownloadPaper() {
    setDownloadingPaper(true)
    try {
      await downloadQuestionPaperPdf(paper)
    } catch (err) {
      show(friendlyError(err instanceof Error ? err.message : 'Could not build the PDF.'), 'error')
    } finally {
      setDownloadingPaper(false)
    }
  }

  if (loading || !exam) {
    return <p className="text-slate-400 dark:text-slate-500">Loading...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={basePath} onClick={handleBackClick} className="no-print text-sm text-brand-600 hover:underline">
            ← Back to exams
          </Link>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{exam.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {klass?.name} · {subject?.name} · {formatDate(exam.exam_date)} · Total {exam.total_marks} marks
          </p>
        </div>
        <div className="no-print flex gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1">
          <button
            onClick={() => setTab('paper')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'paper' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            Exam Paper
          </button>
          <button
            onClick={() => hasPaperOrResults && setTab('marks')}
            disabled={!hasPaperOrResults}
            title={!hasPaperOrResults ? 'Select at least one question in the Exam Paper tab first' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === 'marks' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'
            } ${!hasPaperOrResults ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Marks Entry
          </button>
        </div>
      </div>

      {tab === 'paper' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="no-print space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Question Bank — {subject?.name}</p>
              <p
                className={`text-xs ${
                  selectedMarksTotal === exam.total_marks
                    ? 'text-slate-500 dark:text-slate-400'
                    : 'font-medium text-amber-600 dark:text-amber-400'
                }`}
              >
                Selected: {selectedMarksTotal} / {exam.total_marks} marks
                {selectedMarksTotal !== exam.total_marks && ' — must match to save marks'}
              </p>
            </div>
            {showAddQuestion ? (
              <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                <Field label="Question type">
                  <Select
                    value={newQuestion.question_type}
                    onChange={(e) =>
                      setNewQuestion({ ...newQuestion, question_type: e.target.value as QuestionType })
                    }
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {QUESTION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Question text">
                  <Textarea
                    ref={newQuestionRef}
                    value={newQuestion.question_text}
                    onChange={(e) => setNewQuestion({ ...newQuestion, question_text: e.target.value })}
                    rows={2}
                    placeholder={'Multi-part questions: put each part on its own line.\nSolve the following:\na) 4/7 - 5/14'}
                  />
                  <div className="mt-2">
                    <SymbolPad
                      targetRef={newQuestionRef}
                      value={newQuestion.question_text}
                      onChange={(question_text) => setNewQuestion({ ...newQuestion, question_text })}
                    />
                  </div>
                </Field>
                {newQuestion.question_type === 'mcq' && (
                  <Field label="Options">
                    <McqOptionsEditor
                      options={newQuestion.options}
                      onChange={(options) => setNewQuestion({ ...newQuestion, options })}
                    />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Marks">
                    <Input
                      type="number"
                      min="1"
                      value={newQuestion.marks}
                      onChange={(e) => setNewQuestion({ ...newQuestion, marks: e.target.value })}
                    />
                  </Field>
                  <Field label="Chapter (optional)">
                    <Input
                      value={newQuestion.chapter}
                      onChange={(e) => setNewQuestion({ ...newQuestion, chapter: e.target.value })}
                    />
                  </Field>
                </div>
                {addQuestionError && <p className="text-sm text-red-600 dark:text-red-400">{addQuestionError}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={addingQuestion}
                    onClick={() => {
                      setShowAddQuestion(false)
                      setAddQuestionError(null)
                      setNewQuestion({ question_text: '', marks: '', chapter: '', question_type: 'short', options: [] })
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleAddQuestion} disabled={addingQuestion}>
                    {addingQuestion ? 'Adding...' : 'Add to paper'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowAddQuestion(true)}>
                + Add a question manually
              </Button>
            )}
            {questions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                No questions in the bank for this subject yet. Add one above, or import a past paper from the
                Question Bank page.
              </p>
            ) : (
              <PaperBuilder
                examId={exam.id}
                bank={questions}
                sections={sections}
                examQuestions={examQuestions}
                onReload={load}
              />
            )}
          </div>

          <div>
            <div className="no-print mb-2 space-y-2">
              {arabicScript && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                  This paper is in Urdu or Arabic. Use <strong>Print Paper</strong> and choose “Save as PDF” — the
                  download button cannot join the letters correctly.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => window.print()}>
                  Print Paper
                </Button>
                <Button onClick={handleDownloadPaper} disabled={downloadingPaper || arabicScript}>
                  {downloadingPaper ? 'Preparing...' : 'Download PDF'}
                </Button>
              </div>
            </div>
            {/* The preview shrinks the sheet with `zoom` rather than a
                transform, because zoom collapses the layout box with it — a
                scaled sheet would leave a page-height hole below itself. */}
            <div className="no-print overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="exam-paper-zoom">
                <div className="shadow-lg">
                  <ExamPaperSheet paper={paper} />
                </div>
              </div>
            </div>
            <ExamPaperPrintTarget paper={paper} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {examQuestions.length === 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
              No questions are currently on this paper — these are previously saved marks. Rebuild the paper in the
              Exam Paper tab before you can save any changes here.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Marks Obtained</th>
                  <th className="px-4 py-3">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                      No enrolled students in this class.
                    </td>
                  </tr>
                ) : (
                  students.map((s) => {
                    const val = results[s.id] ?? ''
                    const num = Number(val)
                    const pct = val !== '' && !Number.isNaN(num) ? percentage(num, exam.total_marks) : null
                    return (
                      <tr key={s.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="0"
                            max={exam.total_marks}
                            step="0.5"
                            value={val}
                            onChange={(e) => setResults({ ...results, [s.id]: e.target.value })}
                            className="w-28"
                          />
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{pct !== null ? `${pct}%` : '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={handleSaveMarks} disabled={savingMarks || students.length === 0}>
              {savingMarks ? 'Saving...' : 'Save Marks'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
