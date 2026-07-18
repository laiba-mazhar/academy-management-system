import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { ReportCard } from '@/components/ReportCard'
import { formatDate } from '@/lib/utils'
import type { Attendance, Student } from '@/types/database'

export function TeacherStudentDetailPage() {
  const { studentId } = useParams()
  const { show } = useToast()
  const [student, setStudent] = useState<Student | null>(null)
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!studentId) return
      setLoading(true)
      const [studentRes, attendanceRes] = await Promise.all([
        supabase.from('students').select('*').eq('id', studentId).single(),
        supabase.from('attendance').select('*').eq('student_id', studentId).order('date', { ascending: false }),
      ])
      if (studentRes.error || !studentRes.data) {
        show(studentRes.error?.message ?? 'Student not found.', 'error')
      } else {
        setStudent(studentRes.data as Student)
      }
      if (attendanceRes.data) setAttendance(attendanceRes.data as Attendance[])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  const attendanceStats = useMemo(() => {
    const total = attendance.length
    const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
    return { total, present, percent: total > 0 ? Math.round((present / total) * 1000) / 10 : 0 }
  }, [attendance])

  if (loading) return <p className="text-slate-400 dark:text-slate-500">Loading...</p>
  if (!student) return <p className="text-slate-400 dark:text-slate-500">Student not found.</p>

  return (
    <div className="space-y-6">
      <Link to="/teacher/students" className="text-sm text-brand-600 hover:underline">
        ← Back to my students
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{student.full_name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Guardian: {student.guardian_name || '—'} {student.guardian_phone ? `· ${student.guardian_phone}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Attendance</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{attendanceStats.percent}%</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {attendanceStats.present} / {attendanceStats.total} days present
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Report Card</h2>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
        <ReportCard student={student} className="print-area" subjectScoped />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Attendance History</h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No attendance recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.slice(0, 30).map((a) => (
                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatDate(a.date)}</td>
                  <td className="px-2 py-2 capitalize text-slate-600 dark:text-slate-300">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
