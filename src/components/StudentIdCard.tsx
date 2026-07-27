import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import type { Student } from '@/types/database'

// The QR code just encodes the student's own id (already a unique,
// permanent identifier) — a gate scanner looks that id up against the
// students table rather than needing any new column or generated code.
export function StudentIdCard({
  student,
  classLabel,
  className,
}: {
  student: Student
  classLabel: string
  className?: string
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(student.id, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [student.id])

  return (
    <div className={className}>
      <div className="mx-auto max-w-sm rounded-2xl border-2 border-gold-400/40 bg-white p-6 text-center dark:bg-slate-800">
        <DocumentLetterhead subtitle="Student ID Card" />
        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{student.full_name}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">Class: {classLabel}</p>
        {student.guardian_name && (
          <p className="text-sm text-slate-600 dark:text-slate-300">Guardian: {student.guardian_name}</p>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500">Student ID: {student.id.slice(0, 8).toUpperCase()}</p>
        <div className="mt-4 flex justify-center">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR code for ${student.full_name}`} className="h-40 w-40" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
              Generating...
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Scan at the gate to mark attendance.
        </p>
      </div>
    </div>
  )
}
