import type { ReactNode } from 'react'
import type { AttendanceReviewReason, AttendanceStatus } from '@/types/database'
import { formatClockTime, formatMinutes } from '@/lib/utils'
import { StudentAvatar } from './StudentAvatar'
import { ClockIcon, FlagIcon, IdCardIcon, LogInIcon, LogOutIcon, RotateCcwIcon, UserIcon } from './icons'

/** Which direction the card just took the student. */
export type ScanAction = 'check_in' | 'check_out' | 'duplicate'

export interface ScanResultCardProps {
  name: string
  className: string | null
  barcode: string
  action: ScanAction
  status: AttendanceStatus
  checkInAt: string | null
  checkOutAt: string | null
  /** Minutes past the scheduled start. Null when there was no check-in to be late for. */
  lateMinutes: number | null
  /** Length of the sitting this scan just closed. Null on the way in. */
  sessionMinutes: number | null
  /** Total of every sitting today, so a return visit adds to it. */
  minutesPresent: number | null
  /** How many times the student has signed in today. 2+ means they came back. */
  entryCount: number
  reviewReason: AttendanceReviewReason | null
}

const tone = {
  check_in: {
    shell: 'border-green-500/60 bg-green-50 dark:border-green-600/50 dark:bg-green-950/30',
    badge: 'bg-green-600 ring-green-50 dark:bg-green-600 dark:ring-green-950',
    status: 'text-green-700 dark:text-green-300',
    label: 'Signed in',
    icon: <LogInIcon size={14} strokeWidth={2.5} />,
  },
  check_out: {
    shell: 'border-sky-500/60 bg-sky-50 dark:border-sky-600/50 dark:bg-sky-950/30',
    badge: 'bg-sky-600 ring-sky-50 dark:bg-sky-600 dark:ring-sky-950',
    status: 'text-sky-700 dark:text-sky-300',
    label: 'Signed out',
    icon: <LogOutIcon size={14} strokeWidth={2.5} />,
  },
  duplicate: {
    shell: 'border-amber-400/70 bg-amber-50 dark:border-amber-600/50 dark:bg-amber-950/30',
    badge: 'bg-amber-500 ring-amber-50 dark:bg-amber-600 dark:ring-amber-950',
    status: 'text-amber-700 dark:text-amber-300',
    label: 'Just scanned',
    icon: <RotateCcwIcon size={13} strokeWidth={2.5} />,
  },
} as const

// Plain-language rendering of the review flags the RPC sets. The receptionist
// is not the person who resolves these, so each one says what the office will
// need to sort out rather than naming the rule that fired.
const reviewNote: Record<AttendanceReviewReason, string> = {
  no_check_in:
    'No sign-in was recorded this morning — counted present from this scan, but the office will need to confirm the arrival time.',
  very_late: 'Arrived well after the class started. Flagged for the office.',
  short_stay: 'Signed out very soon after signing in. Flagged for the office.',
}

function MetaItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-slate-300">
      <span className="shrink-0 text-slate-400 dark:text-slate-500">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  )
}

// The confirmation the receptionist is looking for on every scan — deliberately
// the loudest thing on the page once a card goes through.
export function ScanResultCard({
  name,
  className,
  barcode,
  action,
  status,
  checkInAt,
  checkOutAt,
  lateMinutes,
  sessionMinutes,
  minutesPresent,
  entryCount,
  reviewReason,
}: ScanResultCardProps) {
  // A student who left and came back is a different thing from a first arrival,
  // and the desk should not have to work that out from the clock.
  const isReturn = action === 'check_in' && entryCount > 1
  const t = tone[action]
  const label = isReturn ? 'Signed back in' : t.label
  // Whichever end of the day this scan just wrote is the time to show big.
  const stamp = action === 'check_in' ? checkInAt : (checkOutAt ?? checkInAt)

  // One line of context under the headline time: on the way in, how late they
  // are; on the way out, how long they were actually here. Lateness is only
  // called out once the register actually says 'late' — a student inside the
  // grace period is on time, and telling the desk "5m late" would contradict
  // the row that was just written.
  let detail: string | null = null
  if (action === 'check_out' && checkInAt === null) {
    detail = 'No sign-in recorded'
  } else if (action === 'check_out' && sessionMinutes !== null) {
    // This sitting, plus the running total when there was more than one.
    detail =
      entryCount > 1 && minutesPresent !== null
        ? `${formatMinutes(sessionMinutes)} this visit · ${formatMinutes(minutesPresent)} today`
        : `${formatMinutes(sessionMinutes)} in the academy`
  } else if (isReturn) {
    detail = `Back in · visit ${entryCount} today`
  } else if (status === 'late' && lateMinutes !== null) {
    detail = `${formatMinutes(lateMinutes)} late`
  } else if (action === 'check_in') {
    detail = 'On time'
  }

  return (
    <section
      aria-live="polite"
      className={`overflow-hidden rounded-2xl border-2 shadow-sm motion-safe:animate-scan-in ${t.shell}`}
    >
      <div className="flex flex-wrap items-center gap-4 p-4 sm:gap-5 sm:p-6">
        <div className="relative shrink-0">
          <StudentAvatar name={name} size="lg" />
          <span
            className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2 ${t.badge}`}
          >
            {t.icon}
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-52">
          <h2 className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
            {name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
            <MetaItem icon={<UserIcon size={14} />}>{className ?? 'Unassigned'}</MetaItem>
            <MetaItem icon={<IdCardIcon size={14} />}>
              <span className="font-mono tracking-wide">{barcode}</span>
            </MetaItem>
          </div>
          {/* Both ends of the day, once both exist — the desk can answer "when
              did they get here?" without opening the register. */}
          {checkInAt && checkOutAt && (
            <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {entryCount > 1 ? 'First in' : 'In'} {formatClockTime(checkInAt)} ·{' '}
              {entryCount > 1 ? 'last out' : 'Out'} {formatClockTime(checkOutAt)}
            </p>
          )}
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className={`text-lg font-bold leading-tight sm:text-2xl ${t.status}`}>{label}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <ClockIcon size={13} />
            {formatClockTime(stamp)}
          </p>
          {detail && <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{detail}</p>}
        </div>
      </div>

      {action === 'duplicate' && (
        <p className="border-t border-amber-400/40 bg-amber-100/50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 sm:px-6">
          That card was read a moment ago — this scan was ignored so it did not sign them straight back out.
        </p>
      )}

      {action !== 'duplicate' && reviewReason && (
        <p className="flex items-start gap-2 border-t border-amber-400/40 bg-amber-100/50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 sm:px-6">
          <span className="mt-0.5 shrink-0">
            <FlagIcon size={13} />
          </span>
          {reviewNote[reviewReason]}
        </p>
      )}
    </section>
  )
}
