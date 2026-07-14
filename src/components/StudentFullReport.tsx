import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ReportCard } from '@/components/ReportCard'
import { formatDate } from '@/lib/utils'
import type { Exam, ExamResult, Student, Subject } from '@/types/database'

export function StudentFullReport({ student, className }: { student: Student; className?: string }) {
  const [missedExams, setMissedExams] = useState<{ exam: Exam; subjectName: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      if (!student.class_id) {
        setMissedExams([])
        setLoading(false)
        return
      }
      const [examsRes, resultsRes, subjectsRes] = await Promise.all([
        supabase.from('exams').select('*').eq('class_id', student.class_id),
        supabase.from('exam_results').select('*').eq('student_id', student.id),
        supabase.from('subjects').select('*').eq('class_id', student.class_id),
      ])
      const exams = (examsRes.data as Exam[]) ?? []
      const results = (resultsRes.data as ExamResult[]) ?? []
      const subjects = (subjectsRes.data as Subject[]) ?? []
      const subjectById = new Map(subjects.map((s) => [s.id, s]))
      const resultExamIds = new Set(results.map((r) => r.exam_id))

      const missed = exams
        .filter((e) => !resultExamIds.has(e.id) && e.exam_date <= new Date().toISOString().slice(0, 10))
        .map((e) => ({ exam: e, subjectName: subjectById.get(e.subject_id)?.name ?? '—' }))
        .sort((a, b) => b.exam.exam_date.localeCompare(a.exam.exam_date))

      setMissedExams(missed)
      setLoading(false)
    }
    load()
  }, [student.id, student.class_id])

  return (
    <div className={className}>
      <ReportCard student={student} />
      <div className="no-print mt-6">
        <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Missed / Not Yet Graded Exams</p>
        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Checking...</p>
        ) : missedExams.length === 0 ? (
          <p className="text-sm text-green-700 dark:text-green-400">No missed exams — all caught up.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {missedExams.map(({ exam, subjectName }) => (
              <li key={exam.id} className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <span aria-hidden>⚠</span>
                <span>
                  {exam.name} ({subjectName}) — {formatDate(exam.exam_date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
