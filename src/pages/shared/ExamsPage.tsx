import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import type { Class, Exam, Subject } from '@/types/database'

export function ExamsPage() {
  const { show } = useToast()
  const [exams, setExams] = useState<Exam[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', subject_id: '', exam_date: '', total_marks: '100', duration_minutes: '60' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [examsRes, subjectsRes, classesRes] = await Promise.all([
      supabase.from('exams').select('*').order('exam_date', { ascending: false }),
      supabase.from('subjects').select('*').eq('status', 'active'),
      supabase.from('classes').select('*'),
    ])
    if (examsRes.error) show(examsRes.error.message, 'error')
    else setExams(examsRes.data as Exam[])
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  function openCreate() {
    setForm({ name: '', subject_id: subjects[0]?.id ?? '', exam_date: '', total_marks: '100', duration_minutes: '60' })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subject_id || !form.exam_date) {
      setError('Name, subject, and date are required.')
      return
    }
    const totalMarks = Number(form.total_marks)
    if (Number.isNaN(totalMarks) || totalMarks <= 0) {
      setError('Total marks must be a positive number.')
      return
    }
    // Blank is allowed — the paper just leaves the TIME line off.
    const duration = form.duration_minutes.trim() === '' ? null : Number(form.duration_minutes)
    if (duration !== null && (Number.isNaN(duration) || duration <= 0)) {
      setError('Duration must be a positive number of minutes, or left blank.')
      return
    }
    const subject = subjectById.get(form.subject_id)
    if (!subject) {
      setError('Pick a valid subject.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('exams').insert({
      name: form.name.trim(),
      subject_id: form.subject_id,
      class_id: subject.class_id,
      exam_date: form.exam_date,
      total_marks: totalMarks,
      duration_minutes: duration,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    show('Exam created.')
    setShowForm(false)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Exams & Results</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create exams, assemble papers, and enter marks.</p>
        </div>
        <Button onClick={openCreate} disabled={subjects.length === 0}>
          + New Exam
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Exam</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Total Marks</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  Loading...
                </td>
              </tr>
            ) : exams.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No exams yet.
                </td>
              </tr>
            ) : (
              exams.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{e.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classById.get(e.class_id)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{subjectById.get(e.subject_id)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(e.exam_date)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.total_marks}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={e.id} className="text-sm text-brand-600 hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title="New Exam" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="Exam name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Subject">
              <Select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Exam date">
              <Input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
            </Field>
            <Field label="Duration (minutes)">
              <Input
                type="number"
                min="1"
                placeholder="60"
                value={form.duration_minutes}
                onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              />
            </Field>
            <Field label="Total marks">
              <Input
                type="number"
                min="1"
                value={form.total_marks}
                onChange={(e) => setForm({ ...form, total_marks: e.target.value })}
              />
            </Field>
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
