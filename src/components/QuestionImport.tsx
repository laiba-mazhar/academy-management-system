import { useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { extractPdfText, ScannedPdfError } from '@/lib/pdfText'
import { ocrPdf, type OcrProgress } from '@/lib/pdfOcr'
import { dedupeKey, parseQuestions, type DraftQuestion } from '@/lib/questionParser'
import { QUESTION_TYPE_LABELS as TYPE_LABELS, QUESTION_TYPES } from '@/lib/questionTypes'
import { McqOptionsEditor } from '@/components/McqOptionsEditor'
import { SymbolPad } from '@/components/SymbolPad'
import type { Class, Question, QuestionType, Subject } from '@/types/database'

const TYPE_BADGE: Record<QuestionType, string> = {
  mcq: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-900/40 dark:text-brand-200',
  short: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-700 dark:text-slate-200',
  long: 'bg-gold-300/30 text-gold-700 ring-gold-600/20 dark:bg-gold-700/30 dark:text-gold-300',
  fill_blank: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-700 dark:text-slate-200',
  true_false: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-700 dark:text-slate-200',
}

type Step = 'source' | 'review'
type SourceTab = 'pdf' | 'paste'

export function QuestionImport({
  subjects,
  classes,
  existing,
  onClose,
  onSaved,
}: {
  subjects: Subject[]
  classes: Class[]
  /** The bank as it stands, used to warn about questions already in it. */
  existing: Question[]
  onClose: () => void
  onSaved: () => void
}) {
  const { show } = useToast()
  const [step, setStep] = useState<Step>('source')
  const [tab, setTab] = useState<SourceTab>('pdf')
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '')
  const [pasted, setPasted] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftQuestion[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sectionsFound, setSectionsFound] = useState(false)
  const [bulkChapter, setBulkChapter] = useState('')
  const [bulkMarks, setBulkMarks] = useState('')
  // Held so the "read it anyway" button can retry the same file with OCR
  // without asking the teacher to pick it again.
  const [scannedFile, setScannedFile] = useState<File | null>(null)
  const [ocr, setOcr] = useState<OcrProgress | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const existingKeys = useMemo(() => new Set(existing.map((q) => dedupeKey(q.question_text))), [existing])

  // Flagged rather than blocked: a teacher may genuinely want the same
  // question twice, but importing ten years of past papers otherwise fills
  // the bank with near-identical copies nobody notices.
  const duplicateKeys = useMemo(() => {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const d of drafts) {
      const key = dedupeKey(d.text)
      if (existingKeys.has(key) || seen.has(key)) dupes.add(d.key)
      seen.add(key)
    }
    return dupes
  }, [drafts, existingKeys])

  const uncertainCount = drafts.filter((d) => d.uncertain).length

  function runParse(text: string, source: string) {
    const result = parseQuestions(text)
    if (result.drafts.length === 0) {
      setError('No questions were recognised in that text. Check it looks like a question paper, or add questions manually.')
      return
    }
    // Anything the parser guessed at goes to the top, so a teacher checks six
    // doubtful rows instead of re-reading all forty.
    const ordered = [...result.drafts].sort((a, b) => Number(b.uncertain) - Number(a.uncertain))
    setDrafts(ordered.map((d) => ({ ...d, chapter: d.chapter || '' })))
    setSelected(new Set())
    setSectionsFound(result.sectionsFound)
    setFileName(source)
    setError(null)
    setStep('review')
  }

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    setScannedFile(null)
    try {
      const text = await extractPdfText(file)
      runParse(text, file.name)
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        // Not a dead end any more — offer to recognise it instead.
        setScannedFile(file)
        setError(null)
      } else {
        setError(`Could not read that PDF. ${err instanceof Error ? err.message : ''}`.trim())
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleOcr() {
    if (!scannedFile) return
    setBusy(true)
    setError(null)
    try {
      const text = await ocrPdf(scannedFile, setOcr)
      if (text.trim().length < 20) {
        setError('Text recognition found almost nothing. The scan may be too faint or too skewed — try a clearer copy.')
        return
      }
      runParse(text, scannedFile.name)
      setScannedFile(null)
    } catch (err) {
      setError(`Text recognition failed. ${err instanceof Error ? err.message : ''}`.trim())
    } finally {
      setOcr(null)
      setBusy(false)
    }
  }

  function updateDraft(key: string, patch: Partial<DraftQuestion>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function applyToSelected(patch: Partial<DraftQuestion>) {
    if (selected.size === 0) return
    setDrafts((prev) => prev.map((d) => (selected.has(d.key) ? { ...d, ...patch } : d)))
  }

  function removeSelected() {
    setDrafts((prev) => prev.filter((d) => !selected.has(d.key)))
    setSelected(new Set())
  }

  async function handleSave() {
    const subject = subjects.find((s) => s.id === subjectId)
    if (!subject) {
      setError('Pick a subject for these questions.')
      return
    }
    const invalid = drafts.find((d) => !d.text.trim() || !(Number(d.marks) > 0))
    if (invalid) {
      setError('Every question needs text and marks greater than zero.')
      return
    }

    setBusy(true)
    const { error: insertError } = await supabase.from('questions').insert(
      drafts.map((d) => ({
        subject_id: subject.id,
        class_id: subject.class_id,
        chapter: d.chapter.trim() || null,
        question_text: d.text.trim(),
        marks: Number(d.marks),
        question_type: d.questionType,
        options: d.questionType === 'mcq' && d.options.length > 0 ? d.options : null,
        difficulty: d.difficulty || null,
        source: fileName || null,
      }))
    )
    setBusy(false)

    if (insertError) {
      setError(insertError.message)
      return
    }
    show(`${drafts.length} question${drafts.length === 1 ? '' : 's'} added to the bank.`)
    onSaved()
    onClose()
  }

  return (
    <Modal
      title={step === 'source' ? 'Import questions from a past paper' : `Review ${drafts.length} questions`}
      size={step === 'review' ? 'xl' : 'wide'}
      onClose={onClose}
    >
      {step === 'source' ? (
        <div className="space-y-4">
          <Field label="Subject">
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
            {(['pdf', 'paste'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-cream-50'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {t === 'pdf' ? 'Upload PDF' : 'Paste text'}
              </button>
            ))}
          </div>

          {tab === 'pdf' ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full rounded-xl border-2 border-dashed border-slate-300 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60 dark:border-slate-600 dark:hover:border-brand-500 dark:hover:bg-slate-700/40"
              >
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {busy ? 'Reading the PDF...' : 'Choose a past paper PDF'}
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  The file is read in your browser and never uploaded.
                </p>
              </button>
            </div>
          ) : (
            <Field label="Paste the paper's text">
              <Textarea
                rows={10}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'Open the paper in Word, select all, copy, and paste it here.'}
              />
            </Field>
          )}

          {scannedFile && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                “{scannedFile.name}” is a scan
              </p>
              <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">
                There is no text in this PDF — it is a picture of a paper. Text recognition can read it, but it takes
                a few seconds a page and is less accurate than a Word-exported PDF, so check the questions carefully
                afterwards.
              </p>
              {ocr ? (
                <div className="mt-2">
                  <p className="text-xs text-amber-900 dark:text-amber-200">{ocr.note}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/60">
                    <div
                      className="h-full rounded-full bg-amber-600 transition-all duration-200 dark:bg-amber-400"
                      style={{
                        width: `${Math.round(
                          ((Math.max(ocr.page - 1, 0) + ocr.ratio) / Math.max(ocr.totalPages, 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <Button onClick={handleOcr} disabled={busy}>
                    Read it with text recognition
                  </Button>
                  <Button variant="secondary" onClick={() => { setScannedFile(null); setTab('paste') }}>
                    Paste the text instead
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {tab === 'paste' && (
              <Button onClick={() => runParse(pasted, 'Pasted text')} disabled={!pasted.trim() || busy}>
                Parse questions
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <span className="font-medium text-slate-700 dark:text-slate-200">{drafts.length} found</span>
            {uncertainCount > 0 && (
              <span className="text-amber-700 dark:text-amber-400">{uncertainCount} need checking — shown first</span>
            )}
            {duplicateKeys.size > 0 && (
              <span className="text-red-700 dark:text-red-400">{duplicateKeys.size} look like duplicates</span>
            )}
            <span className="text-slate-400 dark:text-slate-500">
              {sectionsFound ? 'Types read from the paper’s own sections' : 'No sections found — types were guessed'}
            </span>
          </div>

          {/* Past papers carry no chapter and no difficulty, so tagging is the
              real work here. Doing it per row for forty questions is what makes
              teachers abandon an import. */}
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
            <span className="py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set(drafts.map((d) => d.key)))}
              className="py-2 text-xs text-brand-600 hover:underline dark:text-gold-400"
            >
              Select all
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="py-2 text-xs text-brand-600 hover:underline dark:text-gold-400"
            >
              Clear
            </button>
            <div className="flex items-center gap-1">
              <div className="w-32">
                <Input
                  value={bulkChapter}
                  onChange={(e) => setBulkChapter(e.target.value)}
                  placeholder="Chapter"
                />
              </div>
              <Button
                variant="secondary"
                disabled={selected.size === 0 || !bulkChapter.trim()}
                onClick={() => applyToSelected({ chapter: bulkChapter.trim() })}
              >
                Set
              </Button>
            </div>
            {/* A textbook exercise carries no marks at all, so setting them one
                row at a time is the slowest part of importing one. */}
            <div className="flex items-center gap-1">
              <div className="w-20">
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={bulkMarks}
                  onChange={(e) => setBulkMarks(e.target.value)}
                  placeholder="Marks"
                />
              </div>
              <Button
                variant="secondary"
                disabled={selected.size === 0 || !(Number(bulkMarks) > 0)}
                onClick={() => applyToSelected({ marks: bulkMarks })}
              >
                Set
              </Button>
            </div>
            <div className="w-32">
              <Select
                value=""
                disabled={selected.size === 0}
                onChange={(e) =>
                  e.target.value && applyToSelected({ difficulty: e.target.value as DraftQuestion['difficulty'] })
                }
              >
                <option value="">Difficulty…</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </div>
            <div className="w-36">
              <Select
                value=""
                disabled={selected.size === 0}
                onChange={(e) => e.target.value && applyToSelected({ questionType: e.target.value as QuestionType })}
              >
                <option value="">Set type…</option>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="danger" disabled={selected.size === 0} onClick={removeSelected}>
              Remove
            </Button>
          </div>

          <div className="space-y-2">
            {drafts.map((draft) => (
              <DraftRow
                key={draft.key}
                draft={draft}
                selected={selected.has(draft.key)}
                duplicate={duplicateKeys.has(draft.key)}
                onToggle={() => toggle(draft.key)}
                onChange={(patch) => updateDraft(draft.key, patch)}
              />
            ))}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
            <Button variant="secondary" onClick={() => setStep('source')}>
              Back
            </Button>
            <Button onClick={handleSave} disabled={busy || drafts.length === 0}>
              {busy ? 'Saving...' : `Add ${drafts.length} to bank`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function DraftRow({
  draft,
  selected,
  duplicate,
  onToggle,
  onChange,
}: {
  draft: DraftQuestion
  selected: boolean
  duplicate: boolean
  onToggle: () => void
  onChange: (patch: Partial<DraftQuestion>) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div
      className={`rounded-xl border p-3 ${
        duplicate
          ? 'border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20'
          : draft.uncertain
            ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20'
            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-2 h-4 w-4 shrink-0" />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <Select
                value={draft.questionType}
                onChange={(e) => onChange({ questionType: e.target.value as QuestionType })}
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TYPE_BADGE[draft.questionType]}`}
            >
              {draft.reason}
            </span>
            <div className="flex items-center gap-1">
              <div className="w-16">
                <Input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={draft.marks}
                  onChange={(e) => onChange({ marks: e.target.value })}
                />
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500">marks</span>
            </div>
            <div className="w-28">
              <Input
                value={draft.chapter}
                onChange={(e) => onChange({ chapter: e.target.value })}
                placeholder="Chapter"
              />
            </div>
            <div className="w-28">
              <Select
                value={draft.difficulty}
                onChange={(e) => onChange({ difficulty: e.target.value as DraftQuestion['difficulty'] })}
              >
                <option value="">Difficulty</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </div>
            {duplicate && (
              <span className="text-xs font-medium text-red-700 dark:text-red-400">Already in the bank</span>
            )}
          </div>

          <Textarea
            ref={textRef}
            rows={draft.text.includes('\n') ? 3 : 2}
            value={draft.text}
            onChange={(e) => onChange({ text: e.target.value })}
          />
          {/* Recognition and copy-paste both mangle maths symbols, so the pad
              belongs where the corrections actually get made. */}
          <SymbolPad targetRef={textRef} value={draft.text} onChange={(text) => onChange({ text })} />

          {draft.questionType === 'mcq' && (
            <McqOptionsEditor options={draft.options} onChange={(options) => onChange({ options })} />
          )}
        </div>
      </div>
    </div>
  )
}
