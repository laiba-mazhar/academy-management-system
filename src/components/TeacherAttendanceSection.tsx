import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import { daysAgoLocalDate, formatDate, todayLocalDate } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { AttendanceStatus, Subject, TeacherAttendance, TeacherStatus } from '@/types/database'

type TeacherOption = { id: string; full_name: string; status: TeacherStatus }

export function TeacherAttendanceSection() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [teachers, setTeachers] = useState<TeacherOption[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [date, setDate] = useState(todayLocalDate())
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [historyFor, setHistoryFor] = useState<TeacherOption | null>(null)
  const [history, setHistory] = useState<TeacherAttendance[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFrom, setHistoryFrom] = useState(daysAgoLocalDate(30))
  const [historyTo, setHistoryTo] = useState(todayLocalDate())

  async function load() {
    setLoading(true)
    const [profilesRes, teachersRes, attendanceRes, subjectsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('teachers').select('id, status'),
      supabase.from('teacher_attendance').select('*').eq('date', date),
      supabase.from('subjects').select('*').eq('status', 'active'),
    ])
    if (profilesRes.error) show(profilesRes.error.message, 'error')
    else {
      const statusById = new Map((teachersRes.data ?? []).map((t) => [t.id, t.status as TeacherStatus]))
      setTeachers(
        (profilesRes.data as { id: string; full_name: string }[]).map((p) => ({
          ...p,
          status: statusById.get(p.id) ?? 'active',
        }))
      )
    }
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    const initialMarks: Record<string, AttendanceStatus> = {}
    if (attendanceRes.data) {
      for (const row of attendanceRes.data as TeacherAttendance[]) {
        initialMarks[row.teacher_id] = row.status
      }
    }
    setMarks(initialMarks)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const activeTeachers = useMemo(() => {
    const teacherIdsForSubject =
      subjectFilter === 'all' ? null : new Set(subjects.filter((s) => s.id === subjectFilter).map((s) => s.teacher_id))
    return teachers.filter((t) => {
      if (t.status === 'left') return false
      if (teacherIdsForSubject && !teacherIdsForSubject.has(t.id)) return false
      return true
    })
  }, [teachers, subjects, subjectFilter])

  function markAll(status: AttendanceStatus) {
    const next: Record<string, AttendanceStatus> = {}
    for (const t of activeTeachers) next[t.id] = status
    setMarks(next)
  }

  async function handleSave() {
    if (activeTeachers.length === 0) return
    setSaving(true)
    const rows = activeTeachers
      .filter((t) => marks[t.id])
      .map((t) => ({
        teacher_id: t.id,
        date,
        status: marks[t.id],
        marked_by: profile!.id,
      }))
    if (rows.length === 0) {
      setSaving(false)
      show('Mark at least one teacher before saving.', 'error')
      return
    }
    const { error } = await supabase.from('teacher_attendance').upsert(rows, { onConflict: 'teacher_id,date' })
    setSaving(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show('Teacher attendance saved.')
  }

  async function loadHistory(teacherId: string, from: string, to: string) {
    setHistoryLoading(true)
    const { data, error } = await supabase
      .from('teacher_attendance')
      .select('*')
      .eq('teacher_id', teacherId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
    if (error) show(error.message, 'error')
    else setHistory(data as TeacherAttendance[])
    setHistoryLoading(false)
  }

  function openHistory(teacher: TeacherOption) {
    setHistoryFor(teacher)
    const from = daysAgoLocalDate(30)
    const to = todayLocalDate()
    setHistoryFrom(from)
    setHistoryTo(to)
    loadHistory(teacher.id, from, to)
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Date</label>
          <input
            type="date"
            value={date}
            max={todayLocalDate()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </div>
        <div className="min-w-[200px]">
          <Field label="Subject">
            <Select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
              <option value="all">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => markAll('present')}>
            Mark all present
          </Button>
          <Button variant="secondary" onClick={() => markAll('absent')}>
            Mark all absent
          </Button>
        </div>
      </div>

      <div className="print-area overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="hidden border-b px-4 py-2 print:block">
          <p className="font-semibold">Teacher Attendance — {formatDate(date)}</p>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">Loading...</p>
        ) : activeTeachers.length === 0 ? (
          <EmptyState
            title="No teachers to show"
            description={
              teachers.length === 0
                ? 'Add teachers from the Teachers page first.'
                : 'No active teachers match the selected subject filter.'
            }
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Present</th>
                <th className="px-4 py-3">Absent</th>
                <th className="px-4 py-3">Late</th>
                <th className="no-print px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {activeTeachers.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{t.full_name}</td>
                  {(['present', 'absent', 'late'] as AttendanceStatus[]).map((status) => (
                    <td key={status} className="px-4 py-3">
                      <input
                        type="radio"
                        name={`teacher-status-${t.id}`}
                        checked={marks[t.id] === status}
                        onChange={() => setMarks({ ...marks, [t.id]: status })}
                        className="no-print h-4 w-4"
                      />
                      <span className="hidden print:inline">{marks[t.id] === status ? '✓' : ''}</span>
                    </td>
                  ))}
                  <td className="no-print px-4 py-3 text-right">
                    <button onClick={() => openHistory(t)} className="text-sm text-brand-600 hover:underline dark:text-gold-400">
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="no-print flex justify-end gap-2">
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
        <Button onClick={handleSave} disabled={saving || activeTeachers.length === 0}>
          {saving ? 'Saving...' : 'Save Attendance'}
        </Button>
      </div>

      {historyFor && (
        <Modal title={`Attendance History — ${historyFor.full_name}`} onClose={() => setHistoryFor(null)}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="From">
              <input
                type="date"
                value={historyFrom}
                max={historyTo}
                onChange={(e) => {
                  setHistoryFrom(e.target.value)
                  loadHistory(historyFor.id, e.target.value, historyTo)
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={historyTo}
                min={historyFrom}
                max={todayLocalDate()}
                onChange={(e) => {
                  setHistoryTo(e.target.value)
                  loadHistory(historyFor.id, historyFrom, e.target.value)
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </Field>
          </div>
          {historyLoading ? (
            <p className="text-slate-400 dark:text-slate-500">Loading...</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No attendance recorded in this range.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                      <td className="px-2 py-2 text-slate-800 dark:text-slate-100">{formatDate(h.date)}</td>
                      <td className="px-2 py-2 capitalize text-slate-600 dark:text-slate-300">{h.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
