import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/EmptyState'
import type { Class, Student } from '@/types/database'

export function TeacherStudentsPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [studentsRes, classesRes] = await Promise.all([
        supabase.from('students').select('*').order('full_name'),
        supabase.from('classes').select('*'),
      ])
      if (studentsRes.error) show(studentsRes.error.message, 'error')
      else setStudents(studentsRes.data as Student[])
      if (classesRes.data) setClasses(classesRes.data as Class[])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const filtered = students.filter((s) => s.full_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">My Students</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Students in your assigned classes.</p>
      </div>

      <Input placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />

      {loading ? (
        <p className="text-slate-400 dark:text-slate-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No students yet" description="Once you're assigned a subject and class, your students will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.enrollment_status}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={s.id} className="text-sm text-brand-600 hover:underline">
                      View Progress
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
