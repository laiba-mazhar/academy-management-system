import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/EmptyState'
import { CATEGORICAL, CHART_INK, SEQUENTIAL_BLUE, STATUS } from '@/lib/chartColors'
import { currentMonthValue, formatCurrency, formatMonth, monthValueToDate, percentage, todayLocalDate } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Attendance, Class, Exam, ExamResult, Invoice, Profile, Salary, Student, Teacher } from '@/types/database'

const PASS_THRESHOLD = 40

function lastNMonths(n: number): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }
  return months
}

export function AdminDashboard() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [examResults, setExamResults] = useState<ExamResult[]>([])
  const [teachers, setTeachers] = useState<(Teacher & Pick<Profile, 'full_name'>)[]>([])
  const [salaries, setSalaries] = useState<Salary[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingSalaries, setGeneratingSalaries] = useState(false)

  const currentMonth = monthValueToDate(currentMonthValue())

  async function load() {
    setLoading(true)
    const [studentsRes, classesRes, invoicesRes, attendanceRes, examsRes, resultsRes, profilesRes, salariesRes] =
      await Promise.all([
        supabase.from('students').select('*'),
        supabase.from('classes').select('*'),
        supabase.from('invoices').select('*'),
        supabase.from('attendance').select('*').gte('date', currentMonth),
        supabase.from('exams').select('*'),
        supabase.from('exam_results').select('*'),
        supabase.from('profiles').select('id, full_name').eq('role', 'teacher'),
        supabase.from('salaries').select('*'),
      ])
    if (studentsRes.data) setStudents(studentsRes.data as Student[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (invoicesRes.error) show(invoicesRes.error.message, 'error')
    else setInvoices(invoicesRes.data as Invoice[])
    if (attendanceRes.data) setAttendance(attendanceRes.data as Attendance[])
    if (examsRes.data) setExams(examsRes.data as Exam[])
    if (resultsRes.data) setExamResults(resultsRes.data as ExamResult[])
    if (salariesRes.data) setSalaries(salariesRes.data as Salary[])

    if (profilesRes.data) {
      const ids = (profilesRes.data as Profile[]).map((p) => p.id)
      const teachersRes = ids.length
        ? await supabase.from('teachers').select('*').in('id', ids)
        : { data: [] as Teacher[] }
      const teacherById = new Map(((teachersRes.data as Teacher[]) ?? []).map((t) => [t.id, t]))
      setTeachers(
        (profilesRes.data as Profile[]).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          monthly_salary: teacherById.get(p.id)?.monthly_salary ?? 0,
          created_at: teacherById.get(p.id)?.created_at ?? p.created_at,
        }))
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams])

  const enrolledCount = students.filter((s) => s.enrollment_status === 'enrolled').length

  const monthInvoices = invoices.filter((i) => i.month === currentMonth)
  const monthFeeRows = useMemo(() => {
    const invoiceByStudent = new Map(monthInvoices.map((i) => [i.student_id, i]))
    return students
      .filter((s) => s.enrollment_status === 'enrolled')
      .map((s) => ({ student: s, invoice: invoiceByStudent.get(s.id) ?? null }))
      .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name))
  }, [students, monthInvoices])
  const collectedThisMonth = monthInvoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0)
  const dueThisMonth = monthInvoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum, i) => sum + i.amount, 0)

  const overallAttendancePercent = useMemo(() => {
    if (attendance.length === 0) return 0
    const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
    return Math.round((present / attendance.length) * 1000) / 10
  }, [attendance])

  const performanceByClass = useMemo(() => {
    const byClass = new Map<string, { obtainedSum: number; totalSum: number; passCount: number; count: number }>()
    for (const r of examResults) {
      const exam = examById.get(r.exam_id)
      if (!exam) continue
      const entry = byClass.get(exam.class_id) ?? { obtainedSum: 0, totalSum: 0, passCount: 0, count: 0 }
      entry.obtainedSum += r.marks_obtained
      entry.totalSum += exam.total_marks
      entry.count += 1
      if (percentage(r.marks_obtained, exam.total_marks) >= PASS_THRESHOLD) entry.passCount += 1
      byClass.set(exam.class_id, entry)
    }
    return classes
      .map((c) => {
        const entry = byClass.get(c.id)
        if (!entry) return { class: c.name, avgPercent: 0, passRate: 0 }
        return {
          class: c.name,
          avgPercent: percentage(entry.obtainedSum, entry.totalSum),
          passRate: Math.round((entry.passCount / entry.count) * 1000) / 10,
        }
      })
      .filter((row) => row.avgPercent > 0 || row.passRate > 0)
  }, [examResults, examById, classes])

  const performanceByExamType = useMemo(() => {
    const byName = new Map<string, { obtainedSum: number; totalSum: number; passCount: number; count: number }>()
    for (const r of examResults) {
      const exam = examById.get(r.exam_id)
      if (!exam) continue
      const entry = byName.get(exam.name) ?? { obtainedSum: 0, totalSum: 0, passCount: 0, count: 0 }
      entry.obtainedSum += r.marks_obtained
      entry.totalSum += exam.total_marks
      entry.count += 1
      if (percentage(r.marks_obtained, exam.total_marks) >= PASS_THRESHOLD) entry.passCount += 1
      byName.set(exam.name, entry)
    }
    return Array.from(byName.entries())
      .map(([name, entry]) => ({
        name,
        avgPercent: percentage(entry.obtainedSum, entry.totalSum),
        passRate: Math.round((entry.passCount / entry.count) * 1000) / 10,
        studentCount: entry.count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [examResults, examById])

  const attendanceByClass = useMemo(() => {
    const byClass = new Map<string, { present: number; total: number }>()
    for (const a of attendance) {
      const entry = byClass.get(a.class_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (a.status === 'present' || a.status === 'late') entry.present += 1
      byClass.set(a.class_id, entry)
    }
    return classes
      .map((c) => {
        const entry = byClass.get(c.id)
        return { class: c.name, percent: entry ? percentage(entry.present, entry.total) : 0 }
      })
      .filter((row) => row.percent > 0)
  }, [attendance, classes])

  const monthSalaries = salaries.filter((s) => s.month === currentMonth)
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

  // Financial snapshot: the only cost the system tracks is teacher salary, so
  // "salary expense" doubles as both COGS (direct instructional cost) and total
  // operating expense here — GPM and OPM come out equal. Flagged in the UI copy
  // rather than faked apart, since there's no separate opex data to split on.
  const salaryExpenseThisMonth = monthSalaries.reduce((sum, s) => sum + s.amount, 0)
  const profitThisMonth = collectedThisMonth - salaryExpenseThisMonth
  const marginPercent = collectedThisMonth > 0 ? Math.round((profitThisMonth / collectedThisMonth) * 1000) / 10 : 0

  const revenueVsExpenseTrend = useMemo(() => {
    const months = lastNMonths(6)
    return months.map((m) => {
      const revenue = invoices.filter((i) => i.month === m && i.status === 'paid').reduce((sum, i) => sum + i.amount, 0)
      const expense = salaries.filter((s) => s.month === m).reduce((sum, s) => sum + s.amount, 0)
      return {
        month: formatMonth(m).replace(/\s\d{4}$/, ''),
        revenue,
        expense,
        profit: revenue - expense,
      }
    })
  }, [invoices, salaries])

  async function generateSalaries() {
    setGeneratingSalaries(true)
    const existing = new Set(monthSalaries.map((s) => s.teacher_id))
    const rows = teachers
      .filter((t) => !existing.has(t.id))
      .map((t) => ({ teacher_id: t.id, month: currentMonth, amount: t.monthly_salary, status: 'pending' as const }))
    if (rows.length === 0) {
      setGeneratingSalaries(false)
      show('Salary records already exist for every teacher this month.', 'error')
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

  const salaryByTeacher = useMemo(() => new Map(monthSalaries.map((s) => [s.teacher_id, s])), [monthSalaries])

  const cards = [
    { label: 'Total Students', value: String(enrolledCount) },
    { label: `Collected — ${formatMonth(currentMonth)}`, value: formatCurrency(collectedThisMonth) },
    { label: `Due — ${formatMonth(currentMonth)}`, value: formatCurrency(dueThisMonth) },
    { label: 'Attendance This Month', value: `${overallAttendancePercent}%` },
  ]

  const financeCards = [
    {
      label: 'Net Profit',
      value: formatCurrency(profitThisMonth),
      color: profitThisMonth >= 0 ? STATUS.good : STATUS.critical,
    },
    { label: 'Salary Expense', value: formatCurrency(salaryExpenseThisMonth), color: CHART_INK.primary },
    { label: 'GPM', value: `${marginPercent}%`, color: CATEGORICAL[0] },
    { label: 'OPM', value: `${marginPercent}%`, color: CATEGORICAL[4] },
  ]

  if (loading) {
    return <p className="text-slate-400 dark:text-slate-500">Loading dashboard...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Admin Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Overview of the academy at a glance.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{card.value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Financials — {formatMonth(currentMonth)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Based on fees collected and salary expense — the only revenue/cost this system tracks
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {financeCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold" style={{ color: card.color }}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {students.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="Charts will populate once students, fees, attendance, and exam results are recorded."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Revenue vs Salary Expense (last 6 months)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueVsExpenseTrend}>
                <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                <XAxis dataKey="month" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="revenue" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expense" fill={CATEGORICAL[5]} radius={[4, 4, 0, 0]} name="Salary Expense" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Profit Trend (last 6 months)</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={revenueVsExpenseTrend}>
                <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                <XAxis dataKey="month" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Line type="monotone" dataKey="profit" stroke={SEQUENTIAL_BLUE} strokeWidth={2} dot={{ r: 3 }} name="Profit" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Attendance % by Class (this month)</p>
            {attendanceByClass.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No attendance recorded this month.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={attendanceByClass}>
                  <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                  <XAxis dataKey="class" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                  <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="percent" fill={SEQUENTIAL_BLUE} radius={[4, 4, 0, 0]} name="Attendance %" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 lg:col-span-2">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Performance by Class</p>
            {performanceByClass.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={performanceByClass}>
                  <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                  <XAxis dataKey="class" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                  <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="avgPercent" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} name="Average %" />
                  <Bar dataKey="passRate" fill={CATEGORICAL[1]} radius={[4, 4, 0, 0]} name={`Pass Rate (≥${PASS_THRESHOLD}%)`} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 lg:col-span-2">
            <p className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Results by Exam Type</p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
              Combined across every subject and class sitting each exam (Mid 1, Mid 2, Final, etc.)
            </p>
            {performanceByExamType.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={performanceByExamType}>
                    <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                    <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip formatter={(v: number) => `${v}%`} />
                    <Legend />
                    <Bar dataKey="avgPercent" fill={CATEGORICAL[2]} radius={[4, 4, 0, 0]} name="Average %" />
                    <Bar dataKey="passRate" fill={CATEGORICAL[3]} radius={[4, 4, 0, 0]} name={`Pass Rate (≥${PASS_THRESHOLD}%)`} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {performanceByExamType.map((row) => (
                    <div key={row.name} className="rounded-lg border border-slate-100 dark:border-slate-700/60 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{row.name}</p>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                        Avg {row.avgPercent}% · Pass {row.passRate}%
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{row.studentCount} result(s)</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Salaries — {formatMonth(currentMonth)}</p>
          <Button variant="secondary" onClick={generateSalaries} disabled={generatingSalaries}>
            {generatingSalaries ? 'Generating...' : 'Generate Salary Records'}
          </Button>
        </div>
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
                <th className="px-2 py-2">This Month</th>
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
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{t.full_name}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatCurrency(salary?.amount ?? t.monthly_salary)}</td>
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
                        <button onClick={() => markSalaryPaid(salary)} className="text-sm text-brand-600 hover:underline">
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

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Live Fee Status — {formatMonth(currentMonth)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{monthFeeRows.length} enrolled students</p>
        </div>
        {monthFeeRows.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No enrolled students yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">Student</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {monthFeeRows.map(({ student, invoice }) => (
                  <tr key={student.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{student.full_name}</td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{invoice ? formatCurrency(invoice.amount) : '—'}</td>
                    <td className="px-2 py-2">
                      {invoice ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            invoice.status === 'paid'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : invoice.status === 'overdue'
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {invoice.status}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Not generated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
