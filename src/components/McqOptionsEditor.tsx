import { Input } from '@/components/ui/Input'
import type { QuestionOption } from '@/types/database'

// The A/B/C/D editor for an MCQ, shared by the question bank form, the paper
// builder's inline form and the import review grid — all three need the same
// behaviour, and an MCQ that loses its options prints as an unanswerable stem.
export function McqOptionsEditor({
  options,
  onChange,
}: {
  options: QuestionOption[]
  onChange: (options: QuestionOption[]) => void
}) {
  // Keys are always relabelled A, B, C… after an edit, so removing the middle
  // option cannot leave a paper printing "(a) … (c) …".
  function relabel(next: QuestionOption[]): QuestionOption[] {
    return next.map((option, i) => ({ ...option, key: String.fromCharCode(65 + i) }))
  }

  return (
    <div className="space-y-1">
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
            {option.key}
          </span>
          <div className="flex-1">
            <Input
              value={option.text}
              placeholder={`Option ${option.key}`}
              onChange={(e) => onChange(options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)))}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(relabel(options.filter((_, j) => j !== i)))}
            className="shrink-0 text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange(relabel([...options, { key: '', text: '' }]))}
        className="text-xs text-brand-600 hover:underline dark:text-gold-400"
      >
        + Add option
      </button>
      {options.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No options yet — an MCQ needs its choices to print.
        </p>
      )}
    </div>
  )
}
