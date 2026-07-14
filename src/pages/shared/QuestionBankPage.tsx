import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import type { Class, Question, Subject } from '@/types/database'

export function QuestionBankPage() {
  const { show } = useToast()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [subjectFilter, setSubjectFilter] = useState('all')

  const [form, setForm] = useState<{ id: string | null; subject_id: string; chapter: string; question_text: string; marks: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null)

  async function load() {
    setLoading(true)
    const [subjectsRes, classesRes, questionsRes] = await Promise.all([
      supabase.from('subjects').select('*'),
      supabase.from('classes').select('*'),
      supabase.from('questions').select('*').order('created_at', { ascending: false }),
    ])
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (questionsRes.error) show(questionsRes.error.message, 'error')
    else setQuestions(questionsRes.data as Question[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const filtered = questions.filter((q) => subjectFilter === 'all' || q.subject_id === subjectFilter)

  function openCreate() {
    setForm({ id: null, subject_id: subjects[0]?.id ?? '', chapter: '', question_text: '', marks: '5' })
    setError(null)
  }

  function openEdit(q: Question) {
    setForm({ id: q.id, subject_id: q.subject_id, chapter: q.chapter ?? '', question_text: q.question_text, marks: String(q.marks) })
    setError(null)
  }

  async function handleSave() {
    if (!form) return
    if (!form.subject_id || !form.question_text.trim()) {
      setError('Subject and question text are required.')
      return
    }
    const marks = Number(form.marks)
    if (Number.isNaN(marks) || marks <= 0) {
      setError('Marks must be a positive number.')
      return
    }
    const subject = subjectById.get(form.subject_id)
    if (!subject) {
      setError('Pick a valid subject.')
      return
    }
    const payload = {
      subject_id: form.subject_id,
      class_id: subject.class_id,
      chapter: form.chapter.trim() || null,
      question_text: form.question_text.trim(),
      marks,
    }
    const result = form.id
      ? await supabase.from('questions').update(payload).eq('id', form.id)
      : await supabase.from('questions').insert(payload)
    if (result.error) {
      setError(result.error.message)
      return
    }
    show(form.id ? 'Question updated.' : 'Question added.')
    setForm(null)
    load()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const { error } = await supabase.from('questions').delete().eq('id', deleteTarget.id)
    if (error) show(error.message, 'error')
    else {
      show('Question deleted.')
      load()
    }
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Question Bank</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Organize questions by subject and chapter for exam papers.</p>
        </div>
        <Button onClick={openCreate} disabled={subjects.length === 0}>
          + Add Question
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <Select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} className="max-w-xs">
          <option value="all">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({classById.get(s.class_id)?.name ?? '?'})
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        {loading ? (
          <p className="text-slate-400 dark:text-slate-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-16 text-center text-slate-400 dark:text-slate-500">
            No questions yet.
          </p>
        ) : (
          filtered.map((q) => (
            <div key={q.id} className="flex items-start justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <div>
                <p className="text-sm text-slate-800 dark:text-slate-100">{q.question_text}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {subjectById.get(q.subject_id)?.name ?? '—'}
                  {q.chapter ? ` · ${q.chapter}` : ''} · {q.marks} marks
                </p>
              </div>
              <div className="flex shrink-0 gap-3 pl-4">
                <button onClick={() => openEdit(q)} className="text-sm text-brand-600 hover:underline">
                  Edit
                </button>
                <button onClick={() => setDeleteTarget(q)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Edit Question' : 'Add Question'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="Subject">
              <Select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Chapter / topic (optional)">
              <Input value={form.chapter} onChange={(e) => setForm({ ...form, chapter: e.target.value })} />
            </Field>
            <Field label="Question text">
              <Textarea
                rows={3}
                value={form.question_text}
                onChange={(e) => setForm({ ...form, question_text: e.target.value })}
              />
            </Field>
            <Field label="Marks">
              <Input
                type="number"
                min="1"
                step="0.5"
                value={form.marks}
                onChange={(e) => setForm({ ...form, marks: e.target.value })}
              />
            </Field>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete question"
          message="Delete this question from the bank? It will also be removed from any exam papers using it."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
