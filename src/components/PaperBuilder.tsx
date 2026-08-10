import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Input'
import { parseQuestionText, sectionMarks, type PaperSection } from '@/lib/examPaper'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, typesForPart } from '@/lib/questionTypes'
import type { ExamPart, ExamQuestion, ExamSection, Question } from '@/types/database'

interface SectionForm {
  id: string | null
  part: ExamPart
  title: string
  instruction: string
  chooseCount: string
}

const BLANK_SECTION: SectionForm = {
  id: null,
  part: 'subjective',
  title: '',
  instruction: '',
  chooseCount: '',
}

// Builds the structure of a paper: an objective and a subjective part, each
// holding sections, each section optionally offering a choice. The preview
// beside it re-renders from the same rows, so what the teacher arranges here
// is literally what prints.
export function PaperBuilder({
  examId,
  bank,
  sections,
  examQuestions,
  onReload,
}: {
  examId: string
  /** Every question in the bank for this exam's subject. */
  bank: Question[]
  sections: ExamSection[]
  examQuestions: ExamQuestion[]
  onReload: () => void
}) {
  const { show } = useToast()
  const [form, setForm] = useState<SectionForm | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExamSection | null>(null)
  const [pickerSection, setPickerSection] = useState<ExamSection | 'unassigned' | null>(null)
  const [busy, setBusy] = useState(false)

  const bankById = useMemo(() => new Map(bank.map((q) => [q.id, q])), [bank])
  const onPaper = useMemo(() => new Set(examQuestions.map((eq) => eq.question_id)), [examQuestions])

  const rowsBySection = useMemo(() => {
    const map = new Map<string | null, ExamQuestion[]>()
    for (const row of examQuestions) {
      const list = map.get(row.section_id) ?? []
      list.push(row)
      map.set(row.section_id, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [examQuestions])

  // Papers built before sections existed, plus anything orphaned by deleting a
  // section, land here rather than silently vanishing off the paper.
  const unassigned = rowsBySection.get(null) ?? []

  async function saveSection() {
    if (!form) return
    if (!form.title.trim()) {
      show('The section needs a title.', 'error')
      return
    }
    const chooseCount = form.chooseCount.trim() === '' ? null : Number(form.chooseCount)
    if (chooseCount !== null && (Number.isNaN(chooseCount) || chooseCount <= 0)) {
      show('"Attempt any" must be a positive number, or left blank.', 'error')
      return
    }

    setBusy(true)
    const payload = {
      exam_id: examId,
      part: form.part,
      title: form.title.trim(),
      instruction: form.instruction.trim() || null,
      choose_count: chooseCount,
    }
    const { error } = form.id
      ? await supabase.from('exam_sections').update(payload).eq('id', form.id)
      : await supabase.from('exam_sections').insert({ ...payload, position: sections.length })
    setBusy(false)

    if (error) {
      show(error.message, 'error')
      return
    }
    setForm(null)
    onReload()
  }

  async function deleteSection() {
    if (!deleteTarget) return
    const { error } = await supabase.from('exam_sections').delete().eq('id', deleteTarget.id)
    if (error) show(error.message, 'error')
    else show('Section deleted. Its questions moved to Unassigned.')
    setDeleteTarget(null)
    onReload()
  }

  async function addToSection(sectionId: string | null, questionIds: string[]) {
    const existing = rowsBySection.get(sectionId) ?? []
    let position = existing.length
    const rows = questionIds.map((id) => ({
      exam_id: examId,
      question_id: id,
      section_id: sectionId,
      position: position++,
      part_indexes: null,
    }))
    const { error } = await supabase.from('exam_questions').insert(rows)
    if (error) show(error.message, 'error')
    onReload()
  }

  async function removeFromPaper(questionId: string) {
    const { error } = await supabase
      .from('exam_questions')
      .delete()
      .eq('exam_id', examId)
      .eq('question_id', questionId)
    if (error) show(error.message, 'error')
    onReload()
  }

  async function patchRow(questionId: string, patch: Partial<ExamQuestion>) {
    const { error } = await supabase
      .from('exam_questions')
      .update(patch)
      .eq('exam_id', examId)
      .eq('question_id', questionId)
    if (error) show(error.message, 'error')
    onReload()
  }

  // Swaps positions with the neighbour rather than renumbering the section,
  // so a move is two writes regardless of how long the section is.
  async function move(sectionId: string | null, index: number, delta: number) {
    const rows = rowsBySection.get(sectionId) ?? []
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const a = rows[index]
    const b = rows[target]
    await Promise.all([
      supabase
        .from('exam_questions')
        .update({ position: b.position })
        .eq('exam_id', examId)
        .eq('question_id', a.question_id),
      supabase
        .from('exam_questions')
        .update({ position: a.position })
        .eq('exam_id', examId)
        .eq('question_id', b.question_id),
    ])
    onReload()
  }

  function sectionPreview(section: ExamSection): PaperSection {
    return {
      title: section.title,
      instruction: section.instruction,
      chooseCount: section.choose_count,
      questions: (rowsBySection.get(section.id) ?? []).flatMap((row) => {
        const question = bankById.get(row.question_id)
        return question ? [{ ...question, marks: question.marks, partIndexes: row.part_indexes }] : []
      }),
    }
  }

  const parts: ExamPart[] = ['objective', 'subjective']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Paper structure</p>
        <Button variant="secondary" onClick={() => setForm({ ...BLANK_SECTION })}>
          + Add section
        </Button>
      </div>

      {sections.length === 0 && unassigned.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500">
          No sections yet. Add one — for example “SECTION A” for the objective part.
        </p>
      )}

      {parts.map((part) => {
        const partSections = sections.filter((s) => s.part === part).sort((a, b) => a.position - b.position)
        if (partSections.length === 0) return null
        return (
          <div key={part} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-gold-400">
              {part === 'objective' ? 'Objective part' : 'Subjective part'}
            </p>
            {partSections.map((section) => {
              const rows = rowsBySection.get(section.id) ?? []
              const marks = sectionMarks(sectionPreview(section))
              return (
                <div
                  key={section.id}
                  className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-700/60">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{section.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {section.choose_count
                          ? `Attempt any ${section.choose_count} of ${rows.length}`
                          : `Attempt all ${rows.length}`}
                        {' · '}
                        {marks} marks count
                        {section.instruction ? ` · “${section.instruction}”` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button
                        onClick={() =>
                          setForm({
                            id: section.id,
                            part: section.part,
                            title: section.title,
                            instruction: section.instruction ?? '',
                            chooseCount: section.choose_count ? String(section.choose_count) : '',
                          })
                        }
                        className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(section)}
                        className="text-sm text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {rows.map((row, i) => {
                      const question = bankById.get(row.question_id)
                      if (!question) return null
                      return (
                        <PaperQuestionRow
                          key={row.question_id}
                          question={question}
                          row={row}
                          canMoveUp={i > 0}
                          canMoveDown={i < rows.length - 1}
                          onMove={(delta) => move(section.id, i, delta)}
                          onRemove={() => removeFromPaper(row.question_id)}
                          onPartsChange={(partIndexes) => patchRow(row.question_id, { part_indexes: partIndexes })}
                        />
                      )
                    })}
                  </ul>

                  <div className="px-4 py-2">
                    <button
                      onClick={() => setPickerSection(section)}
                      className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                    >
                      + Add questions from bank
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {unassigned.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-800/60 dark:bg-amber-950/20">
          <div className="border-b border-amber-200 px-4 py-2.5 dark:border-amber-800/60">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Not in any section</p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
              These print at the end of the paper. Move them into a section to control where they appear.
            </p>
          </div>
          <ul className="divide-y divide-amber-200/70 dark:divide-amber-800/40">
            {unassigned.map((row, i) => {
              const question = bankById.get(row.question_id)
              if (!question) return null
              return (
                <PaperQuestionRow
                  key={row.question_id}
                  question={question}
                  row={row}
                  canMoveUp={i > 0}
                  canMoveDown={i < unassigned.length - 1}
                  sections={sections}
                  onAssign={(sectionId) => patchRow(row.question_id, { section_id: sectionId })}
                  onMove={(delta) => move(null, i, delta)}
                  onRemove={() => removeFromPaper(row.question_id)}
                  onPartsChange={(partIndexes) => patchRow(row.question_id, { part_indexes: partIndexes })}
                />
              )
            })}
          </ul>
        </div>
      )}

      {form && (
        <Modal title={form.id ? 'Edit section' : 'New section'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Field label="Part">
              <Select value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value as ExamPart })}>
                <option value="objective">Objective (MCQs)</option>
                <option value="subjective">Subjective (written)</option>
              </Select>
            </Field>
            <Field label="Title">
              <Input
                value={form.title}
                placeholder="SECTION A"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Instruction (optional)">
              <Input
                value={form.instruction}
                placeholder="Attempt any SIX questions."
                onChange={(e) => setForm({ ...form, instruction: e.target.value })}
              />
            </Field>
            <Field label="Attempt any — how many? (blank = all)">
              <Input
                type="number"
                min="1"
                value={form.chooseCount}
                placeholder="6"
                onChange={(e) => setForm({ ...form, chooseCount: e.target.value })}
              />
            </Field>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              With a choice set, only that many questions count towards the paper total.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button onClick={saveSection} disabled={busy}>
                {busy ? 'Saving...' : 'Save section'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {pickerSection && (
        <QuestionPicker
          bank={bank.filter((q) => !onPaper.has(q.id))}
          part={pickerSection === 'unassigned' ? undefined : pickerSection.part}
          onClose={() => setPickerSection(null)}
          onAdd={async (ids) => {
            await addToSection(pickerSection === 'unassigned' ? null : pickerSection.id, ids)
            setPickerSection(null)
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete section"
          message={`Delete “${deleteTarget.title}”? Its questions stay on the paper but move to Unassigned.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={deleteSection}
        />
      )}
    </div>
  )
}

function PaperQuestionRow({
  question,
  row,
  canMoveUp,
  canMoveDown,
  sections,
  onAssign,
  onMove,
  onRemove,
  onPartsChange,
}: {
  question: Question
  row: ExamQuestion
  canMoveUp: boolean
  canMoveDown: boolean
  sections?: ExamSection[]
  onAssign?: (sectionId: string) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onPartsChange: (partIndexes: number[] | null) => void
}) {
  const { stem, parts } = parseQuestionText(question.question_text)
  const selected = row.part_indexes
  const isSelected = (i: number) => !selected || selected.includes(i)

  // Toggling down to nothing would print a bare stem with no work to do, so
  // the last remaining part cannot be switched off.
  function togglePart(i: number) {
    const current = selected ?? parts.map((_, index) => index)
    const next = current.includes(i) ? current.filter((x) => x !== i) : [...current, i].sort((a, b) => a - b)
    if (next.length === 0) return
    onPartsChange(next.length === parts.length ? null : next)
  }

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col">
          <button
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            aria-label="Move up"
            className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
          >
            ▲
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            aria-label="Move down"
            className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
          >
            ▼
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-800 dark:text-slate-100">{stem}</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            {QUESTION_TYPE_LABELS[question.question_type]} · {question.marks} marks
            {question.chapter ? ` · ${question.chapter}` : ''}
          </p>

          {/* One bank question, several parts — the teacher picks which of them
              this particular paper asks for. */}
          {parts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 dark:text-slate-500">Parts:</span>
              {parts.map((part, i) => (
                <button
                  key={i}
                  onClick={() => togglePart(i)}
                  title={part.text}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                    isSelected(i)
                      ? 'bg-brand-50 text-brand-700 ring-brand-600/30 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'bg-slate-100 text-slate-400 ring-slate-400/20 line-through dark:bg-slate-700 dark:text-slate-500'
                  }`}
                >
                  {part.marker}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {sections && onAssign && sections.length > 0 && (
            <div className="w-36">
              <Select value="" onChange={(e) => e.target.value && onAssign(e.target.value)}>
                <option value="">Move to…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <button onClick={onRemove} className="text-sm text-red-600 hover:underline dark:text-red-400">
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

function QuestionPicker({
  bank,
  part,
  onClose,
  onAdd,
}: {
  bank: Question[]
  /** Which half of the paper this section sits in. Undefined for Unassigned. */
  part?: ExamPart
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  // A section knows which half of the paper it is in, so the bank is narrowed
  // to the types that belong there rather than leaving a teacher to notice
  // that the short question they just ticked has landed among the MCQs.
  const allowedTypes = part ? typesForPart(part) : QUESTION_TYPES
  const inPart = bank.filter((q) => allowedTypes.includes(q.question_type))
  const hiddenByPart = bank.length - inPart.length

  const filtered = inPart.filter(
    (q) =>
      (typeFilter === 'all' || q.question_type === typeFilter) &&
      (search.trim() === '' ||
        q.question_text.toLowerCase().includes(search.toLowerCase()) ||
        (q.chapter ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <Modal title="Add questions to this section" size="wide" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={search} placeholder="Search question or chapter" onChange={(e) => setSearch(e.target.value)} />
          <div className="w-40 shrink-0">
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">{part === 'objective' ? 'All objective' : part ? 'All written' : 'All types'}</option>
              {allowedTypes.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {part && hiddenByPart > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {part === 'objective'
              ? `Showing MCQs, true/false and fill-in-the-blanks only — ${hiddenByPart} written question${hiddenByPart === 1 ? '' : 's'} hidden, because this section is in the objective part.`
              : `Showing written questions only — ${hiddenByPart} objective question${hiddenByPart === 1 ? '' : 's'} hidden, because this section is in the subjective part.`}
          </p>
        )}

        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-600 dark:text-slate-500">
            {part === 'objective' && hiddenByPart > 0 && inPart.length === 0
              ? 'No MCQs in the bank for this subject yet. Import or add some, then come back.'
              : 'Nothing left in the bank matches. Every matching question may already be on the paper.'}
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {filtered.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                  <input
                    type="checkbox"
                    checked={picked.has(q.id)}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev)
                        if (next.has(q.id)) next.delete(q.id)
                        else next.add(q.id)
                        return next
                      })
                    }
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block whitespace-pre-line text-sm text-slate-800 dark:text-slate-100">
                      {q.question_text}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                      {QUESTION_TYPE_LABELS[q.question_type]} · {q.marks} marks
                      {q.chapter ? ` · ${q.chapter}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.size === 0} onClick={() => onAdd([...picked])}>
            Add {picked.size > 0 ? picked.size : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
