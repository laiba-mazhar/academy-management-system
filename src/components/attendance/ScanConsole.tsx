import type { FormEvent, RefObject } from 'react'
import { CameraIcon, ScanLineIcon } from './icons'

export interface ScanConsoleProps {
  code: string
  onCodeChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  busy: boolean
  /** Hidden while the camera panel is open — that panel carries its own Stop control. */
  cameraOn: boolean
  onOpenCamera: () => void
  inputRef: RefObject<HTMLInputElement>
}

// The primary control on the page. Everything else here is a reaction to what
// happens in this one field, so it gets the strongest border, the largest type
// and the only filled button.
export function ScanConsole({
  code,
  onCodeChange,
  onSubmit,
  busy,
  cameraOn,
  onOpenCamera,
  inputRef,
}: ScanConsoleProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-gold-400/30 bg-white p-4 shadow-md shadow-brand-900/5 dark:border-gold-500/20 dark:bg-slate-800 dark:shadow-black/20 sm:p-5"
    >
      <label htmlFor="scan" className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <ScanLineIcon size={16} className="text-brand-600 dark:text-brand-300" />
        Scan student card
      </label>

      <div className="flex items-center gap-1 rounded-xl border-2 border-slate-200 bg-white p-1 transition-colors focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10 dark:border-slate-600 dark:bg-slate-900 dark:focus-within:border-brand-400">
        <input
          id="scan"
          ref={inputRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          autoComplete="off"
          autoFocus
          placeholder="Scan or type card number"
          className="h-12 min-w-0 flex-1 bg-transparent px-3 font-mono text-lg tracking-widest text-slate-900 placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none dark:text-cream-50 dark:placeholder:text-slate-500 sm:text-xl"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="h-12 shrink-0 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-cream-50 transition-colors hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand-600 dark:hover:bg-brand-500 dark:focus-visible:ring-offset-slate-900 sm:px-6"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No scanner? Type a card number (e.g. MKT000001) and press Enter.
        </p>
        {!cameraOn && (
          <button
            type="button"
            onClick={onOpenCamera}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <CameraIcon size={14} />
            Use camera
          </button>
        )}
      </div>
    </form>
  )
}
