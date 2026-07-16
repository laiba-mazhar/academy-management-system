import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { EmptyState } from '@/components/EmptyState'
import { Select } from '@/components/ui/Input'
import { CATEGORICAL, CHART_INK, SEQUENTIAL_BLUE, STATUS, TOOLTIP_CURSOR, TOOLTIP_STYLE } from '@/lib/chartColors'
import { currentMonthValue, formatCurrency, formatMonth, monthValueToDate, netInvoiceAmount, percentage } from '@/lib/utils'
import type { Attendance, Class, Exam, ExamResult, Invoice, Salary, Student } from '@/types/database'

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
  const [salaries, setSalaries] = useState<Salary[]>([])
  const [loading, setLoading] = useState(true)
  const [chartClassFilter, setChartClassFilter] = useState('all')
  const [chartCategoryFilter, setChartCategoryFilter] = useState('all')

  const currentMonth = monthValueToDate(currentMonthValue())

  async function load() {
    setLoading(true)
    const [studentsRes, classesRes, invoicesRes, attendanceRes, examsRes, resultsRes, salariesRes] = await Promise.all([
      supabase.from('students').select('*'),
      supabase.from('classes').select('*'),
      supabase.from('invoices').select('*'),
      supabase.from('attendance').select('*').gte('date', currentMonth),
      supabase.from('exams').select('*'),
      supabase.from('exam_results').select('*'),
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
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams])
  const categories = useMemo(
    () => [...new Set(classes.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [classes]
  )
  const filteredClasses = useMemo(
    () =>
      classes.filter((c) => {
        if (chartClassFilter !== 'all' && c.id !== chartClassFilter) return false
        if (chartCategoryFilter !== 'all' && c.category !== chartCategoryFilter) return false
        return true
      }),
    [classes, chartClassFilter, chartCategoryFilter]
  )
  const filteredClassIds = useMemo(() => new Set(filteredClasses.map((c) => c.id)), [filteredClasses])

  const enrolledCount = students.filter((s) => s.enrollment_status === 'enrolled').length
  const newAdmissionsThisMonth = useMemo(
    () => students.filter((s) => s.created_at.startsWith(currentMonthValue())).length,
    [students]
  )

  const monthInvoices = invoices.filter((i) => i.month === currentMonth)
  const monthFeeRows = useMemo(() => {
    const invoiceByStudent = new Map(monthInvoices.map((i) => [i.student_id, i]))
    return students
      .filter((s) => s.enrollment_status === 'enrolled')
      .map((s) => ({ student: s, invoice: invoiceByStudent.get(s.id) ?? null }))
      .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name))
  }, [students, monthInvoices])
  const collectedThisMonth = monthInvoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + netInvoiceAmount(i), 0)
  const dueThisMonth = monthInvoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum, i) => sum + netInvoiceAmount(i), 0)

  const overallAttendancePercent = useMemo(() => {
    if (attendance.length === 0) return 0
    const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
    return Math.round((present / attendance.length) * 1000) / 10
  }, [attendance])

  const performanceByClass = useMemo(() => {
    const byClass = new Map<string, { obtainedSum: number; totalSum: number; passCount: number; count: number }>()
    for (const r of examResults) {
      const exam = examById.get(r.exam_id)
      if (!exam || !filteredClassIds.has(exam.class_id)) continue
      const entry = byClass.get(exam.class_id) ?? { obtainedSum: 0, totalSum: 0, passCount: 0, count: 0 }
      entry.obtainedSum += r.marks_obtained
      entry.totalSum += exam.total_marks
      entry.count += 1
      if (percentage(r.marks_obtained, exam.total_marks) >= PASS_THRESHOLD) entry.passCount += 1
      byClass.set(exam.class_id, entry)
    }
    return filteredClasses
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
  }, [examResults, examById, filteredClasses, filteredClassIds])

  const performanceByExamType = useMemo(() => {
    const byName = new Map<string, { obtainedSum: number; totalSum: number; passCount: number; count: number }>()
    for (const r of examResults) {
      const exam = examById.get(r.exam_id)
      if (!exam || !filteredClassIds.has(exam.class_id)) continue
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
  }, [examResults, examById, filteredClassIds])

  const attendanceByClass = useMemo(() => {
    const byClass = new Map<string, { present: number; total: number }>()
    for (const a of attendance) {
      if (!filteredClassIds.has(a.class_id)) continue
      const entry = byClass.get(a.class_id) ?? { present: 0, total: 0 }
      entry.total += 1
      if (a.status === 'present' || a.status === 'late') entry.present += 1
      byClass.set(a.class_id, entry)
    }
    return filteredClasses
      .map((c) => {
        const entry = byClass.get(c.id)
        return { class: c.name, percent: entry ? percentage(entry.present, entry.total) : 0 }
      })
      .filter((row) => row.percent > 0)
  }, [attendance, filteredClasses, filteredClassIds])

  const monthSalaries = useMemo(() => salaries.filter((s) => s.month === currentMonth), [salaries, currentMonth])
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

  // Financial snapshot: the only cost the system tracks is teacher salary, so
  // "salary expense" doubles as both direct instructional cost and total
  // operating expense here.
  const salaryExpenseThisMonth = monthSalaries.reduce((sum, s) => sum + s.amount, 0)
  const profitThisMonth = collectedThisMonth - salaryExpenseThisMonth

  const revenueVsExpenseTrend = useMemo(() => {
    const months = lastNMonths(6)
    return months.map((m) => {
      const revenue = invoices
        .filter((i) => i.month === m && i.status === 'paid')
        .reduce((sum, i) => sum + netInvoiceAmount(i), 0)
      const expense = salaries.filter((s) => s.month === m).reduce((sum, s) => sum + s.amount, 0)
      return {
        month: formatMonth(m).replace(/\s\d{4}$/, ''),
        revenue,
        expense,
        profit: revenue - expense,
      }
    })
  }, [invoices, salaries])

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
    { label: 'Salaries To Be Paid', value: formatCurrency(salaryTotals.pending), color: STATUS.warning },
    { label: 'New Admissions This Month', value: String(newAdmissionsThisMonth), color: CATEGORICAL[2] },
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Revenue vs Salary Expense (last 6 months)</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueVsExpenseTrend}>
                  <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                  <XAxis dataKey="month" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                  <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip {...TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} formatter={(v: number) => formatCurrency(v)} />
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
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatCurrency(v)} />
                  <Line type="monotone" dataKey="profit" stroke={SEQUENTIAL_BLUE} strokeWidth={2} dot={{ r: 3 }} name="Profit" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Filter charts below
            </span>
            <Select value={chartClassFilter} onChange={(e) => setChartClassFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={chartCategoryFilter} onChange={(e) => setChartCategoryFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Performance by Class</p>
            {performanceByClass.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={performanceByClass}>
                  <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                  <XAxis dataKey="class" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                  <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip {...TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} formatter={(v: number) => `${v}%`} />
                  <Legend />
                  <Bar dataKey="avgPercent" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} name="Average %" />
                  <Bar dataKey="passRate" fill={CATEGORICAL[1]} radius={[4, 4, 0, 0]} name={`Pass Rate (≥${PASS_THRESHOLD}%)`} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <Tooltip {...TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} formatter={(v: number) => `${v}%`} />
                    <Bar dataKey="percent" fill={SEQUENTIAL_BLUE} radius={[4, 4, 0, 0]} name="Attendance %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Results by Exam Type</p>
              <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Combined across every subject and class (Mid 1, Mid 2, Final, etc.)</p>
              {performanceByExamType.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No exam results recorded yet.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={performanceByExamType}>
                      <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={{ stroke: CHART_INK.baseline }} />
                      <YAxis stroke={CHART_INK.muted} fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip {...TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} formatter={(v: number) => `${v}%`} />
                      <Legend />
                      <Bar dataKey="avgPercent" fill={CATEGORICAL[2]} radius={[4, 4, 0, 0]} name="Average %" />
                      <Bar dataKey="passRate" fill={CATEGORICAL[3]} radius={[4, 4, 0, 0]} name={`Pass Rate (≥${PASS_THRESHOLD}%)`} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {performanceByExamType.map((row) => (
                      <div key={row.name} className="rounded-lg border border-slate-100 dark:border-slate-700/60 px-3 py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{row.name}</p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                          Avg {row.avgPercent}% · Pass {row.passRate}%
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Salaries — {formatMonth(currentMonth)}</p>
          <Link to="/admin/salaries" className="text-sm text-brand-600 hover:underline dark:text-gold-400">
            Manage Salaries →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
