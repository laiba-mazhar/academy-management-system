import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { ChevronDownIcon, TriangleAlertIcon } from './icons'

export interface FeeOverdueBannerProps {
  overdueAmount: number
  overdueMonths: string[]
  /** Unpaid but not yet past due — admission, security and the current month. */
  otherDues: number
  admissionDue: number
  securityDue: number
  guardianName: string | null
  guardianPhone: string | null
}

// A compact strip rather than a full card. The desk has to notice an overdue
// account before the student walks off, but the sign-in confirmation above it
// is what the receptionist is actually looking for on every scan — so this
// states the headline in two rows and hides the breakdown behind a toggle.
export function FeeOverdueBanner({
  overdueAmount,
  overdueMonths,
  otherDues,
  admissionDue,
  securityDue,
  guardianName,
  guardianPhone,
}: FeeOverdueBannerProps) {
  const [open, setOpen] = useState(false)

  // One month is worth naming; a list of five is noise at a busy desk, so it
  // collapses to a count and the full list moves into the detail panel.
  const monthSummary =
    overdueMonths.length === 0
      ? null
      : overdueMonths.length === 1
        ? overdueMonths[0]
        : `${overdueMonths.length} unpaid months`

  return (
    <div className="overflow-hidden rounded-xl border border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40">
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300">
          <TriangleAlertIcon size={18} />
        </span>

        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">Fee overdue</p>
          <p className="mt-0.5 truncate text-xs text-red-700/90 dark:text-red-300/90">
            <span className="font-semibold tabular-nums">{formatCurrency(overdueAmount)}</span> outstanding
            {monthSummary && <span> · {monthSummary}</span>}
            {guardianName && <span> · Guardian: {guardianName}</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-red-300 bg-white/70 px-2.5 text-xs font-medium text-red-700 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/60"
        >
          <span className="hidden sm:inline">{open ? 'Hide' : 'View'} details</span>
          <span className="sm:hidden">{open ? 'Hide' : 'Details'}</span>
          <ChevronDownIcon size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <dl className="grid gap-x-6 gap-y-2 border-t border-red-200 px-3 py-3 text-xs sm:grid-cols-2 sm:px-4 dark:border-red-900/60">
          {overdueMonths.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-red-800/70 dark:text-red-300/70">Unpaid months</dt>
              <dd className="mt-0.5 text-red-900 dark:text-red-100">{overdueMonths.join(', ')}</dd>
            </div>
          )}
          {otherDues > 0 && (
            <div>
              <dt className="font-medium text-red-800/70 dark:text-red-300/70">Pending, not yet overdue</dt>
              <dd className="mt-0.5 tabular-nums text-red-900 dark:text-red-100">
                {formatCurrency(otherDues)}
                {admissionDue > 0 && <span className="text-red-800/70 dark:text-red-300/70"> · admission {formatCurrency(admissionDue)}</span>}
                {securityDue > 0 && <span className="text-red-800/70 dark:text-red-300/70"> · security {formatCurrency(securityDue)}</span>}
              </dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-red-800/70 dark:text-red-300/70">Guardian</dt>
            <dd className="mt-0.5 text-red-900 dark:text-red-100">
              {guardianName || '—'}
              {guardianPhone && (
                <>
                  {' · '}
                  <a href={`tel:${guardianPhone}`} className="underline underline-offset-2 hover:no-underline">
                    {guardianPhone}
                  </a>
                </>
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}
