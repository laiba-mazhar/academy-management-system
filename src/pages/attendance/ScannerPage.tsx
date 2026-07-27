import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, todayLocalDate } from '@/lib/utils'

// Shape returned by the scan_student_attendance() RPC.
interface ScanResult {
  ok: boolean
  error?: string
  message?: string
  barcode?: string
  student_name?: string
  student?: {
    id: string
    full_name: string
    barcode: string
    class_name: string | null
    guardian_name: string | null
    guardian_phone: string | null
  }
  attendance?: {
    date: string
    status: string
    signed_in_at: string
    already_marked: boolean
  }
  fee?: {
    overdue: boolean
    overdue_amount: number
    overdue_months: string[]
    due_now_amount: number
    admission_fee_due: number
    security_fee_due: number
  }
}

interface HistoryEntry {
  key: number
  name: string
  className: string | null
  time: string
  overdue: boolean
  repeat: boolean
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function CheckIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function ScannerPage() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [clock, setClock] = useState(() => new Date())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // A keyboard-wedge scanner types into whatever holds focus, so the input has
  // to keep it — including after a stray click elsewhere on the screen.
  useEffect(() => {
    function refocus() {
      inputRef.current?.focus()
    }
    refocus()
    window.addEventListener('click', refocus)
    return () => window.removeEventListener('click', refocus)
  }, [])

  async function handleScan(e: FormEvent) {
    e.preventDefault()
    const value = code.trim()
    if (!value || busy) return

    setBusy(true)
    setErrorText(null)
    const { data, error } = await supabase.rpc('scan_student_attendance', {
      p_barcode: value,
      p_local_date: todayLocalDate(),
    })
    setBusy(false)
    setCode('')
    inputRef.current?.focus()

    if (error) {
      setResult(null)
      setErrorText(error.message)
      return
    }

    const scan = data as ScanResult
    setResult(scan)
    if (scan.ok && scan.student && scan.attendance) {
      setHistory((prev) =>
        [
          {
            key: Date.now(),
            name: scan.student!.full_name,
            className: scan.student!.class_name,
            time: formatTime(scan.attendance!.signed_in_at),
            overdue: !!scan.fee?.overdue,
            repeat: scan.attendance!.already_marked,
          },
          ...prev,
        ].slice(0, 8)
      )
    }
  }

  const student = result?.ok ? result.student : undefined
  const attendance = result?.ok ? result.attendance : undefined
  const fee = result?.ok ? result.fee : undefined
  const otherDues = (fee?.admission_fee_due ?? 0) + (fee?.security_fee_due ?? 0) + (fee?.due_now_amount ?? 0)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
      <form onSubmit={handleScan} className="rounded-2xl border border-gold-400/30 bg-white p-5 shadow-sm dark:border-gold-500/20 dark:bg-slate-800">
        <label htmlFor="scan" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
          Scan student card
        </label>
        <div className="flex gap-2">
          <input
            id="scan"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoFocus
            placeholder="Scan the barcode, or type the card number and press Enter"
            className="w-full rounded-lg border border-slate-300 px-4 py-3 font-mono text-lg tracking-widest focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="shrink-0 rounded-lg border border-gold-500/50 bg-brand-700 px-5 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
          >
            {busy ? 'Checking...' : 'Sign in'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          No scanner yet? Type a card number (e.g. MKT000001) and press Enter — it works exactly the same.
        </p>
      </form>

      {errorText && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-5 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-semibold">Could not record this scan</p>
          <p className="mt-1 text-sm">{errorText}</p>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertIcon />
            <div>
              <p className="text-lg font-semibold">Not signed in</p>
              <p className="mt-1 text-sm">{result.message}</p>
            </div>
          </div>
        </div>
      )}

      {student && attendance && (
        <div className="space-y-4">
          {/* Fee status sits above the sign-in confirmation on purpose — the
              desk needs to see an overdue account before the student walks off. */}
          {fee?.overdue && (
            <div className="rounded-2xl border-2 border-red-500 bg-red-600 p-5 text-white shadow-lg">
              <div className="flex items-start gap-3">
                <AlertIcon />
                <div className="min-w-0">
                  <p className="text-xl font-bold uppercase tracking-wide">Fee overdue</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(fee.overdue_amount)} outstanding</p>
                  {fee.overdue_months.length > 0 && (
                    <p className="mt-1 text-sm text-red-50">
                      Unpaid for: {fee.overdue_months.join(', ')}
                    </p>
                  )}
                  {otherDues > 0 && (
                    <p className="mt-1 text-sm text-red-50">
                      Also pending (not yet overdue): {formatCurrency(otherDues)}
                    </p>
                  )}
                  {student.guardian_phone && (
                    <p className="mt-1 text-sm text-red-50">
                      Guardian: {student.guardian_name || '—'} · {student.guardian_phone}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className={`rounded-2xl border-2 p-6 shadow-sm ${
              attendance.already_marked
                ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30'
                : 'border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-950/30'
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={
                  attendance.already_marked
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-600 dark:text-green-400'
                }
              >
                <CheckIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-2xl font-bold text-slate-900 dark:text-slate-50">{student.full_name}</p>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                  {student.class_name ?? 'Unassigned'} · Card {student.barcode}
                </p>
                <p
                  className={`mt-3 text-lg font-semibold ${
                    attendance.already_marked
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-green-700 dark:text-green-300'
                  }`}
                >
                  {attendance.already_marked ? 'Already signed in at ' : 'Signed in at '}
                  {formatTime(attendance.signed_in_at)}
                </p>
                {attendance.already_marked && (
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    Today&apos;s attendance was already recorded — this scan did not change it.
                  </p>
                )}
              </div>
            </div>

            {!fee?.overdue && otherDues > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-100/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-semibold">Fees pending (not yet overdue): </span>
                {formatCurrency(otherDues)}
                {fee && fee.admission_fee_due > 0 && <span> · admission {formatCurrency(fee.admission_fee_due)}</span>}
                {fee && fee.security_fee_due > 0 && <span> · security {formatCurrency(fee.security_fee_due)}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-700/60">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Recent sign-ins</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {clock.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
              {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {history.map((entry) => (
              <li key={entry.key} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">
                  {entry.name}
                  <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                    {entry.className ?? '—'}
                  </span>
                </span>
                {entry.overdue && (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    Fee overdue
                  </span>
                )}
                {entry.repeat && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    repeat
                  </span>
                )}
                <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{entry.time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
