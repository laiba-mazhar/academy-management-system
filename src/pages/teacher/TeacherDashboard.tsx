import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { CATEGORICAL, CHART_INK, SEQUENTIAL_BLUE } from '@/lib/chartColors'
import { DAY_NAMES, formatDate, percentage } from '@/lib/utils'
import type { Attendance, Class, Exam, ExamResult, Student, Subject, Timetable } from '@/types/database'

function todayDayOfWeek(): number {
  return new Date().getDay()
}

function lastNDays(n: number): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return days
}

export function TeacherDashboard() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [todaySlots, setTodaySlots] = useState<Timetable[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [examResults, setExamResults] = useState<ExamResult[]>([])
  const [loading, setLoading] = useState(true)

  const [showRequest, setShowRequest] = useState(false)
  const [requestForm, setRequestForm] = useState({ name: '', class_id: '' })
  const [requestError, setRequestError] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState<Subject[]>([])

  async function load() {
    if (!profile) return
    setLoading(true)
    const [subjectsRes, classesRes, studentsRes, timetableRes, attendanceRes, examsRes, resultsRes] = await Promise.all([
      supabase.from('subjects').select('*'),
      supabase.from('classes').select('*'),
      supabase.from('students').select('*').eq('enrollment_status', 'enrolled'),
      supabase.from('timetable').select('*').eq('teacher_id', profile.id).eq('day_of_week', todayDayOfWeek()),
      supabase.from('attendance').select('*').gte('date', lastNDays(30)[0]),
      supabase.from('exams').select('*').order('exam_date'),
      supabase.from('exam_results').select('*'),
    ])
    if (subjectsRes.data) {
      const all = subjectsRes.data as Subject[]
      setSubjects(all.filter((s) => s.status === 'active' && s.teacher_id === profile.id))
      setPendingRequests(all.filter((s) => s.status === 'pending_approval' && s.requested_by === profile.id))
    }
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (studentsRes.data) setStudents(studentsRes.data as Student[])
    if (timetableRes.data) {
      setTodaySlots((timetableRes.data as Timetable[]).sort((a, b) => a.start_time.localeCompare(b.start_time)))
    }
    if (attendanceRes.data) setAttendance(attendanceRes.data as Attendance[])
    if (examsRes.data) setExams(examsRes.data as Exam[])
    if (resultsRes.data) setExamResults(resultsRes.data as ExamResult[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const assignedClassIds = useMemo(() => new Set(subjects.map((s) => s.class_id)), [subjects])
  const myStudentCount = students.filter((s) => s.class_id && assignedClassIds.has(s.class_id)).length

  const classStrength = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of students) {
      if (s.class_id && assignedClassIds.has(s.class_id)) {
        counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1)
      }
    }
    return [...assignedClassIds].map((classId) => ({
      class: classById.get(classId)?.name ?? 'Unknown',
      students: counts.get(classId) ?? 0,
    }))
  }, [students, assignedClassIds, classById])

  const attendanceTrend = useMemo(() => {
    const days = lastNDays(14)
    const byDay = new Map<string, { present: number; total: number }>()
    for (const a of attendance) {
      const entry = byDay.get(a.date) ?? { present: 0, total: 0 }
      entry.total += 1
      if (a.status === 'present' || a.status === 'late') entry.present += 1
      byDay.set(a.date, entry)
    }
    return days.map((d) => {
      const entry = byDay.get(d)
      return {
        day: d.slice(5),
        percent: entry ? percentage(entry.present, entry.total) : null,
      }
    })
  }, [attendance])

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  const resultTrend = useMemo(() => {
    const byExam = new Map<string, { obtained: number; total: number; passCount: number; count: number }>()
    for (const r of examResults) {
      const exam = examById.get(r.exam_id)
      if (!exam) continue
      const entry = byExam.get(exam.id) ?? { obtained: 0, total: 0, passCount: 0, count: 0 }
      entry.obtained += r.marks_obtained
      entry.total += exam.total_marks
      entry.count += 1
      if (percentage(r.marks_obtained, exam.total_marks) >= 40) entry.passCount += 1
      byExam.set(exam.id, entry)
    }
    return exams
      .filter((e) => byExam.has(e.id))
      .map((e) => {
        const entry = byExam.get(e.id)!
        return {
          exam: e.name,
          date: e.exam_date,
          class: classById.get(e.class_id)?.name ?? '—',
          subject: subjectById.get(e.subject_id)?.name ?? '—',
          avgPercent: percentage(entry.obtained, entry.total),
          passRate: Math.round((entry.passCount / entry.count) * 1000) / 10,
          entered: entry.count,
        }
      })
  }, [exams, examResults, examById, classById, subjectById])

  function openRequest() {
    setRequestForm({ name: '', class_id: [...assignedClassIds][0] ?? '' })
    setRequestError(null)
    setShowRequest(true)
  }

  async function submitRequest() {
    if (!requestForm.name.trim() || !requestForm.class_id) {
      setRequestError('Subject name and class are required.')
      return
    }
    const { error } = await supabase.from('subjects').insert({
      name: requestForm.name.trim(),
      class_id: requestForm.class_id,
      status: 'pending_approval',
      requested_by: profile!.id,
      teacher_id: null,
    })
    if (error) {
      setRequestError(error.message)
      return
    }
    show('Subject request submitted for admin approval.')
    setShowRequest(false)
    load()
  }

  if (loading) return <p className="text-slate-400 dark:text-slate-500">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Welcome, {profile?.full_name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Your classes, timetable, and students at a glance.</p>
        </div>
        <Button onClick={openRequest} disabled={assignedClassIds.size === 0}>
          Request New Subject
        </Button>
      </div>

      {subjects.length === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Once the admin assigns you subjects and classes, your students and timetable will appear here."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">My Subjects</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{subjects.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">My Students</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{myStudentCount}</p>
              <Link to="/teacher/students" className="text-xs text-brand-600 hover:underline dark:text-gold-400">
                View all →
              </Link>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Today's Classes</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{todaySlots.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Class Strength</p>
              {classStrength.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">No students yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={classStrength}>
                    <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                    <XAxis dataKey="class" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                    <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="students" fill={SEQUENTIAL_BLUE} radius={[4, 4, 0, 0]} name="Students" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Attendance Trend (last 14 days)</p>
              {attendance.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">No attendance recorded yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={attendanceTrend}>
                    <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                    <XAxis dataKey="day" stroke={CHART_INK.muted} fontSize={11} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                    <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip formatter={(v) => (v === null || v === undefined ? 'No data' : `${v}%`)} />
                    <Line
                      type="monotone"
                      dataKey="percent"
                      stroke={SEQUENTIAL_BLUE}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                      name="Attendance %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 lg:col-span-2">
              <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Test Result Trends</p>
              {resultTrend.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={resultTrend}>
                      <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                      <XAxis dataKey="exam" stroke={CHART_INK.muted} fontSize={11} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                      <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Line
                        type="monotone"
                        dataKey="avgPercent"
                        stroke={CATEGORICAL[0]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="Average %"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <tr>
                          <th className="px-2 py-2">Exam</th>
                          <th className="px-2 py-2">Subject</th>
                          <th className="px-2 py-2">Class</th>
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Average</th>
                          <th className="px-2 py-2">Pass Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultTrend.map((r, idx) => (
                          <tr
                            key={idx}
                            className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors"
                          >
                            <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{r.exam}</td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.subject}</td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.class}</td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatDate(r.date)}</td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.avgPercent}%</td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.passRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">My Subjects &amp; Classes</p>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {subjects.map((s) => (
                <li key={s.id}>
                  {s.name} — {classById.get(s.class_id)?.name ?? 'Unknown class'}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Today ({DAY_NAMES[todayDayOfWeek()]})</p>
            {todaySlots.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No classes scheduled today.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {todaySlots.map((slot) => (
                  <li key={slot.id} className="flex justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700/60">
                    <span>{classById.get(slot.class_id)?.name ?? '—'}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {pendingRequests.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-900/20">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Pending subject requests</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800 dark:text-amber-400">
            {pendingRequests.map((s) => (
              <li key={s.id}>
                {s.name} — {classById.get(s.class_id)?.name ?? 'Unknown class'} (awaiting admin approval)
              </li>
            ))}
          </ul>
        </div>
      )}

      {showRequest && (
        <Modal title="Request New Subject" onClose={() => setShowRequest(false)}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your request goes to the admin for approval. It won't become active until approved.
            </p>
            <Field label="Subject name">
              <Input value={requestForm.name} onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })} />
            </Field>
            <Field label="Class">
              <Select value={requestForm.class_id} onChange={(e) => setRequestForm({ ...requestForm, class_id: e.target.value })}>
                {[...assignedClassIds].map((id) => (
                  <option key={id} value={id}>
                    {classById.get(id)?.name ?? id}
                  </option>
                ))}
              </Select>
            </Field>
            {requestError && <p className="text-sm text-red-600 dark:text-red-400">{requestError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowRequest(false)}>
                Cancel
              </Button>
              <Button onClick={submitRequest}>Submit Request</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
