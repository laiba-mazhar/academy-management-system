import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { STATUS } from '@/lib/chartColors'
import { currentMonthValue, formatCurrency, formatMonth, monthValueToDate, todayLocalDate } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Profile, Salary, Teacher } from '@/types/database'

type TeacherRow = Teacher & Pick<Profile, 'full_name'>

export function SalariesPage() {
  const { show } = useToast()
  const [teachers, setTeachers] = useState<TeacherRow[]>([])
  const [salaries, setSalaries] = useState<Salary[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingSalaries, setGeneratingSalaries] = useState(false)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})

  const currentMonth = monthValueToDate(currentMonthValue())

  async function load() {
    setLoading(true)
    const [profilesRes, salariesRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('salaries').select('*'),
    ])
    if (salariesRes.error) show(salariesRes.error.message, 'error')
    else setSalaries(salariesRes.data as Salary[])

    if (profilesRes.error) {
      show(profilesRes.error.message, 'error')
      setLoading(false)
      return
    }
    const teacherProfiles = profilesRes.data as Profile[]
    const ids = teacherProfiles.map((p) => p.id)
    const teachersRes = ids.length ? await supabase.from('teachers').select('*').in('id', ids) : { data: [] as Teacher[] }
    const teacherById = new Map(((teachersRes.data as Teacher[]) ?? []).map((t) => [t.id, t]))
    setTeachers(
      teacherProfiles.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        monthly_salary: teacherById.get(p.id)?.monthly_salary ?? 0,
        status: teacherById.get(p.id)?.status ?? 'active',
        created_at: teacherById.get(p.id)?.created_at ?? p.created_at,
      }))
    )
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const monthSalaries = useMemo(() => salaries.filter((s) => s.month === currentMonth), [salaries, currentMonth])
  const salaryByTeacher = useMemo(() => new Map(monthSalaries.map((s) => [s.teacher_id, s])), [monthSalaries])

  const salaryTotals = useMemo(() => {
    const paid = monthSalaries.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0)
    const pending = monthSalaries.filter((s) => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0)
    return { paid, pending }
  }, [monthSalaries])

  const salaryTotalsAllTime = useMemo(() => {
    const paid = salaries.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.amount, 0)
    const pending = salaries.filter((s) => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0)
    return { paid, pending }
  }, [salaries])

  const salaryByTeacherAllTime = useMemo(() => {
    const map = new Map<string, { paid: number; pending: number }>()
    for (const s of salaries) {
      const entry = map.get(s.teacher_id) ?? { paid: 0, pending: 0 }
      if (s.status === 'paid') entry.paid += s.amount
      else entry.pending += s.amount
      map.set(s.teacher_id, entry)
    }
    return map
  }, [salaries])

  async function generateSalaries() {
    setGeneratingSalaries(true)
    const existing = new Set(monthSalaries.map((s) => s.teacher_id))
    const rows = teachers
      .filter((t) => t.status === 'active' && !existing.has(t.id))
      .map((t) => ({ teacher_id: t.id, month: currentMonth, amount: t.monthly_salary, status: 'pending' as const }))
    if (rows.length === 0) {
      setGeneratingSalaries(false)
      show('Salary records already exist for every active teacher this month.', 'error')
      return
    }
    const { error } = await supabase.from('salaries').insert(rows)
    setGeneratingSalaries(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Generated ${rows.length} salary record(s) for ${formatMonth(currentMonth)}.`)
    load()
  }

  async function saveAmount(salary: Salary) {
    const draft = amountDrafts[salary.id]
    if (draft === undefined) return
    const value = Number(draft)
    if (Number.isNaN(value) || value < 0) {
      show('Salary amount must be a non-negative number.', 'error')
      return
    }
    const { error } = await supabase.from('salaries').update({ amount: value }).eq('id', salary.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show('Salary amount updated.')
    setAmountDrafts((prev) => {
      const next = { ...prev }
      delete next[salary.id]
      return next
    })
    load()
  }

  async function markSalaryPaid(salary: Salary) {
    const { error } = await supabase
      .from('salaries')
      .update({ status: 'paid', paid_date: todayLocalDate() })
      .eq('id', salary.id)
    if (error) show(error.message, 'error')
    else {
      show('Salary marked as paid.')
      load()
    }
  }

  if (loading) {
    return <p className="text-slate-400 dark:text-slate-500">Loading salaries...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Salaries</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatMonth(currentMonth)}</p>
        </div>
        <Button variant="secondary" onClick={generateSalaries} disabled={generatingSalaries}>
          {generatingSalaries ? 'Generating...' : 'Generate Salary Records'}
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Paid ({formatMonth(currentMonth)})</p>
            <p className="text-xl font-semibold" style={{ color: STATUS.good }}>
              {formatCurrency(salaryTotals.paid)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Pending ({formatMonth(currentMonth)})</p>
            <p className="text-xl font-semibold" style={{ color: STATUS.warning }}>
              {formatCurrency(salaryTotals.pending)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Total Paid (all time)</p>
            <p className="text-xl font-semibold" style={{ color: STATUS.good }}>
              {formatCurrency(salaryTotalsAllTime.paid)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Total Pending (all time)</p>
            <p className="text-xl font-semibold" style={{ color: STATUS.warning }}>
              {formatCurrency(salaryTotalsAllTime.pending)}
            </p>
          </div>
        </div>
        {teachers.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No teachers yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-2 py-2">Teacher</th>
                <th className="px-2 py-2">This Month's Amount</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Total Paid (all time)</th>
                <th className="px-2 py-2">Total Pending (all time)</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const salary = salaryByTeacher.get(t.id)
                const lifetime = salaryByTeacherAllTime.get(t.id) ?? { paid: 0, pending: 0 }
                return (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">
                      {t.full_name}
                      {t.status === 'left' && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          left
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                      {salary && salary.status !== 'paid' ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={String(salary.amount)}
                          onChange={(e) => setAmountDrafts((prev) => ({ ...prev, [salary.id]: e.target.value }))}
                          onBlur={() => saveAmount(salary)}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                        />
                      ) : (
                        formatCurrency(salary?.amount ?? t.monthly_salary)
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {salary ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            salary.status === 'paid' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {salary.status}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Not generated</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-green-700 dark:text-green-400">{formatCurrency(lifetime.paid)}</td>
                    <td className="px-2 py-2 text-amber-700 dark:text-amber-400">{formatCurrency(lifetime.pending)}</td>
                    <td className="px-2 py-2 text-right">
                      {salary && salary.status !== 'paid' && (
                        <button onClick={() => markSalaryPaid(salary)} className="text-sm text-brand-600 hover:underline dark:text-gold-400">
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
