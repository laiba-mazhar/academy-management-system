import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import { todayLocalDate } from '@/lib/utils'
import type { Class, Student, StudentScan } from '@/types/database'

type Feedback = { kind: 'in' | 'out' | 'error'; title: string; detail: string } | null

/** A student's scan for today, joined to the names the screen displays. */
type ScanRow = StudentScan & { studentName: string; className: string }

// A student scanning again within this window is treated as a double-read of
// the same card rather than a genuine check-out — handheld scanners fire twice
// on a slightly long press, and a webcam decodes the same frame repeatedly.
const DUPLICATE_SCAN_MS = 10_000

const CAMERA_ELEMENT_ID = 'scan-station-camera'

export function ScanStationPage() {
  const { profile, signOut } = useAuth()
  const [students, setStudents] = useState<Student[]>([])
  const [classById, setClassById] = useState<Map<string, Class>>(new Map())
  const [scans, setScans] = useState<ScanRow[]>([])
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [manualCode, setManualCode] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const today = todayLocalDate()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<Html5Qrcode | null>(null)
  // Guards against the same card being processed twice while the first write is
  // still in flight — without it a double-read checks a student straight back out.
  const lastScanRef = useRef<{ code: string; at: number } | null>(null)
  const processingRef = useRef(false)

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])

  const decorate = useCallback(
    (scan: StudentScan): ScanRow => {
      const student = studentById.get(scan.student_id)
      return {
        ...scan,
        studentName: student?.full_name ?? 'Unknown student',
        className: (student?.class_id ? classById.get(student.class_id)?.name : null) ?? '—',
      }
    },
    [studentById, classById]
  )

  useEffect(() => {
    async function load() {
      const [studentsRes, classesRes, scansRes] = await Promise.all([
        supabase.from('students').select('*').eq('enrollment_status', 'enrolled'),
        supabase.from('classes').select('*'),
        supabase.from('student_scans').select('*').eq('scan_date', todayLocalDate()),
      ])
      const studentRows = (studentsRes.data ?? []) as Student[]
      const classRows = (classesRes.data ?? []) as Class[]
      setStudents(studentRows)
      setClassById(new Map(classRows.map((c) => [c.id, c])))

      const sMap = new Map(studentRows.map((s) => [s.id, s]))
      const cMap = new Map(classRows.map((c) => [c.id, c]))
      setScans(
        ((scansRes.data ?? []) as StudentScan[])
          .map((scan) => {
            const student = sMap.get(scan.student_id)
            return {
              ...scan,
              studentName: student?.full_name ?? 'Unknown student',
              className: (student?.class_id ? cMap.get(student.class_id)?.name : null) ?? '—',
            }
          })
          .sort((a, b) => (b.check_out_at ?? b.check_in_at ?? '').localeCompare(a.check_out_at ?? a.check_in_at ?? ''))
      )
      setLoading(false)
    }
    load()
  }, [])

  // Live updates so a second station (or an admin correcting a row) is
  // reflected here without reloading the page.
  useEffect(() => {
    const channel = supabase
      .channel('student_scans_today')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_scans', filter: `scan_date=eq.${today}` },
        (payload) => {
          const row = payload.new as StudentScan
          if (!row?.id) return
          setScans((prev) => {
            const next = prev.filter((s) => s.id !== row.id)
            return [decorate(row), ...next]
          })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [today, decorate])

  const handleCode = useCallback(
    async (raw: string) => {
      const code = raw.trim()
      if (!code || processingRef.current) return

      const now = Date.now()
      const last = lastScanRef.current
      if (last && last.code === code && now - last.at < DUPLICATE_SCAN_MS) return
      lastScanRef.current = { code, at: now }
      processingRef.current = true

      try {
        const student = studentById.get(code)
        if (!student) {
          setFeedback({
            kind: 'error',
            title: 'Card not recognised',
            detail: 'This QR code does not match any enrolled student.',
          })
          return
        }

        const nowIso = new Date().toISOString()
        const existing = scans.find((s) => s.student_id === student.id)
        const className = (student.class_id ? classById.get(student.class_id)?.name : null) ?? '—'

        if (!existing) {
          const { error } = await supabase.from('student_scans').insert({
            student_id: student.id,
            scan_date: today,
            check_in_at: nowIso,
            recorded_by: profile?.id ?? null,
          })
          if (error) {
            setFeedback({ kind: 'error', title: 'Could not record', detail: error.message })
            return
          }
          setFeedback({ kind: 'in', title: `${student.full_name} checked IN`, detail: className })
          return
        }

        if (existing.check_out_at) {
          setFeedback({
            kind: 'error',
            title: `${student.full_name} already checked out`,
            detail: `Checked out at ${formatTime(existing.check_out_at)}. Ask an admin to correct it if this is wrong.`,
          })
          return
        }

        const { error } = await supabase
          .from('student_scans')
          .update({ check_out_at: nowIso })
          .eq('id', existing.id)
        if (error) {
          setFeedback({ kind: 'error', title: 'Could not record', detail: error.message })
          return
        }
        setFeedback({ kind: 'out', title: `${student.full_name} checked OUT`, detail: className })
      } finally {
        processingRef.current = false
      }
    },
    [studentById, classById, scans, today, profile]
  )

  // A USB scanner behaves as a keyboard, so the hidden input just needs to keep
  // focus for scans to land no matter where the operator last clicked.
  useEffect(() => {
    const id = setInterval(() => {
      if (!cameraOn && document.activeElement !== inputRef.current) inputRef.current?.focus()
    }, 500)
    return () => clearInterval(id)
  }, [cameraOn])

  useEffect(() => {
    if (!feedback) return
    const id = setTimeout(() => setFeedback(null), 4000)
    return () => clearTimeout(id)
  }, [feedback])

  async function toggleCamera() {
    setCameraError(null)
    if (cameraOn) {
      await cameraRef.current?.stop().catch(() => {})
      cameraRef.current = null
      setCameraOn(false)
      return
    }
    setCameraOn(true)
    try {
      const scanner = new Html5Qrcode(CAMERA_ELEMENT_ID)
      cameraRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => handleCode(decoded),
        () => {} // per-frame decode misses are normal; nothing to report
      )
    } catch (err) {
      setCameraError((err as Error)?.message ?? 'Could not start the camera.')
      setCameraOn(false)
      cameraRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      cameraRef.current?.stop().catch(() => {})
    }
  }, [])

  const checkedIn = scans.filter((s) => !s.check_out_at).length
  const checkedOut = scans.filter((s) => s.check_out_at).length

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <DocumentLetterhead subtitle="Gate Attendance — Scan Station" />
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="On premises" value={checkedIn} tone="green" />
          <StatCard label="Checked out" value={checkedOut} tone="slate" />
          <StatCard label="Scanned today" value={scans.length} tone="brand" />
        </div>

        {/* Large, colour-coded confirmation so the operator can read it at a
            glance from across a desk without leaning into the screen. */}
        <div
          className={`flex min-h-32 items-center justify-center rounded-2xl border-2 p-6 text-center transition-colors ${
            feedback?.kind === 'in'
              ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
              : feedback?.kind === 'out'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                : feedback?.kind === 'error'
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800'
          }`}
        >
          {feedback ? (
            <div>
              <p
                className={`text-2xl font-bold ${
                  feedback.kind === 'in'
                    ? 'text-green-700 dark:text-green-300'
                    : feedback.kind === 'out'
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-red-700 dark:text-red-300'
                }`}
              >
                {feedback.title}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{feedback.detail}</p>
            </div>
          ) : (
            <p className="text-slate-400 dark:text-slate-500">Ready — scan a student card</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                Scanner input
              </label>
              <input
                ref={inputRef}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  handleCode(manualCode)
                  setManualCode('')
                }}
                placeholder="Scan a card, or type a code and press Enter"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <Button variant="secondary" onClick={toggleCamera}>
              {cameraOn ? 'Stop camera' : 'Use webcam'}
            </Button>
          </div>
          {cameraError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{cameraError}</p>}
          <div id={CAMERA_ELEMENT_ID} className={cameraOn ? 'mt-3 overflow-hidden rounded-lg' : 'hidden'} />
          {!cameraOn && (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              A USB scanner types into this box automatically — it stays focused, so you can leave this screen open.
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Checked in</th>
                <th className="px-4 py-3">Checked out</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : scans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                    No scans yet today.
                  </td>
                </tr>
              ) : (
                scans.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.studentName}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.className}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatTime(s.check_in_at)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatTime(s.check_out_at)}</td>
                    <td className="px-4 py-3">
                      {s.check_out_at ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          Left
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
                          On premises
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'green' | 'slate' | 'brand' }) {
  const toneClass =
    tone === 'green'
      ? 'text-green-700 dark:text-green-300'
      : tone === 'brand'
        ? 'text-brand-600 dark:text-brand-400'
        : 'text-slate-700 dark:text-slate-300'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs uppercase text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-3xl font-bold ${toneClass}`}>{value}</p>
    </div>
  )
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
