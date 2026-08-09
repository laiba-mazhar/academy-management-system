import { useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { extractPdfText, ScannedPdfError } from '@/lib/pdfText'
import { ocrPdf, OcrGibberishError, OCR_LANGUAGES, type OcrLanguage, type OcrProgress } from '@/lib/pdfOcr'
import { dedupeKey, looksLikeGibberish, parseQuestions, type DraftQuestion } from '@/lib/questionParser'
import {
  countPdfPages,
  parsePageRange,
  readQuestionsWithAi,
  type AiReadProgress,
} from '@/lib/aiQuestions'
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

type Step = 'source' | 'verify' | 'review'
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
  const [exercisesOnly, setExercisesOnly] = useState(false)
  const [bulkChapter, setBulkChapter] = useState('')
  const [bulkMarks, setBulkMarks] = useState('')
  // Held so the "read it anyway" button can retry the same file with OCR
  // without asking the teacher to pick it again.
  const [scannedFile, setScannedFile] = useState<File | null>(null)
  const [ocr, setOcr] = useState<OcrProgress | null>(null)
  const [ocrLanguage, setOcrLanguage] = useState<OcrLanguage>('eng')
  const [recognised, setRecognised] = useState('')
  // Any chosen PDF is kept, whether or not the parser managed to read it, so
  // the AI reader can be pointed at the same file without picking it again.
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageRange, setPageRange] = useState('')
  const [aiExercisesOnly, setAiExercisesOnly] = useState(false)
  const [aiProgress, setAiProgress] = useState<AiReadProgress | null>(null)
  const [readByAi, setReadByAi] = useState(false)
  const [aiNote, setAiNote] = useState<string | null>(null)
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
      setError(
        result.exercisesOnly
          ? 'The exercises in that document turned out to be empty. Check the pages you imported actually contain the exercise questions.'
          : 'No questions were recognised in that text. Check it looks like a question paper, or add questions manually.'
      )
      return
    }
    // Anything the parser guessed at goes to the top, so a teacher checks six
    // doubtful rows instead of re-reading all forty.
    const ordered = [...result.drafts].sort((a, b) => Number(b.uncertain) - Number(a.uncertain))
    setDrafts(ordered.map((d) => ({ ...d, chapter: d.chapter || '' })))
    setSelected(new Set())
    setSectionsFound(result.sectionsFound)
    setExercisesOnly(result.exercisesOnly)
    setFileName(source)
    setReadByAi(false)
    setAiNote(null)
    setError(null)
    setStep('review')
  }

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    setScannedFile(null)
    setPdfFile(file)
    setPageRange('')
    try {
      setPageCount(await countPdfPages(file))
    } catch {
      // Not fatal — only the page-range hint needs it.
      setPageCount(0)
    }
    try {
      const text = await extractPdfText(file)
      runParse(text, file.name)
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        // Not a dead end any more — offer to read it instead.
        setScannedFile(file)
        setError(null)
      } else {
        setError(`Could not read that PDF. ${err instanceof Error ? err.message : ''}`.trim())
      }
    } finally {
      setBusy(false)
    }
  }

  // The reader that does not care what language the paper is in. It looks at
  // pictures of the pages, so a scan and an Urdu paper are no harder than an
  // English one — but it costs a call per couple of pages, which is why the
  // parser stays the default for a paper it can already read.
  async function handleAiRead() {
    if (!pdfFile) return
    const range = parsePageRange(pageRange, pageCount || 9999)
    if (!range) {
      setError(
        pageCount > 0
          ? `Enter a page or a range within 1–${pageCount}, like “1-8”.`
          : 'Enter a page or a range, like “1-8”.'
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await readQuestionsWithAi(
        pdfFile,
        range,
        { exercisesOnly: aiExercisesOnly },
        setAiProgress
      )
      if (result.drafts.length === 0) {
        setError(
          aiExercisesOnly
            ? 'No exercise questions were found on those pages. Try a different page range, or untick “exercises only”.'
            : 'No questions were found on those pages. Check the page range covers the questions.'
        )
        return
      }
      setDrafts(result.drafts)
      setSelected(new Set())
      setSectionsFound(false)
      setExercisesOnly(aiExercisesOnly)
      setFileName(pdfFile.name)
      setReadByAi(true)
      setAiNote(result.stoppedEarly)
      setScannedFile(null)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file with AI.')
    } finally {
      setAiProgress(null)
      setBusy(false)
    }
  }

  async function handleOcr() {
    if (!scannedFile) return
    setBusy(true)
    setError(null)
    try {
      const text = await ocrPdf(scannedFile, ocrLanguage, setOcr)
      if (text.trim().length < 20) {
        setError('Text recognition found almost nothing. The scan may be too faint or too skewed — try a clearer copy.')
        return
      }
      // Recognition is unreliable enough that a human should see what it read
      // before any of it becomes questions. Being shown 27 rows of wreckage
      // and having to delete them is the failure this prevents.
      setRecognised(text)
      setStep('verify')
    } catch (err) {
      // Kept on the scan panel rather than replacing it, so the language can be
      // changed and the same file retried without picking it again.
      setError(
        err instanceof OcrGibberishError
          ? err.message
          : `Text recognition failed. ${err instanceof Error ? err.message : ''}`.trim()
      )
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
      title={
        step === 'source'
          ? 'Import questions from a past paper'
          : step === 'verify'
            ? 'Check what was read'
            : `Review ${drafts.length} questions`
      }
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

          {pdfFile && (
            <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-3 dark:border-brand-900/60 dark:bg-brand-950/30">
              <p className="text-sm font-semibold text-brand-800 dark:text-cream-100">
                Read “{pdfFile.name}” with AI
              </p>
              <p className="mt-1 text-xs text-brand-900/80 dark:text-cream-200/80">
                Reads the pages as pictures, so a scan is no harder than a typed paper and the language does not
                matter — Urdu stays Urdu, Arabic stays Arabic, maths keeps its notation. Nothing is translated, and
                every question still comes to the review screen before it reaches the bank.
              </p>

              {aiProgress ? (
                <div className="mt-2">
                  <p className="text-xs text-brand-900 dark:text-cream-200">{aiProgress.note}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-200 dark:bg-brand-900/60">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all duration-200 dark:bg-gold-400"
                      style={{
                        width: `${Math.round(
                          (aiProgress.page / Math.max(aiProgress.totalPages, 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* A whole textbook would be hundreds of calls, so the range
                      is asked for rather than assumed. */}
                  <div className="w-28">
                    <Input
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      placeholder={pageCount > 0 ? `1-${pageCount}` : 'Pages'}
                      aria-label="Pages to read"
                    />
                  </div>
                  <span className="text-xs text-brand-900/70 dark:text-cream-200/70">
                    {pageCount > 0 ? `of ${pageCount} pages` : 'pages'}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-brand-900/80 dark:text-cream-200/80">
                    <input
                      type="checkbox"
                      checked={aiExercisesOnly}
                      onChange={(e) => setAiExercisesOnly(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    Textbook — exercises only
                  </label>
                  <Button onClick={handleAiRead} disabled={busy}>
                    Read with AI
                  </Button>
                </div>
              )}
            </div>
          )}

          {scannedFile && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                “{scannedFile.name}” is a scan
              </p>
              <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">
                There is no text in this PDF — it is a picture of a paper, so the questions have to be read off the
                page. Reading it with AI above handles any language. Offline recognition can try instead if you would
                rather not use AI: it runs entirely in this browser, but it is rough on Urdu and Arabic and will not
                read handwriting at all. Pick the language the paper is written in.
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* The wrong model over Arabic script returns confident
                      nonsense rather than an error, so the language is chosen
                      before recognition rather than guessed. */}
                  <div className="w-32">
                    <Select
                      value={ocrLanguage}
                      onChange={(e) => setOcrLanguage(e.target.value as OcrLanguage)}
                      aria-label="Language of the paper"
                    >
                      {OCR_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button variant="secondary" onClick={handleOcr} disabled={busy}>
                    Read it with offline recognition
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
      ) : step === 'verify' ? (
        <div className="space-y-3">
          {looksLikeGibberish(recognised) ? (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              This does not look like readable text. The page is probably in a different language than the one
              chosen, handwritten, or too faint to read. Try another language, or use the Paste text tab.
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              This is what was read from “{fileName || scannedFile?.name}”. If it looks right, carry on — otherwise
              try a different language rather than sorting out the questions afterwards.
            </p>
          )}

          <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {recognised}
          </pre>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRecognised('')
                setStep('source')
              }}
            >
              Back
            </Button>
            <div className="w-32">
              <Select
                value={ocrLanguage}
                onChange={(e) => setOcrLanguage(e.target.value as OcrLanguage)}
                aria-label="Language of the paper"
              >
                {OCR_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={handleOcr} disabled={busy || !scannedFile}>
              Read again in this language
            </Button>
            <Button
              onClick={() => {
                runParse(recognised, scannedFile?.name ?? 'Scanned PDF')
                setScannedFile(null)
              }}
            >
              Looks right — find questions
            </Button>
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
              {readByAi
                ? 'Read by AI — check the wording against the page'
                : sectionsFound
                  ? 'Types read from the paper’s own sections'
                  : 'No sections found — types were guessed'}
            </span>
            {exercisesOnly && (
              <span className="text-slate-500 dark:text-slate-400">
                Textbook — only the exercises were read, not the lesson text
              </span>
            )}
            {!readByAi && pdfFile && (
              <button
                onClick={() => setStep('source')}
                className="text-brand-600 hover:underline dark:text-gold-400"
              >
                Not right? Read it with AI instead
              </button>
            )}
          </div>

          {aiNote && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
              Reading stopped before the last page, so these are the questions from the pages that were read. {aiNote}
            </p>
          )}

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

          {/* dir="auto" lets the browser pick the direction from the text
              itself, so an Urdu question reads right-to-left in the box it is
              corrected in and an English one is unaffected. */}
          <Textarea
            ref={textRef}
            dir="auto"
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
