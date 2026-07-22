import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/EmptyState'
import { TimetableGrid } from '@/components/TimetableGrid'
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
          <TimetableGrid
            slots={slots.map((s) => ({
              id: s.id,
              day_of_week: s.day_of_week,
              start_time: s.start_time,
              end_time: s.end_time,
              primary: subjectById.get(s.subject_id)?.name ?? '—',
              secondary: classById.get(s.class_id)?.name ?? '—',
            }))}
            emptyMessage="No timetable slots yet."
          />
        )}
      </div>
    </div>
  )
}
