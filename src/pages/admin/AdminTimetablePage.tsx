import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Select, Input } from '@/components/ui/Input'
import { DAY_NAMES } from '@/lib/utils'
import { TimetableGrid } from '@/components/TimetableGrid'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
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
  const [selectedClassId, setSelectedClassId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ class_id: '', subject_id: '', day_of_week: '1', start_time: '09:00', end_time: '10:00' })
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
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const classSubjects = useMemo(
    () =>
      subjects.filter(
        (s) => s.class_id === form.class_id && s.teacher_id && teacherById.get(s.teacher_id)?.status !== 'left'
      ),
    [subjects, form.class_id, teacherById]
  )
  const selectedSubject = subjectById.get(form.subject_id)
  const selectedSubjectTeacher = selectedSubject?.teacher_id ? teacherById.get(selectedSubject.teacher_id) : undefined

  const filteredSlots = useMemo(
    () => (selectedClassId ? slots.filter((s) => s.class_id === selectedClassId) : []),
    [slots, selectedClassId]
  )

  function openCreate() {
    setForm({
      class_id: selectedClassId || classes[0]?.id || '',
      subject_id: '',
      day_of_week: '1',
      start_time: '09:00',
      end_time: '10:00',
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.class_id || !form.subject_id) {
      setError('Class and subject are required.')
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
    if (!subject || !subject.teacher_id) {
      setError('Pick a valid subject with an assigned teacher.')
      return
    }
    const teacherId = subject.teacher_id

    const conflict = slots.find((s) => {
      if (s.day_of_week !== day) return false
      const overlaps = startMin < timeToMinutes(s.end_time) && endMin > timeToMinutes(s.start_time)
      if (!overlaps) return false
      return s.teacher_id === teacherId || s.class_id === subject.class_id
    })
    if (conflict) {
      setError('This overlaps with an existing slot for that teacher or class on the same day.')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('timetable').insert({
      teacher_id: teacherId,
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

  const selectedClassName = selectedClassId ? classById.get(selectedClassId)?.name : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Timetable</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {selectedClassName ? `Weekly schedule for ${selectedClassName}.` : 'Pick a class below to view its weekly schedule.'}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="secondary" onClick={() => window.print()} disabled={!selectedClassId}>
            Print
          </Button>
          <Button onClick={openCreate}>+ Add Slot</Button>
        </div>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedClassId(c.id)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              selectedClassId === c.id
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {c.name}
          </button>
        ))}
        {classes.length === 0 && !loading && (
          <p className="text-sm text-slate-400 dark:text-slate-500">No classes yet — add one in Classes &amp; Subjects.</p>
        )}
      </div>

      {!selectedClassName ? (
        <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-16 text-center text-slate-400 dark:text-slate-500">
          Select a class above to view its timetable.
        </p>
      ) : (
        <div className="print-area space-y-4">
          <div className="hidden print:block">
            <DocumentLetterhead subtitle={`Class Timetable — ${selectedClassName}`} />
          </div>
          {loading ? (
            <p className="text-slate-400 dark:text-slate-500">Loading...</p>
          ) : (
            <TimetableGrid
              slots={filteredSlots.map((s) => ({
                id: s.id,
                day_of_week: s.day_of_week,
                start_time: s.start_time,
                end_time: s.end_time,
                primary: subjectById.get(s.subject_id)?.name ?? '—',
                secondary: teacherById.get(s.teacher_id)?.full_name ?? '—',
                onRemove: () => handleDelete(s.id),
              }))}
              emptyMessage={`No timetable slots for ${selectedClassName} yet.`}
            />
          )}
        </div>
      )}

      {showForm && (
        <Modal title="Add Timetable Slot" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="Class">
              <Select
                value={form.class_id}
                onChange={(e) => setForm({ ...form, class_id: e.target.value, subject_id: '' })}
              >
                <option value="">Select class...</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Select
                value={form.subject_id}
                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                disabled={!form.class_id}
              >
                <option value="">Select subject...</option>
                {classSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {teacherById.get(s.teacher_id!)?.full_name ?? 'Unknown teacher'}
                  </option>
                ))}
              </Select>
              {form.class_id && classSubjects.length === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  No subjects with an assigned teacher in this class yet. Assign one in Classes &amp; Subjects first.
                </p>
              )}
              {selectedSubjectTeacher && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Teacher: {selectedSubjectTeacher.full_name}</p>
              )}
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
