import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { QuestionImport } from '@/components/QuestionImport'
import type { Class, Question, QuestionType, Subject } from '@/types/database'

const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'MCQ',
  short: 'Short',
  long: 'Long',
  fill_blank: 'Fill in the blank',
  true_false: 'True / False',
}

export function QuestionBankPage() {
  const { show } = useToast()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all')
  const [showImport, setShowImport] = useState(false)

  const [form, setForm] = useState<{
    id: string | null
    subject_id: string
    chapter: string
    question_text: string
    marks: string
    question_type: QuestionType
    options: { key: string; text: string }[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null)

  async function load() {
    setLoading(true)
    const [subjectsRes, classesRes, questionsRes] = await Promise.all([
      supabase.from('subjects').select('*').eq('status', 'active'),
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

  const filtered = questions.filter(
    (q) =>
      (subjectFilter === 'all' || q.subject_id === subjectFilter) &&
      (typeFilter === 'all' || q.question_type === typeFilter)
  )

  function openCreate() {
    setForm({
      id: null,
      subject_id: subjects[0]?.id ?? '',
      chapter: '',
      question_text: '',
      marks: '5',
      question_type: 'short',
      options: [],
    })
    setError(null)
  }

  function openEdit(q: Question) {
    setForm({
      id: q.id,
      subject_id: q.subject_id,
      chapter: q.chapter ?? '',
      question_text: q.question_text,
      marks: String(q.marks),
      question_type: q.question_type,
      options: q.options ?? [],
    })
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
      question_type: form.question_type,
      options: form.question_type === 'mcq' && form.options.length > 0 ? form.options : null,
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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)} disabled={subjects.length === 0}>
            Import from past paper
          </Button>
          <Button onClick={openCreate} disabled={subjects.length === 0}>
            + Add Question
          </Button>
        </div>
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
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | QuestionType)}
          className="max-w-[12rem]"
        >
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
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
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {TYPE_LABELS[q.question_type]}
                  </span>
                  {q.difficulty && (
                    <span className="text-[11px] capitalize text-slate-400 dark:text-slate-500">{q.difficulty}</span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-800 dark:text-slate-100">{q.question_text}</p>
                {q.question_type === 'mcq' && q.options && q.options.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {q.options.map((o) => (
                      <li key={o.key}>
                        <span className="font-semibold">{o.key})</span> {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {subjectById.get(q.subject_id)?.name ?? '—'}
                  {q.chapter ? ` · ${q.chapter}` : ''} · {q.marks} marks
                  {q.source ? ` · ${q.source}` : ''}
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
            <Field label="Question type">
              <Select
                value={form.question_type}
                onChange={(e) => setForm({ ...form, question_type: e.target.value as QuestionType })}
              >
                {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Question text">
              <Textarea
                rows={3}
                value={form.question_text}
                onChange={(e) => setForm({ ...form, question_text: e.target.value })}
              />
            </Field>
            {form.question_type === 'mcq' && (
              <Field label="Options">
                <div className="space-y-1">
                  {form.options.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {option.key}
                      </span>
                      <Input
                        value={option.text}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            options: form.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)),
                          })
                        }
                      />
                      <button
                        onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })}
                        className="shrink-0 text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setForm({
                        ...form,
                        options: [
                          ...form.options,
                          { key: String.fromCharCode(65 + form.options.length), text: '' },
                        ],
                      })
                    }
                    className="text-xs text-brand-600 hover:underline dark:text-gold-400"
                  >
                    + Add option
                  </button>
                </div>
              </Field>
            )}
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

      {showImport && (
        <QuestionImport
          subjects={subjects}
          classes={classes}
          existing={questions}
          onClose={() => setShowImport(false)}
          onSaved={load}
        />
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
