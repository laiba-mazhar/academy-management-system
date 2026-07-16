import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Select, Input } from '@/components/ui/Input'
import { DAY_NAMES } from '@/lib/utils'
import type { Class, Subject, Timetable, TeacherStatus } from '@/types/database'

type TeacherOption = { id: string; full_name: string; status: TeacherStatus }

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function AdminTimetablePage() {
  const { show } = useToast()
  const [slots, setSlots] = useState<Timetable[]>([])
  const [teachers, setTeachers] = useState<TeacherOption[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ teacher_id: '', subject_id: '', day_of_week: '1', start_time: '09:00', end_time: '10:00' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [slotsRes, profilesRes, teachersRes, subjectsRes, classesRes] = await Promise.all([
      supabase.from('timetable').select('*'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('teachers').select('id, status'),
      supabase.from('subjects').select('*').eq('status', 'active'),
      supabase.from('classes').select('*'),
    ])
    if (slotsRes.error) show(slotsRes.error.message, 'error')
    else setSlots(slotsRes.data as Timetable[])
    if (profilesRes.data) {
      const statusById = new Map((teachersRes.data ?? []).map((t) => [t.id, t.status as TeacherStatus]))
      setTeachers(
        (profilesRes.data as { id: string; full_name: string }[]).map((p) => ({
          ...p,
          status: statusById.get(p.id) ?? 'active',
        }))
      )
    }
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const assignableTeachers = useMemo(() => teachers.filter((t) => t.status !== 'left'), [teachers])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const teacherSubjects = subjects.filter((s) => s.teacher_id === form.teacher_id)

  const slotsByDay = useMemo(() => {
    const map = new Map<number, Timetable[]>()
    for (const s of slots) {
      const list = map.get(s.day_of_week) ?? []
      list.push(s)
      map.set(s.day_of_week, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time))
    return map
  }, [slots])

  function openCreate() {
    setForm({ teacher_id: '', subject_id: '', day_of_week: '1', start_time: '09:00', end_time: '10:00' })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.teacher_id || !form.subject_id) {
      setError('Teacher and subject are required.')
      return
    }
    const startMin = timeToMinutes(form.start_time)
    const endMin = timeToMinutes(form.end_time)
    if (endMin <= startMin) {
      setError('End time must be after start time.')
      return
    }
    const day = Number(form.day_of_week)
    const subject = subjectById.get(form.subject_id)
    if (!subject) {
      setError('Pick a valid subject.')
      return
    }

    const conflict = slots.find((s) => {
      if (s.day_of_week !== day) return false
      const overlaps = startMin < timeToMinutes(s.end_time) && endMin > timeToMinutes(s.start_time)
      if (!overlaps) return false
      return s.teacher_id === form.teacher_id || s.class_id === subject.class_id
    })
    if (conflict) {
      setError('This overlaps with an existing slot for that teacher or class on the same day.')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('timetable').insert({
      teacher_id: form.teacher_id,
      class_id: subject.class_id,
      subject_id: form.subject_id,
      day_of_week: day,
      start_time: form.start_time,
      end_time: form.end_time,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    show('Timetable slot added.')
    setShowForm(false)
    load()
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('timetable').delete().eq('id', id)
    if (error) show(error.message, 'error')
    else {
      show('Slot removed.')
      load()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Timetable</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Weekly schedule across all classes.</p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button onClick={openCreate}>+ Add Slot</Button>
        </div>
      </div>

      <div className="print-area space-y-4">
        <h2 className="hidden text-lg font-semibold print:block">Class Timetable</h2>
        {loading ? (
          <p className="text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          DAY_NAMES.map((dayName, dayIdx) => {
            const daySlots = slotsByDay.get(dayIdx) ?? []
            if (daySlots.length === 0) return null
            return (
              <div key={dayIdx} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {dayName}
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Class</th>
                      <th className="px-4 py-2">Subject</th>
                      <th className="px-4 py-2">Teacher</th>
                      <th className="no-print px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {daySlots.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100 dark:border-slate-700/60">
                        <td className="px-4 py-2">
                          {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                        </td>
                        <td className="px-4 py-2">{classById.get(s.class_id)?.name ?? '—'}</td>
                        <td className="px-4 py-2">{subjectById.get(s.subject_id)?.name ?? '—'}</td>
                        <td className="px-4 py-2">{teacherById.get(s.teacher_id)?.full_name ?? '—'}</td>
                        <td className="no-print px-4 py-2 text-right">
                          <button onClick={() => handleDelete(s.id)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })
        )}
        {!loading && slots.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-16 text-center text-slate-400 dark:text-slate-500">
            No timetable slots yet.
          </p>
        )}
      </div>

      {showForm && (
        <Modal title="Add Timetable Slot" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="Teacher">
              <Select
                value={form.teacher_id}
                onChange={(e) => setForm({ ...form, teacher_id: e.target.value, subject_id: '' })}
              >
                <option value="">Select teacher...</option>
                {assignableTeachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Select
                value={form.subject_id}
                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                disabled={!form.teacher_id}
              >
                <option value="">Select subject...</option>
                {teacherSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Day">
              <Select value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
                {DAY_NAMES.map((d, idx) => (
                  <option key={idx} value={idx}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
              </Field>
              <Field label="End time">
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
