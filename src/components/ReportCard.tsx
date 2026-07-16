import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { percentage, formatDate } from '@/lib/utils'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import type { Exam, ExamResult, Student, Subject } from '@/types/database'

export function ReportCard({
  student,
  className,
  subjectScoped,
}: {
  student: Student
  className?: string
  /** True when rendered somewhere RLS limits exam_results to the viewer's own
   * subject(s) — e.g. a teacher's view — so "Overall" isn't the student's
   * true cross-subject average and must say so. */
  subjectScoped?: boolean
}) {
  const [results, setResults] = useState<ExamResult[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const resultsRes = await supabase.from('exam_results').select('*').eq('student_id', student.id)
      const examResults = (resultsRes.data as ExamResult[]) ?? []
      setResults(examResults)

      const examIds = [...new Set(examResults.map((r) => r.exam_id))]
      if (examIds.length > 0) {
        const examsRes = await supabase.from('exams').select('*').in('id', examIds)
        const examRows = (examsRes.data as Exam[]) ?? []
        setExams(examRows)
        const subjectIds = [...new Set(examRows.map((e) => e.subject_id))]
        if (subjectIds.length > 0) {
          const subjectsRes = await supabase.from('subjects').select('*').in('id', subjectIds)
          setSubjects((subjectsRes.data as Subject[]) ?? [])
        }
      } else {
        setExams([])
        setSubjects([])
      }
      setLoading(false)
    }
    load()
  }, [student.id])

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  const rows = results
    .map((r) => {
      const exam = examById.get(r.exam_id)
      if (!exam) return null
      const subject = subjectById.get(exam.subject_id)
      return {
        examName: exam.name,
        subjectName: subject?.name ?? '—',
        date: exam.exam_date,
        obtained: r.marks_obtained,
        total: exam.total_marks,
        percent: percentage(r.marks_obtained, exam.total_marks),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.date.localeCompare(b.date))

  const overall = useMemo(() => {
    const totalObtained = rows.reduce((sum, r) => sum + r.obtained, 0)
    const totalMax = rows.reduce((sum, r) => sum + r.total, 0)
    return percentage(totalObtained, totalMax)
  }, [rows])

  if (loading) return <p className="text-slate-400 dark:text-slate-500">Loading report card...</p>

  return (
    <div className={className}>
      <DocumentLetterhead subtitle="Student Report Card" />
      <div className="mb-1 flex justify-between text-sm">
        <span>
          <span className="text-slate-500 dark:text-slate-400">Student:</span> <strong>{student.full_name}</strong>
        </span>
        <span>
          <span className="text-slate-500 dark:text-slate-400">{subjectScoped ? 'Your subject overall:' : 'Overall:'}</span>{' '}
          <strong>{overall}%</strong>
        </span>
      </div>
      {subjectScoped && (
        <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
          Showing only the subject(s) you teach — not the student's full cross-subject average.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-2 py-2">Exam</th>
              <th className="px-2 py-2">Subject</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Marks</th>
              <th className="px-2 py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0">
                <td className="px-2 py-2">{r.examName}</td>
                <td className="px-2 py-2">{r.subjectName}</td>
                <td className="px-2 py-2">{formatDate(r.date)}</td>
                <td className="px-2 py-2">
                  {r.obtained} / {r.total}
                </td>
                <td className="px-2 py-2">{r.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
