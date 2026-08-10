import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { QuestionImport } from '@/components/QuestionImport'
import { BookLibrary } from '@/components/BookLibrary'
import { SnipImage } from '@/components/SnipImage'
import { signPages } from '@/lib/sourceBooks'
import { McqOptionsEditor } from '@/components/McqOptionsEditor'
import { SymbolPad } from '@/components/SymbolPad'
import { QUESTION_TYPE_LABELS as TYPE_LABELS, QUESTION_TYPES } from '@/lib/questionTypes'
import type { Class, Question, QuestionType, SourceBookPage, Subject } from '@/types/database'


export function QuestionBankPage() {
  const { show } = useToast()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all')
  const [showImport, setShowImport] = useState(false)
  const [showBooks, setShowBooks] = useState(false)
  const [snipPages, setSnipPages] = useState<Map<string, SourceBookPage>>(new Map())
  const [snipUrls, setSnipUrls] = useState<Map<string, string>>(new Map())
  const [sourceFilter, setSourceFilter] = useState('all')
  const [purgeSource, setPurgeSource] = useState<string | null>(null)

  const [form, setForm] = useState<{
    id: string | null
    subject_id: string
    chapter: string
    question_text: string
    marks: string
    question_type: QuestionType
    options: { key: string; text: string }[]
    translation: string
    options_translated: { key: string; text: string }[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null)
  const questionTextRef = useRef<HTMLTextAreaElement>(null)

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
    else {
      const rows = questionsRes.data as Question[]
      setQuestions(rows)
      await loadSnips(rows)
    }
    setLoading(false)
  }

  // Snipped questions are pictures of book pages, so the bank needs the page
  // rows and a signed link for each before it can show them.
  async function loadSnips(rows: Question[]) {
    const ids = [...new Set(rows.map((q) => q.source_page_id).filter((id): id is string => !!id))]
    if (ids.length === 0) {
      setSnipPages(new Map())
      setSnipUrls(new Map())
      return
    }
    const { data } = await supabase.from('source_book_pages').select('*').in('id', ids)
    const pages = (data ?? []) as SourceBookPage[]
    setSnipPages(new Map(pages.map((p) => [p.id, p])))
    try {
      setSnipUrls(await signPages(pages))
    } catch {
      setSnipUrls(new Map())
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // Every imported question records the file it came from, which is what makes
  // a bad import undoable — an OCR run in the wrong language can otherwise
  // leave dozens of rows of noise to delete one at a time.
  const sources = useMemo(
    () => [...new Set(questions.map((q) => q.source).filter((s): s is string => !!s))].sort(),
    [questions]
  )

  const filtered = questions.filter(
    (q) =>
      (subjectFilter === 'all' || q.subject_id === subjectFilter) &&
      (typeFilter === 'all' || q.question_type === typeFilter) &&
      (sourceFilter === 'all' || q.source === sourceFilter)
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
      translation: '',
      options_translated: [],
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
      translation: q.translation ?? '',
      options_translated: q.options_translated ?? [],
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
      translation: form.translation.trim() || null,
      // Written as a pair: translated choices with an untranslated stem would
      // print half the question in each language.
      options_translated:
        form.translation.trim() && form.question_type === 'mcq' && form.options_translated.length > 0
          ? form.options_translated
          : null,
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

  // Undoes one import wholesale, matched on the recorded source file.
  async function handlePurgeSource() {
    if (!purgeSource) return
    const { error } = await supabase.from('questions').delete().eq('source', purgeSource)
    if (error) show(error.message, 'error')
    else {
      show('Imported questions deleted.')
      setSourceFilter('all')
      load()
    }
    setPurgeSource(null)
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
          <Button variant="secondary" onClick={() => setShowBooks(true)} disabled={subjects.length === 0}>
            Scanned books
          </Button>
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
        {sources.length > 0 && (
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="max-w-[16rem]">
            <option value="all">Any source</option>
            {sources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </Select>
        )}
        {sourceFilter !== 'all' && (
          <Button variant="danger" onClick={() => setPurgeSource(sourceFilter)}>
            Delete all {filtered.length} from this import
          </Button>
        )}
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | QuestionType)}
          className="max-w-[12rem]"
        >
          <option value="all">All types</option>
          {QUESTION_TYPES.map((t) => (
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
                {q.source_page_id && q.crop && snipPages.get(q.source_page_id) ? (
                  <div className="mt-1">
                    <p className="text-xs italic text-slate-500 dark:text-slate-400">{q.question_text}</p>
                    <SnipImage
                      page={snipPages.get(q.source_page_id)!}
                      crop={q.crop}
                      url={snipUrls.get(q.source_page_id)}
                      width={420}
                      className="mt-1 rounded border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                ) : (
                  <p dir="auto" className="mt-1 whitespace-pre-line text-sm text-slate-800 dark:text-slate-100">
                    {q.question_text}
                  </p>
                )}
                {q.question_type === 'mcq' && q.options && q.options.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {q.options.map((o) => (
                      <li key={o.key} dir="auto">
                        <span className="font-semibold">{o.key})</span> {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                {/* The other language sits under the original, never in place
                    of it — the printed wording stays the reference. */}
                {q.translation && (
                  <div className="mt-1.5 border-l-2 border-slate-200 pl-2 dark:border-slate-600">
                    <p dir="auto" className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                      {q.translation}
                    </p>
                    {q.question_type === 'mcq' && q.options_translated && q.options_translated.length > 0 && (
                      <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {q.options_translated.map((o) => (
                          <li key={o.key} dir="auto">
                            <span className="font-semibold">{o.key})</span> {o.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Question text">
              <Textarea
                ref={questionTextRef}
                rows={3}
                value={form.question_text}
                onChange={(e) => setForm({ ...form, question_text: e.target.value })}
              />
              <div className="mt-2">
                <SymbolPad
                  targetRef={questionTextRef}
                  value={form.question_text}
                  onChange={(question_text) => setForm({ ...form, question_text })}
                />
              </div>
            </Field>
            {form.question_type === 'mcq' && (
              <Field label="Options">
                <McqOptionsEditor
                  options={form.options}
                  onChange={(options) => setForm({ ...form, options })}
                />
              </Field>
            )}
            {/* Optional on purpose. A language subject has no meaningful other
                version, and an empty box saves nothing rather than saving a
                translation nobody checked. */}
            <Field label="Other language (optional)">
              <Textarea
                dir="auto"
                rows={2}
                value={form.translation}
                placeholder="The same question in Urdu, or in English — leave empty if it has no useful translation."
                onChange={(e) => setForm({ ...form, translation: e.target.value })}
              />
            </Field>
            {form.question_type === 'mcq' && form.translation.trim() && (
              <Field label="Options in the other language">
                <McqOptionsEditor
                  options={form.options_translated}
                  onChange={(options_translated) => setForm({ ...form, options_translated })}
                />
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

      {showBooks && (
        <BookLibrary
          subjects={subjects}
          classes={classes}
          onClose={() => setShowBooks(false)}
          onQuestionAdded={load}
        />
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

      {purgeSource && (
        <ConfirmDialog
          title="Delete a whole import"
          message={`Delete every question imported from “${purgeSource}”? This removes them from the bank and from any exam papers using them.`}
          confirmLabel="Delete them"
          danger
          onCancel={() => setPurgeSource(null)}
          onConfirm={handlePurgeSource}
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
