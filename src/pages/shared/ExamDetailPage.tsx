import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { ExamPaperPrintTarget, ExamPaperSheet } from '@/components/ExamPaperSheet'
import { formatDate, formatDateTime, percentage, toPakistaniMsisdn } from '@/lib/utils'
import { edgeFunctionError, friendlyError } from '@/lib/errors'
import { downloadQuestionPaperPdf } from '@/lib/pdf'
import type { QuestionPaper } from '@/lib/examPaper'
import type { Class, Exam, ExamQuestion, ExamResult, Question, Student, Subject } from '@/types/database'

export function ExamDetailPage({ basePath }: { basePath: string }) {
  const { examId } = useParams()
  const { show } = useToast()
  const [tab, setTab] = useState<'paper' | 'marks'>('paper')
  const [exam, setExam] = useState<Exam | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [klass, setKlass] = useState<Class | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set())
  const [students, setStudents] = useState<Student[]>([])
  const [results, setResults] = useState<Record<string, string>>({})
  const [savedResults, setSavedResults] = useState<Record<string, string>>({})
  const [whatsappSentAt, setWhatsappSentAt] = useState<Record<string, string | null>>({})
  const [sendingWaId, setSendingWaId] = useState<string | null>(null)
  const [bulkSendingWa, setBulkSendingWa] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingMarks, setSavingMarks] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [newQuestion, setNewQuestion] = useState({ question_text: '', marks: '', chapter: '' })
  const [addQuestionError, setAddQuestionError] = useState<string | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [downloadingPaper, setDownloadingPaper] = useState(false)

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

    const [subjectRes, classRes, questionsRes, examQuestionsRes, studentsRes, resultsRes] = await Promise.all([
      supabase.from('subjects').select('*').eq('id', examRow.subject_id).single(),
      supabase.from('classes').select('*').eq('id', examRow.class_id).single(),
      supabase.from('questions').select('*').eq('subject_id', examRow.subject_id),
      supabase.from('exam_questions').select('*').eq('exam_id', examId),
      supabase.from('students').select('*').eq('class_id', examRow.class_id).eq('enrollment_status', 'enrolled'),
      supabase.from('exam_results').select('*').eq('exam_id', examId),
    ])
    if (subjectRes.data) setSubject(subjectRes.data as Subject)
    if (classRes.data) setKlass(classRes.data as Class)
    if (questionsRes.data) setQuestions(questionsRes.data as Question[])
    if (examQuestionsRes.data) {
      setSelectedQuestionIds(new Set((examQuestionsRes.data as ExamQuestion[]).map((eq) => eq.question_id)))
    }
    if (studentsRes.data) setStudents(studentsRes.data as Student[])
    if (resultsRes.data) {
      const map: Record<string, string> = {}
      const sentMap: Record<string, string | null> = {}
      for (const r of resultsRes.data as ExamResult[]) {
        map[r.student_id] = String(r.marks_obtained)
        sentMap[r.student_id] = r.whatsapp_sent_at
      }
      setResults(map)
      setSavedResults(map)
      setWhatsappSentAt(sentMap)
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

  const selectedMarksTotal = useMemo(
    () => questions.filter((q) => selectedQuestionIds.has(q.id)).reduce((sum, q) => sum + q.marks, 0),
    [questions, selectedQuestionIds]
  )

  // Marks Entry stays reachable once results already exist, even if every
  // paper question later gets deselected — otherwise previously saved marks
  // become invisible without actually being deleted.
  const hasPaperOrResults = selectedQuestionIds.size > 0 || Object.keys(savedResults).length > 0

  async function toggleQuestion(question: Question) {
    const wasSelected = selectedQuestionIds.has(question.id)

    // Update synchronously first so a second rapid click reads the latest
    // selection instead of a stale pre-network-call snapshot.
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev)
      if (wasSelected) next.delete(question.id)
      else next.add(question.id)
      return next
    })

    const { error } = wasSelected
      ? await supabase.from('exam_questions').delete().eq('exam_id', examId!).eq('question_id', question.id)
      : await supabase.from('exam_questions').insert({ exam_id: examId!, question_id: question.id })

    if (error) {
      // A duplicate-insert (23505) means another click already selected this
      // question — treat that as success instead of reverting/erroring.
      if (!wasSelected && error.code === '23505') return
      show(error.message, 'error')
      // Roll back the optimistic update since the write didn't actually happen.
      setSelectedQuestionIds((prev) => {
        const next = new Set(prev)
        if (wasSelected) next.add(question.id)
        else next.delete(question.id)
        return next
      })
    }
  }

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
    setNewQuestion({ question_text: '', marks: '', chapter: '' })
    setAddQuestionError(null)
    setShowAddQuestion(false)

    const { error: linkError } = await supabase
      .from('exam_questions')
      .insert({ exam_id: exam.id, question_id: question.id })
    setAddingQuestion(false)
    if (linkError) {
      show(
        "Question added to the bank, but couldn't be selected onto this paper automatically — check the box next to it below.",
        'error'
      )
      return
    }
    setSelectedQuestionIds((prev) => new Set(prev).add(question.id))
    show('Question added to the bank and this paper.')
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

  // Students who can actually be messaged: they have a saved mark and a
  // guardian phone that normalizes to a valid PK mobile number.
  const notifiable = students.filter(
    (s) =>
      savedResults[s.id] !== undefined &&
      savedResults[s.id] !== '' &&
      toPakistaniMsisdn(s.guardian_phone) !== null
  )

  type SendOutcome = { studentId: string; ok: boolean; error?: string }

  async function sendToParents(studentIds: string[]): Promise<{ sent: number; total: number; results: SendOutcome[] } | null> {
    if (!exam) return null
    const { data, error } = await supabase.functions.invoke('send-result-whatsapp', {
      body: { examId: exam.id, studentIds },
    })
    if (error) {
      show(await edgeFunctionError(error, 'Failed to send message.'), 'error')
      return null
    }
    const result = data as { error?: string; sent?: number; total?: number; results?: SendOutcome[] }
    if (result?.error) {
      show(result.error, 'error')
      return null
    }
    const now = new Date().toISOString()
    if (result.results) {
      setWhatsappSentAt((prev) => {
        const next = { ...prev }
        for (const o of result.results!) if (o.ok) next[o.studentId] = now
        return next
      })
    }
    return { sent: result.sent ?? 0, total: result.total ?? 0, results: result.results ?? [] }
  }

  async function handleSendOne(studentId: string) {
    setSendingWaId(studentId)
    const result = await sendToParents([studentId])
    setSendingWaId(null)
    if (!result) return
    const outcome = result.results.find((o) => o.studentId === studentId)
    if (outcome?.ok) show('Result sent to parent.')
    else show(outcome?.error ?? 'Message could not be sent.', 'error')
  }

  async function handleSendAll() {
    if (notifiable.length === 0) {
      show('No students with saved marks and a valid guardian phone.', 'error')
      return
    }
    if (!window.confirm(`Send exam results to ${notifiable.length} parent(s)?`)) return
    setBulkSendingWa(true)
    const result = await sendToParents(notifiable.map((s) => s.id))
    setBulkSendingWa(false)
    if (!result) return
    const failed = result.total - result.sent
    if (failed === 0) show(`Results sent to ${result.sent} parent(s).`)
    else show(`Sent to ${result.sent} of ${result.total}. ${failed} could not be delivered — check their phone numbers.`, 'error')
  }

  const selectedQuestions = questions
    .filter((q) => selectedQuestionIds.has(q.id))
    .sort((a, b) => (a.chapter ?? '').localeCompare(b.chapter ?? ''))

  // The single description of the paper, handed to both the on-screen sheet
  // and the PDF writer so the download can never drift from the preview.
  const paper: QuestionPaper = {
    examName: exam?.name ?? '',
    className: klass?.name ?? '',
    subjectName: subject?.name ?? '',
    totalMarks: exam?.total_marks ?? 0,
    durationMinutes: exam?.duration_minutes ?? null,
    questions: selectedQuestions,
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
                <Field label="Question text">
                  <Textarea
                    value={newQuestion.question_text}
                    onChange={(e) => setNewQuestion({ ...newQuestion, question_text: e.target.value })}
                    rows={2}
                  />
                </Field>
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
                      setNewQuestion({ question_text: '', marks: '', chapter: '' })
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
                No questions in the bank for this subject yet. Add one above, or from the Question Bank page.
              </p>
            ) : (
              <div className="space-y-2">
                {questions.map((q) => (
                  <label
                    key={q.id}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedQuestionIds.has(q.id)}
                      onChange={() => toggleQuestion(q)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      {q.question_text}
                      <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                        ({q.marks} marks{q.chapter ? ` · ${q.chapter}` : ''})
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="no-print mb-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                Print Paper
              </Button>
              <Button onClick={handleDownloadPaper} disabled={downloadingPaper}>
                {downloadingPaper ? 'Preparing...' : 'Download PDF'}
              </Button>
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
          {selectedQuestionIds.size === 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
              No questions are currently selected for this paper — these are previously saved marks. Re-select the
              exam's questions in the Exam Paper tab before you can save any changes here.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Marks Obtained</th>
                  <th className="px-4 py-3">Percentage</th>
                  <th className="px-4 py-3">Parent Notification</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
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
                        <td className="px-4 py-3">
                          {(() => {
                            const hasSavedMark = savedResults[s.id] !== undefined && savedResults[s.id] !== ''
                            const validPhone = toPakistaniMsisdn(s.guardian_phone) !== null
                            const rowDirty = (results[s.id] ?? '') !== (savedResults[s.id] ?? '')
                            const sentAt = whatsappSentAt[s.id]
                            if (!hasSavedMark)
                              return <span className="text-xs text-slate-400 dark:text-slate-500">Save a mark first</span>
                            if (!validPhone)
                              return <span className="text-xs text-amber-600 dark:text-amber-400">No valid phone</span>
                            return (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => handleSendOne(s.id)}
                                  disabled={sendingWaId === s.id || rowDirty}
                                  title={rowDirty ? 'Save the updated mark before sending' : undefined}
                                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {sendingWaId === s.id ? 'Sending…' : sentAt ? 'Resend' : 'Send to Parent'}
                                </button>
                                {sentAt && (
                                  <span className="text-xs text-green-600 dark:text-green-400">
                                    Sent {formatDateTime(sentAt)}
                                  </span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={handleSendAll}
              disabled={bulkSendingWa || marksDirty || notifiable.length === 0}
              title={
                marksDirty
                  ? 'Save marks before sending'
                  : notifiable.length === 0
                    ? 'No students with saved marks and a valid guardian phone'
                    : undefined
              }
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkSendingWa
                ? 'Sending…'
                : `Send results to all parents${notifiable.length ? ` (${notifiable.length})` : ''}`}
            </button>
            <Button onClick={handleSaveMarks} disabled={savingMarks || students.length === 0}>
              {savingMarks ? 'Saving...' : 'Save Marks'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
