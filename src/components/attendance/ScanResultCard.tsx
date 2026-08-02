import type { ReactNode } from 'react'
import { StudentAvatar } from './StudentAvatar'
import { CheckIcon, ClockIcon, IdCardIcon, RotateCcwIcon, UserIcon } from './icons'

export interface ScanResultCardProps {
  name: string
  className: string | null
  barcode: string
  signedInAt: string
  /** True when today's attendance already existed — this scan changed nothing. */
  alreadyMarked: boolean
}

const tone = {
  fresh: {
    shell: 'border-green-500/60 bg-green-50 dark:border-green-600/50 dark:bg-green-950/30',
    badge: 'bg-green-600 ring-green-50 dark:bg-green-600 dark:ring-green-950',
    status: 'text-green-700 dark:text-green-300',
    label: 'Signed in',
  },
  repeat: {
    shell: 'border-amber-400/70 bg-amber-50 dark:border-amber-600/50 dark:bg-amber-950/30',
    badge: 'bg-amber-500 ring-amber-50 dark:bg-amber-600 dark:ring-amber-950',
    status: 'text-amber-700 dark:text-amber-300',
    label: 'Already in',
  },
} as const

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
export function ScanResultCard({ name, className, barcode, signedInAt, alreadyMarked }: ScanResultCardProps) {
  const t = alreadyMarked ? tone.repeat : tone.fresh
  const time = new Date(signedInAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })

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
            {alreadyMarked ? <RotateCcwIcon size={13} strokeWidth={2.5} /> : <CheckIcon size={14} strokeWidth={3} />}
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
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className={`text-lg font-bold leading-tight sm:text-2xl ${t.status}`}>{t.label}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            <ClockIcon size={13} />
            {time}
          </p>
        </div>
      </div>

      {alreadyMarked && (
        <p className="border-t border-amber-400/40 bg-amber-100/50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200 sm:px-6">
          Today&apos;s attendance was already recorded — this scan did not change it.
        </p>
      )}
    </section>
  )
}
