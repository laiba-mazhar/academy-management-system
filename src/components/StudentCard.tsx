import { Barcode } from '@/components/Barcode'
import logoUrl from '@/assets/maktab_logo_transparent.png'
import type { Class, Student } from '@/types/database'

// A student's printable ID card. Fixed physical dimensions (90mm x 55mm — a
// little wider than a bank card, which is what gives the barcode enough width
// to stay comfortably scannable) so what's on screen is exactly what prints.
//
// Deliberately not theme-aware: the card is always light-on-white regardless of
// the app's dark mode, because a dark card neither prints nor scans.
export function StudentCard({ student, cls }: { student: Student; cls?: Class }) {
  return (
    <div
      className="student-card flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white text-black shadow-sm"
      style={{ width: '90mm', height: '55mm' }}
    >
      <div className="flex items-center gap-2 bg-[#611825] px-3 py-1.5">
        <img src={logoUrl} alt="" className="h-7 w-auto shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="text-[7px] font-semibold uppercase tracking-[0.2em] text-[#dfb65b]">Maktab</p>
          <p className="truncate text-[10px] font-semibold text-[#fdfbf5]">The Educational Institute</p>
        </div>
        <p className="ml-auto shrink-0 text-[7px] font-semibold uppercase tracking-widest text-[#dfb65b]">
          Student Card
        </p>
      </div>

      <div className="flex flex-1 flex-col justify-between px-3 py-2">
        <div className="leading-tight">
          <p className="truncate text-[13px] font-bold text-[#4a121c]">{student.full_name}</p>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[8px] text-slate-700">
            <span className="font-semibold uppercase tracking-wide text-slate-500">Class</span>
            <span className="truncate">{cls?.name ?? 'Unassigned'}</span>
            <span className="font-semibold uppercase tracking-wide text-slate-500">Guardian</span>
            <span className="truncate">{student.guardian_name || '—'}</span>
            <span className="font-semibold uppercase tracking-wide text-slate-500">Contact</span>
            <span className="truncate">{student.guardian_phone || student.contact_phone || '—'}</span>
          </div>
        </div>

        <Barcode value={student.barcode} height={38} />
      </div>
    </div>
  )
}
