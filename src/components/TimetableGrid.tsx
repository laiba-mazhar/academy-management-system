import type { ReactNode } from 'react'
import { DAY_NAMES } from '@/lib/utils'

export type TimetableCellSlot = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  primary: ReactNode
  secondary?: ReactNode
  onRemove?: () => void
}

interface TimetableGridProps {
  slots: TimetableCellSlot[]
  emptyMessage: string
}

function rowKey(start: string, end: string) {
  return `${start}-${end}`
}

export function TimetableGrid({ slots, emptyMessage }: TimetableGridProps) {
  if (slots.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-6 py-16 text-center text-slate-400 dark:text-slate-500">
        {emptyMessage}
      </p>
    )
  }

  const days = Array.from(new Set(slots.map((s) => s.day_of_week))).sort((a, b) => a - b)

  const rows = Array.from(
    new Map(slots.map((s) => [rowKey(s.start_time, s.end_time), { start: s.start_time, end: s.end_time }])).values()
  ).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))

  const cellMap = new Map<string, TimetableCellSlot[]>()
  for (const s of slots) {
    const key = `${s.day_of_week}|${rowKey(s.start_time, s.end_time)}`
    const list = cellMap.get(key) ?? []
    list.push(s)
    cellMap.set(key, list)
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Time
            </th>
            {days.map((d) => (
              <th
                key={d}
                className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
              >
                {DAY_NAMES[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row.start, row.end)} className="border-t border-slate-100 dark:border-slate-700/60">
              <td className="sticky left-0 z-10 whitespace-nowrap border-r border-slate-200 bg-white px-4 py-2 font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {row.start.slice(0, 5)}–{row.end.slice(0, 5)}
              </td>
              {days.map((d) => {
                const cellSlots = cellMap.get(`${d}|${rowKey(row.start, row.end)}`) ?? []
                return (
                  <td key={d} className="px-2 py-2 align-top">
                    {cellSlots.map((s) => (
                      <div
                        key={s.id}
                        className="group relative rounded-lg bg-brand-50 px-3 py-2 dark:bg-brand-900/30"
                      >
                        <p className="pr-4 text-sm font-medium text-slate-800 dark:text-slate-100">{s.primary}</p>
                        {s.secondary && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{s.secondary}</p>
                        )}
                        {s.onRemove && (
                          <button
                            onClick={s.onRemove}
                            title="Remove"
                            className="no-print absolute right-1.5 top-1.5 hidden text-xs text-red-600 hover:underline group-hover:block dark:text-red-400"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
