import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { readCropWithAi, signPages, textInCrop, uploadBook, type UploadProgress } from '@/lib/sourceBooks'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from '@/lib/questionTypes'
import type { Class, Crop, QuestionType, SourceBook, SourceBookPage, Subject } from '@/types/database'

// A scanned book kept as pages, and the tool for taking questions out of it.
//
// Nothing here reads the text. A teacher drags a box around a question and that
// region goes into the bank as an image, so an Urdu-medium book stays in Urdu,
// a maths page keeps its notation and a physics page keeps its diagram.
export function BookLibrary({
  subjects,
  classes,
  onClose,
  onQuestionAdded,
}: {
  subjects: Subject[]
  classes: Class[]
  onClose: () => void
  onQuestionAdded: () => void
}) {
  const { show } = useToast()
  const [books, setBooks] = useState<SourceBook[]>([])
  const [loading, setLoading] = useState(true)
  const [openBook, setOpenBook] = useState<SourceBook | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SourceBook | null>(null)

  const [uploading, setUploading] = useState<UploadProgress | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newSubject, setNewSubject] = useState(subjects[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])

  async function load() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('source_books')
      .select('*')
      .order('created_at', { ascending: false })
    if (loadError) show(loadError.message, 'error')
    else setBooks((data ?? []) as SourceBook[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleUpload(file: File) {
    const subject = subjectById.get(newSubject)
    if (!subject) {
      setError('Pick a subject for this book.')
      return
    }
    if (!newTitle.trim()) {
      setError('Give the book a title so teachers can find it.')
      return
    }
    setError(null)
    try {
      await uploadBook(
        { file, title: newTitle, subjectId: subject.id, classId: subject.class_id },
        setUploading
      )
      show('Book uploaded.')
      setNewTitle('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that book.')
    } finally {
      setUploading(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    // Storage objects go with the book; questions snipped from it keep their
    // own rows but lose the page reference, which the bank shows as missing.
    const { data: pages } = await supabase
      .from('source_book_pages')
      .select('storage_path')
      .eq('book_id', deleteTarget.id)
    const paths = ((pages ?? []) as { storage_path: string }[]).map((p) => p.storage_path)
    if (paths.length > 0) await supabase.storage.from('book-pages').remove(paths)

    const { error: deleteError } = await supabase.from('source_books').delete().eq('id', deleteTarget.id)
    if (deleteError) show(deleteError.message, 'error')
    else show('Book deleted.')
    setDeleteTarget(null)
    load()
  }

  if (openBook) {
    return (
      <BookViewer
        book={openBook}
        onClose={() => setOpenBook(null)}
        onQuestionAdded={onQuestionAdded}
      />
    )
  }

  return (
    <Modal title="Scanned books" size="wide" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Add a book</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Pages are stored as pictures, exactly as scanned. Nothing is read or translated, so Urdu stays Urdu.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <Input
                value={newTitle}
                placeholder="Physics 11 — Textbook"
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </Field>
            <Field label="Subject">
              <Select value={newSubject} onChange={(e) => setNewSubject(e.target.value)}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = ''
            }}
          />
          <div className="mt-3">
            {uploading ? (
              <div>
                <p className="text-xs text-slate-600 dark:text-slate-300">{uploading.note}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all duration-200"
                    style={{ width: `${Math.round((uploading.page / Math.max(uploading.totalPages, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                Choose a scanned PDF
              </Button>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : books.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500">
            No books yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {books.map((book) => (
              <li
                key={book.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{book.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    {subjectById.get(book.subject_id)?.name ?? '—'} · {book.page_count} pages
                  </p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    onClick={() => setOpenBook(book)}
                    className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setDeleteTarget(book)}
                    className="text-sm text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete book"
          message={`Delete “${deleteTarget.title}” and all its pages? Questions already snipped from it stay in the bank but will no longer show their picture.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </Modal>
  )
}

// One page at a time, with a rectangle dragged over the part to keep.
function BookViewer({
  book,
  onClose,
  onQuestionAdded,
}: {
  book: SourceBook
  onClose: () => void
  onQuestionAdded: () => void
}) {
  const { show } = useToast()
  const [pages, setPages] = useState<SourceBookPage[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [index, setIndex] = useState(0)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ label: '', marks: '2', chapter: '', question_type: 'short' as QuestionType })
  // The text pulled out of the dragged region. Editable, because a box drawn
  // across a column can pick up a stray word from the next one.
  const [snipText, setSnipText] = useState('')
  const [edited, setEdited] = useState(false)
  const [reading, setReading] = useState(false)
  const imageRef = useRef<HTMLDivElement>(null)

  const page = pages[index]
  const hasTextLayer = !!page?.text_items?.length

  // Re-read on every drag, unless the teacher has started correcting it.
  useEffect(() => {
    if (!page || !crop || edited) return
    setSnipText(textInCrop(page.text_items, crop))
  }, [page, crop, edited])

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('source_book_pages')
        .select('*')
        .eq('book_id', book.id)
        .order('page_number')
      if (error) {
        show(error.message, 'error')
        return
      }
      const rows = (data ?? []) as SourceBookPage[]
      setPages(rows)
      try {
        setUrls(await signPages(rows))
      } catch (err) {
        show(err instanceof Error ? err.message : 'Could not load the pages.', 'error')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // Drag coordinates are converted to fractions of the page immediately, so the
  // stored crop does not depend on how big the viewer happened to be.
  function pointAt(e: React.MouseEvent) {
    const box = imageRef.current?.getBoundingClientRect()
    if (!box) return null
    return {
      x: Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((e.clientY - box.top) / box.height, 0), 1),
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    const p = pointAt(e)
    if (!p) return
    setDragFrom(p)
    setEdited(false)
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragFrom) return
    const p = pointAt(e)
    if (!p) return
    setCrop({
      x: Math.min(dragFrom.x, p.x),
      y: Math.min(dragFrom.y, p.y),
      w: Math.abs(p.x - dragFrom.x),
      h: Math.abs(p.y - dragFrom.y),
    })
  }

  // Only offered on a true scan: where the page has its own text layer the
  // characters are already exact, and asking a model to re-read them could only
  // make them worse.
  async function readWithAi() {
    const url = page ? urls.get(page.id) : undefined
    if (!page || !url || !crop || crop.w < 0.02 || crop.h < 0.01) {
      show('Drag a box around the question first.', 'error')
      return
    }
    setReading(true)
    try {
      const text = await readCropWithAi(url, crop)
      if (!text) {
        show('Nothing legible was found in that box. Try drawing it a little wider.', 'error')
        return
      }
      // Marking it edited stops the text-layer effect from clearing what the
      // model just read back.
      setEdited(true)
      setSnipText(text)
      show('Read. Check it against the page before adding.')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not read that region.', 'error')
    } finally {
      setReading(false)
    }
  }

  async function saveSnip() {
    if (!page || !crop || crop.w < 0.02 || crop.h < 0.01) {
      show('Drag a box around the question first.', 'error')
      return
    }
    const marks = Number(form.marks)
    if (Number.isNaN(marks) || marks <= 0) {
      show('Marks must be a positive number.', 'error')
      return
    }
    // Where the page carries a text layer, the snip becomes an ordinary text
    // question — searchable, editable, and printable in whatever script it was
    // written in. Only a true scan falls back to storing the picture.
    const asText = snipText.trim()
    setSaving(true)
    const { error } = await supabase.from('questions').insert({
      subject_id: book.subject_id,
      class_id: book.class_id,
      chapter: form.chapter.trim() || null,
      question_text: asText || form.label.trim() || `${book.title} — page ${page.page_number}`,
      marks,
      question_type: form.question_type,
      source: `${book.title} (p${page.page_number})`,
      source_page_id: asText ? null : page.id,
      crop: asText ? null : crop,
    })
    setSaving(false)
    if (error) {
      show(error.message, 'error')
      return
    }
    show(asText ? 'Question added as text.' : 'Question added as a picture.')
    setCrop(null)
    setSnipText('')
    setEdited(false)
    setForm({ ...form, label: '' })
    onQuestionAdded()
  }

  return (
    <Modal title={book.title} size="xl" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              ‹ Previous
            </Button>
            <span className="text-sm text-slate-600 dark:text-slate-300">
              Page {page?.page_number ?? 0} of {pages.length}
            </span>
            <Button
              variant="secondary"
              disabled={index >= pages.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              Next ›
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Drag a box around a question, then add it to the bank.
          </p>
        </div>

        {page && (
          <div className="flex flex-wrap gap-4">
            <div
              ref={imageRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={() => setDragFrom(null)}
              onMouseLeave={() => setDragFrom(null)}
              className="relative max-h-[60vh] w-full max-w-xl cursor-crosshair select-none overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              {urls.get(page.id) ? (
                <img
                  src={urls.get(page.id)}
                  alt={`Page ${page.page_number}`}
                  draggable={false}
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading page…</div>
              )}
              {crop && crop.w > 0 && (
                <div
                  className="pointer-events-none absolute border-2 border-brand-500 bg-brand-500/10"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                />
              )}
            </div>

            <div className="min-w-[15rem] flex-1 space-y-3">
              <Field label={hasTextLayer ? 'Question text (taken from the page)' : 'Question text'}>
                <Textarea
                  dir="auto"
                  rows={5}
                  value={snipText}
                  placeholder={
                    hasTextLayer
                      ? 'Drag a box on the page to pull its text in.'
                      : 'Drag a box, then press “Read with AI” — or leave this blank to keep the snip as a picture.'
                  }
                  onChange={(e) => {
                    setEdited(true)
                    setSnipText(e.target.value)
                  }}
                />
              </Field>
              {!hasTextLayer && (
                <>
                  <Button
                    variant="secondary"
                    onClick={readWithAi}
                    disabled={reading || !crop || crop.w < 0.02}
                  >
                    {reading ? 'Reading…' : 'Read with AI'}
                  </Button>
                  <Field label="Label (used if it stays a picture)">
                    <Input
                      value={form.label}
                      placeholder="Exercise 3.2 Q4"
                      onChange={(e) => setForm({ ...form, label: e.target.value })}
                    />
                  </Field>
                </>
              )}
              <Field label="Type">
                <Select
                  value={form.question_type}
                  onChange={(e) => setForm({ ...form, question_type: e.target.value as QuestionType })}
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Marks">
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={form.marks}
                    onChange={(e) => setForm({ ...form, marks: e.target.value })}
                  />
                </Field>
                <Field label="Chapter">
                  <Input value={form.chapter} onChange={(e) => setForm({ ...form, chapter: e.target.value })} />
                </Field>
              </div>
              <Button onClick={saveSnip} disabled={saving || !crop || crop.w < 0.02}>
                {saving ? 'Adding…' : 'Add this snip to the bank'}
              </Button>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {hasTextLayer
                  ? 'This book carries its own text, so the words above are the book’s own — Urdu stays Urdu, notation stays notation. Correct anything the box caught by mistake before adding.'
                  : 'This page is a true scan with no text in it. “Read with AI” transcribes the box in its own script — Urdu as Urdu, notation as notation — for you to check and correct. Leave the text empty and the snip is stored as a picture instead, printing exactly as it appears here.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
