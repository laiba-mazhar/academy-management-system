import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { Class, CourseBreakdown, CourseBreakdownSlot, Subject } from '@/types/database'

type TeacherOption = { id: string; full_name: string }

export function CourseBreakdownOverviewPage() {
  const { show } = useToast()
  const [breakdowns, setBreakdowns] = useState<CourseBreakdown[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [teachers, setTeachers] = useState<TeacherOption[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [slots, setSlots] = useState<CourseBreakdownSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [breakdownsRes, subjectsRes, classesRes, profilesRes] = await Promise.all([
        supabase.from('course_breakdowns').select('*').order('start_date', { ascending: false }),
        supabase.from('subjects').select('*'),
        supabase.from('classes').select('*'),
        supabase.from('profiles').select('id, full_name').eq('role', 'teacher'),
      ])
      if (breakdownsRes.error) show(breakdownsRes.error.message, 'error')
      else setBreakdowns(breakdownsRes.data as CourseBreakdown[])
      if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
      if (classesRes.data) setClasses(classesRes.data as Class[])
      if (profilesRes.data) setTeachers(profilesRes.data as unknown as TeacherOption[])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])

  async function openDetail(id: string) {
    setOpenId(id)
    setSlotsLoading(true)
    const { data, error } = await supabase
      .from('course_breakdown_slots')
      .select('*')
      .eq('course_breakdown_id', id)
      .order('slot_number')
    if (error) show(error.message, 'error')
    else setSlots(data as CourseBreakdownSlot[])
    setSlotsLoading(false)
  }

  const openBreakdown = breakdowns.find((b) => b.id === openId) ?? null
  const openSubject = openBreakdown ? subjectById.get(openBreakdown.subject_id) : undefined

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Course Breakdown</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every teacher's pacing plan, by subject and class.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-400 dark:text-slate-500">Loading...</p>
      ) : breakdowns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500">
          No teachers have submitted a course breakdown plan yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Planner</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {breakdowns.map((b) => {
                const subject = subjectById.get(b.subject_id)
                return (
                  <tr
                    key={b.id}
                    onClick={() => openDetail(b.id)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                      {subject?.teacher_id ? teacherById.get(subject.teacher_id)?.full_name ?? 'Unknown' : 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{subject?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {subject ? classById.get(subject.class_id)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {formatDate(b.start_date)} – {formatDate(b.end_date)}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-300">{b.planner_type}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-brand-600 dark:text-gold-400">Open</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openBreakdown && (
        <Modal
          title={`${openSubject?.name ?? 'Subject'} — Course Breakdown`}
          onClose={() => setOpenId(null)}
          wide
        >
          <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            {openSubject ? classById.get(openSubject.class_id)?.name : '—'} · Taught by{' '}
            {openSubject?.teacher_id ? teacherById.get(openSubject.teacher_id)?.full_name ?? 'Unknown' : 'Unassigned'}
            <br />
            {formatDate(openBreakdown.start_date)} – {formatDate(openBreakdown.end_date)} ·{' '}
            {openBreakdown.total_chapters} chapters · {openBreakdown.planner_type}
          </div>
          {slotsLoading ? (
            <p className="text-slate-400 dark:text-slate-500">Loading...</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Period</th>
                    <th className="px-2 py-2">Chapters to cover</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{slot.slot_number}</td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                        {formatDate(slot.slot_start)} – {formatDate(slot.slot_end)}
                      </td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{slot.chapters || '—'}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            slot.is_done
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}
                        >
                          {slot.is_done ? 'Done' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
