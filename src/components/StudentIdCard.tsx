import { QRCodeSVG } from 'qrcode.react'
import { MAKTAB_LOGO_BASE64 } from '@/assets/maktabLogoBase64'
import type { Class, Student } from '@/types/database'

// The QR encodes the student's database id and nothing else. The scan station
// looks the id up directly, so the card carries no personal data — a lost card
// reveals only a meaningless uuid, and nothing has to be re-issued if a
// student's name or class changes.
export function StudentIdCard({ student, klass }: { student: Student; klass?: Class | null }) {
  return (
    <div className="print-area mx-auto w-[340px] overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-900">
      <div className="flex items-center gap-2 bg-brand-700 px-4 py-2 text-white">
        <img src={MAKTAB_LOGO_BASE64} alt="" className="h-8 w-8 rounded bg-white/90 object-contain p-0.5" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">Maktab</p>
          <p className="text-[10px] opacity-90">The Educational Institute</p>
        </div>
      </div>

      <div className="flex gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Student</p>
          <p className="truncate text-base font-semibold">{student.full_name}</p>

          <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Class</p>
          <p className="text-sm">{klass?.name ?? '—'}</p>

          {student.guardian_name && (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">Guardian</p>
              <p className="truncate text-sm">{student.guardian_name}</p>
            </>
          )}
        </div>

        <div className="shrink-0 text-center">
          <QRCodeSVG value={student.id} size={96} level="M" includeMargin={false} />
          <p className="mt-1 text-[8px] text-slate-400">Scan at gate</p>
        </div>
      </div>

      <p className="border-t border-slate-200 px-4 py-1.5 text-center text-[9px] text-slate-400">
        If found, please return to Maktab - The Educational Institute
      </p>
    </div>
  )
}
