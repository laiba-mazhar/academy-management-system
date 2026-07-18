import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/EmptyState'
import { DAY_NAMES } from '@/lib/utils'
import type { Class, Subject, Timetable } from '@/types/database'

export function TeacherTimetablePage() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [slots, setSlots] = useState<Timetable[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [slotsRes, subjectsRes, classesRes] = await Promise.all([
        supabase.from('timetable').select('*').eq('teacher_id', profile!.id),
        supabase.from('subjects').select('*'),
        supabase.from('classes').select('*'),
      ])
      if (slotsRes.error) show(slotsRes.error.message, 'error')
      else setSlots(slotsRes.data as Timetable[])
      if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
      if (classesRes.data) setClasses(classesRes.data as Class[])
      setLoading(false)
    }
    if (profile) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  const slotsByDay = useMemo(() => {
    const map = new Map<number, Timetable[]>()
    for (const s of slots) {
      const list = map.get(s.day_of_week) ?? []
      list.push(s)
      map.set(s.day_of_week, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time))
    return map
  }, [slots])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">My Timetable</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Your weekly teaching schedule.</p>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="print-area space-y-4">
        {loading ? (
          <p className="text-slate-400 dark:text-slate-500">Loading...</p>
        ) : slots.length === 0 ? (
          <EmptyState title="No classes scheduled yet" description="Your timetable slots will appear here once the admin assigns them." />
        ) : (
          DAY_NAMES.map((dayName, dayIdx) => {
            const daySlots = slotsByDay.get(dayIdx) ?? []
            if (daySlots.length === 0) return null
            return (
              <div key={dayIdx} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {dayName}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-2">Time</th>
                        <th className="px-4 py-2">Class</th>
                        <th className="px-4 py-2">Subject</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daySlots.map((s) => (
                        <tr key={s.id} className="border-t border-slate-100 dark:border-slate-700/60">
                          <td className="whitespace-nowrap px-4 py-2">
                            {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                          </td>
                          <td className="px-4 py-2">{classById.get(s.class_id)?.name ?? '—'}</td>
                          <td className="px-4 py-2">{subjectById.get(s.subject_id)?.name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
