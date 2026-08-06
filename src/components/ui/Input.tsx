import { forwardRef } from 'react'
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

// Ref-forwarding so callers can reach the DOM node — the symbol pad needs the
// live caret position to insert at, not just the value.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  props,
  ref
) {
  return (
    <input
      {...props}
      ref={ref}
      className={`w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${props.className ?? ''}`}
    />
  )
})

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${props.className ?? ''}`}
    />
  )
}

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={`w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${props.className ?? ''}`}
      />
    )
  }
)

export function LabelText(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`text-sm font-medium text-slate-700 dark:text-slate-200 ${props.className ?? ''}`} />
}
