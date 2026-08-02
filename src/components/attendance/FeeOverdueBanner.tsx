import { TriangleAlertIcon } from './icons'

export interface FeeOverdueBannerProps {
  guardianName: string | null
  guardianPhone: string | null
}

// Deliberately amount-free. The desk needs to know an account is behind so it
// can point the student at the office; it does not need — and should not show
// a queue of waiting students — what anyone owes. The figures stay in the fees
// pages, where they belong.
export function FeeOverdueBanner({ guardianName, guardianPhone }: FeeOverdueBannerProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-3 py-3 dark:border-red-900/60 dark:bg-red-950/40 sm:px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300">
        <TriangleAlertIcon size={18} />
      </span>

      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">Fee overdue</p>
        <p className="mt-0.5 truncate text-xs text-red-700/90 dark:text-red-300/90">
          {guardianName || guardianPhone ? (
            <>
              Guardian: {guardianName || '—'}
              {guardianPhone && (
                <>
                  {' · '}
                  <a href={`tel:${guardianPhone}`} className="underline underline-offset-2 hover:no-underline">
                    {guardianPhone}
                  </a>
                </>
              )}
            </>
          ) : (
            'Please refer this student to the office.'
          )}
        </p>
      </div>
    </div>
  )
}
