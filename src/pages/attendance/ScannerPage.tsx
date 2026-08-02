import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { todayLocalDate } from '@/lib/utils'
import { DeskClock } from '@/components/attendance/DeskClock'
import { FeeOverdueBanner } from '@/components/attendance/FeeOverdueBanner'
import { RecentSignIns, type SignInEntry } from '@/components/attendance/RecentSignIns'
import { ScanConsole } from '@/components/attendance/ScanConsole'
import { ScanResultCard } from '@/components/attendance/ScanResultCard'
import { CircleAlertIcon, TriangleAlertIcon } from '@/components/attendance/icons'

// The barcode decoder is ~460 kB of the bundle and is only needed by whoever
// actually opens the camera — keeping it out of the main chunk means admins,
// teachers, and the far more common USB-scanner path never download it.
const BarcodeCamera = lazy(() =>
  import('@/components/BarcodeCamera').then((m) => ({ default: m.BarcodeCamera }))
)

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

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function ScannerPage() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<SignInEntry[]>([])
  const [cameraOn, setCameraOn] = useState(false)
  // Bumped once per scan and used as the result block's key, so each card
  // remounts: the confirmation animation replays and the fee banner's
  // expanded/collapsed state resets for the next student.
  const [scanSeq, setScanSeq] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Mirrors `busy` for the guard inside recordScan: the camera calls it from a
  // decode callback that closes over a stale render, so reading the state
  // variable there would let a second scan through mid-request.
  const busyRef = useRef(false)

  // A keyboard-wedge scanner types into whatever holds focus, so the input has
  // to keep it — including after a stray click elsewhere on the screen. Clicks
  // on a real control are left alone though: grabbing focus back from the
  // camera picker would close the dropdown as it opened.
  useEffect(() => {
    function refocus(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest('button, select, input, textarea, a, [role="button"]')) return
      inputRef.current?.focus()
    }
    inputRef.current?.focus()
    window.addEventListener('click', refocus)
    return () => window.removeEventListener('click', refocus)
  }, [])

  // The single path a card number takes, whatever produced it — typed by hand,
  // typed by a USB scanner in keyboard-wedge mode, or decoded from the webcam.
  // Everything downstream (the RPC, the register, the fee check) is identical.
  const recordScan = useCallback(async (raw: string) => {
    const value = raw.trim()
    if (!value || busyRef.current) return

    busyRef.current = true
    setBusy(true)
    setErrorText(null)
    const { data, error } = await supabase.rpc('scan_student_attendance', {
      p_barcode: value,
      p_local_date: todayLocalDate(),
    })
    busyRef.current = false
    setBusy(false)

    if (error) {
      setResult(null)
      setErrorText(error.message)
      return
    }

    const scan = data as ScanResult
    setResult(scan)
    setScanSeq((n) => n + 1)
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
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = code
    setCode('')
    inputRef.current?.focus()
    recordScan(value)
  }

  const student = result?.ok ? result.student : undefined
  const attendance = result?.ok ? result.attendance : undefined
  const fee = result?.ok ? result.fee : undefined
  const otherDues = (fee?.admission_fee_due ?? 0) + (fee?.security_fee_due ?? 0) + (fee?.due_now_amount ?? 0)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-cream-50 sm:text-3xl">
            Attendance Desk
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scan a student card to sign them in for today.
          </p>
        </div>
        <DeskClock />
      </header>

      <ScanConsole
        code={code}
        onCodeChange={setCode}
        onSubmit={handleSubmit}
        busy={busy}
        cameraOn={cameraOn}
        onOpenCamera={() => setCameraOn(true)}
        inputRef={inputRef}
      />

      {/* The camera is another way to produce a card number — it hands the same
          string to recordScan that the keyboard path does. */}
      {cameraOn && (
        <Suspense
          fallback={
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              Loading camera scanner…
            </p>
          }
        >
          <BarcodeCamera onDetected={recordScan} onStop={() => setCameraOn(false)} />
        </Suspense>
      )}

      {errorText && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-900/60 dark:bg-red-950/40">
          <span className="mt-0.5 shrink-0 text-red-600 dark:text-red-400">
            <CircleAlertIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">Could not record this scan</p>
            <p className="mt-0.5 break-words text-xs text-red-700/90 dark:text-red-300/90">{errorText}</p>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div
          key={scanSeq}
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 motion-safe:animate-scan-in dark:border-amber-700/60 dark:bg-amber-950/40"
        >
          <span className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400">
            <TriangleAlertIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Not signed in</p>
            <p className="mt-0.5 break-words text-xs text-amber-800/90 dark:text-amber-300/90">{result.message}</p>
          </div>
        </div>
      )}

      {student && attendance && (
        <div key={scanSeq} className="space-y-2">
          <ScanResultCard
            name={student.full_name}
            className={student.class_name}
            barcode={student.barcode}
            signedInAt={attendance.signed_in_at}
            alreadyMarked={attendance.already_marked}
            pendingDues={fee?.overdue ? 0 : otherDues}
            admissionDue={fee?.admission_fee_due ?? 0}
            securityDue={fee?.security_fee_due ?? 0}
          />

          {/* Sits directly under the confirmation rather than above it: the desk
              still sees an overdue account before the student walks off, but it
              no longer outshouts the sign-in it belongs to. */}
          {fee?.overdue && (
            <FeeOverdueBanner
              overdueAmount={fee.overdue_amount}
              overdueMonths={fee.overdue_months}
              otherDues={otherDues}
              admissionDue={fee.admission_fee_due}
              securityDue={fee.security_fee_due}
              guardianName={student.guardian_name}
              guardianPhone={student.guardian_phone}
            />
          )}
        </div>
      )}

      <RecentSignIns entries={history} />
    </div>
  )
}
