import type { RefObject } from 'react'

// The whole of the maths input story: a row of buttons that drop a character
// into the box at the cursor. No syntax to learn, nothing to memorise, and
// nothing to type wrong — a teacher writes the question the way they always
// have and clicks a symbol when they need one.
//
// Everything here is covered by the font embedded in the PDF writer, so what
// gets clicked is what prints, in both Print and Download.
const SYMBOLS = [
  ['½', 'one half'],
  ['¼', 'one quarter'],
  ['¾', 'three quarters'],
  ['²', 'squared'],
  ['³', 'cubed'],
  ['√', 'square root'],
  ['π', 'pi'],
  ['θ', 'theta'],
  ['°', 'degree'],
  ['×', 'multiply'],
  ['÷', 'divide'],
  ['±', 'plus or minus'],
  ['≤', 'less than or equal to'],
  ['≥', 'greater than or equal to'],
  ['≠', 'not equal to'],
  ['∞', 'infinity'],
  ['Δ', 'delta'],
  ['∑', 'sum'],
] as const

export function SymbolPad({
  targetRef,
  value,
  onChange,
}: {
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement>
  value: string
  onChange: (next: string) => void
}) {
  function insert(symbol: string) {
    const field = targetRef.current
    // Without a live cursor position — the field was never focused — appending
    // is the only sensible guess.
    if (!field) {
      onChange(value + symbol)
      return
    }
    const start = field.selectionStart ?? value.length
    const end = field.selectionEnd ?? value.length
    onChange(value.slice(0, start) + symbol + value.slice(end))

    // Put the caret after what was just inserted, so a teacher can click two
    // symbols in a row without reaching for the mouse in between.
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + symbol.length, start + symbol.length)
    })
  }

  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Insert a symbol">
      {SYMBOLS.map(([symbol, label]) => (
        <button
          key={symbol}
          type="button"
          onClick={() => insert(symbol)}
          title={label}
          aria-label={`Insert ${label}`}
          className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 transition-colors hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {symbol}
        </button>
      ))}
    </div>
  )
}
