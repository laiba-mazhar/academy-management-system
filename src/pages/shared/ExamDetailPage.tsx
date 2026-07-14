import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatDate, percentage } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
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
  const [loading, setLoading] = useState(true)
  const [savingMarks, setSavingMarks] = useState(false)

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
      for (const r of resultsRes.data as ExamResult[]) map[r.student_id] = String(r.marks_obtained)
      setResults(map)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

  const selectedMarksTotal = useMemo(
    () => questions.filter((q) => selectedQuestionIds.has(q.id)).reduce((sum, q) => sum + q.marks, 0),
    [questions, selectedQuestionIds]
  )

  async function toggleQuestion(question: Question) {
    const isSelected = selectedQuestionIds.has(question.id)
    if (isSelected) {
      const { error } = await supabase
        .from('exam_questions')
        .delete()
        .eq('exam_id', examId!)
        .eq('question_id', question.id)
      if (error) {
        show(error.message, 'error')
        return
      }
    } else {
      const { error } = await supabase.from('exam_questions').insert({ exam_id: examId!, question_id: question.id })
      if (error) {
        show(error.message, 'error')
        return
      }
    }
    const next = new Set(selectedQuestionIds)
    if (isSelected) next.delete(question.id)
    else next.add(question.id)
    setSelectedQuestionIds(next)
  }

  async function handleSaveMarks() {
    if (!exam) return
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
    show('Marks saved.')
  }

  const selectedQuestions = questions
    .filter((q) => selectedQuestionIds.has(q.id))
    .sort((a, b) => (a.chapter ?? '').localeCompare(b.chapter ?? ''))

  if (loading || !exam) {
    return <p className="text-slate-400 dark:text-slate-500">Loading...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={basePath} className="no-print text-sm text-brand-600 hover:underline">
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
            onClick={() => setTab('marks')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'marks' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
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
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Selected: {selectedMarksTotal} / {exam.total_marks} marks
              </p>
            </div>
            {questions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                No questions in the bank for this subject yet. Add some in Question Bank.
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
            <div className="no-print mb-2 flex justify-end">
              <Button variant="secondary" onClick={() => window.print()}>
                Print Paper
              </Button>
            </div>
            <div className="print-area rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
              <div className="mb-6 text-center">
                <p className="text-lg font-semibold">Al Maktab Educational Institute</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Examination Paper</p>
              </div>
              <div className="mb-4 flex justify-between text-sm">
                <span>Class: {klass?.name}</span>
                <span>Subject: {subject?.name}</span>
              </div>
              <div className="mb-6 flex justify-between text-sm">
                <span>Date: {formatDate(exam.exam_date)}</span>
                <span>Total Marks: {exam.total_marks}</span>
              </div>
              {selectedQuestions.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No questions selected yet.</p>
              ) : (
                <ol className="list-decimal space-y-3 pl-5 text-sm">
                  {selectedQuestions.map((q) => (
                    <li key={q.id}>
                      <div className="flex justify-between gap-4">
                        <span>{q.question_text}</span>
                        <span className="shrink-0 text-slate-500 dark:text-slate-400">[{q.marks}]</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
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
          <div className="flex justify-end">
            <Button onClick={handleSaveMarks} disabled={savingMarks || students.length === 0}>
              {savingMarks ? 'Saving...' : 'Save Marks'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
