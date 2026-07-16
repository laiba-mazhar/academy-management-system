import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { DocumentLetterhead } from '@/components/DocumentLetterhead'
import { currentMonthValue, effectiveFee, formatCurrency, formatDate, formatMonth, monthValueToDate, netInvoiceAmount, shiftMonthValue, todayLocalDate } from '@/lib/utils'
import { friendlyError, edgeFunctionError } from '@/lib/errors'
import type { Class, Invoice, Student } from '@/types/database'

export function FeesPage() {
  const { show } = useToast()
  const [tab, setTab] = useState<'overview' | 'monthly'>('overview')
  const [monthValue, setMonthValue] = useState(currentMonthValue())
  const [classes, setClasses] = useState<Class[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [classFilter, setClassFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [overviewStatusFilter, setOverviewStatusFilter] = useState('all')
  const [receiptFor, setReceiptFor] = useState<Invoice | null>(null)
  const [historyFor, setHistoryFor] = useState<Student | null>(null)
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null)

  const month = monthValueToDate(monthValue)
  const currentMonth = monthValueToDate(currentMonthValue())

  async function load() {
    setLoading(true)
    const [classesRes, studentsRes] = await Promise.all([
      supabase.from('classes').select('*').order('name'),
      supabase.from('students').select('*').order('full_name'),
    ])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (studentsRes.data) setStudents(studentsRes.data as Student[])

    // Auto-flag any unpaid invoice from a past month as overdue.
    await supabase
      .from('invoices')
      .update({ status: 'overdue' })
      .eq('status', 'unpaid')
      .lt('month', currentMonthValue() + '-01')

    const invoicesRes = await supabase.from('invoices').select('*')
    if (invoicesRes.error) show(invoicesRes.error.message, 'error')
    else setInvoices(invoicesRes.data as Invoice[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const categories = useMemo(
    () => [...new Set(classes.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [classes]
  )
  const enrolledStudents = useMemo(() => students.filter((s) => s.enrollment_status === 'enrolled'), [students])

  const monthInvoices = invoices.filter((i) => i.month === month)
  const filtered = monthInvoices.filter((inv) => {
    if (classFilter !== 'all' && inv.class_id !== classFilter) return false
    if (categoryFilter !== 'all' && classById.get(inv.class_id)?.category !== categoryFilter) return false
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false
    return true
  })

  const totals = useMemo(() => {
    const collected = monthInvoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + netInvoiceAmount(i), 0)
    const due = monthInvoices
      .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
      .reduce((sum, i) => sum + netInvoiceAmount(i), 0)
    return { collected, due }
  }, [monthInvoices])

  // Per-student lifetime paid/due totals and this-month status, for the Fee Overview tab.
  const studentFeeSummaries = useMemo(() => {
    const byStudent = new Map<string, { paid: number; due: number; thisMonthStatus: string | null }>()
    for (const inv of invoices) {
      const entry = byStudent.get(inv.student_id) ?? { paid: 0, due: 0, thisMonthStatus: null }
      if (inv.status === 'paid') entry.paid += netInvoiceAmount(inv)
      else entry.due += netInvoiceAmount(inv)
      if (inv.month === currentMonth) entry.thisMonthStatus = inv.status
      byStudent.set(inv.student_id, entry)
    }
    return enrolledStudents.map((s) => {
      const summary = byStudent.get(s.id) ?? { paid: 0, due: 0, thisMonthStatus: null }
      return {
        student: s,
        totalPaid: summary.paid,
        totalDue: summary.due,
        thisMonthStatus: summary.thisMonthStatus,
      }
    })
  }, [invoices, enrolledStudents, currentMonth])

  const overviewRows = studentFeeSummaries.filter((row) => {
    const cls = row.student.class_id ? classById.get(row.student.class_id) : undefined
    if (classFilter !== 'all' && row.student.class_id !== classFilter) return false
    if (categoryFilter !== 'all' && cls?.category !== categoryFilter) return false
    if (overviewStatusFilter === 'paid_this_month' && row.thisMonthStatus !== 'paid') return false
    if (overviewStatusFilter === 'unpaid_this_month' && row.thisMonthStatus === 'paid') return false
    if (overviewStatusFilter === 'has_due' && row.totalDue <= 0) return false
    return true
  })

  const overviewTotals = useMemo(() => {
    const totalPaidAllTime = studentFeeSummaries.reduce((sum, r) => sum + r.totalPaid, 0)
    const totalDueAllTime = studentFeeSummaries.reduce((sum, r) => sum + r.totalDue, 0)
    return { totalPaidAllTime, totalDueAllTime }
  }, [studentFeeSummaries])

  async function handleGenerate() {
    setGenerating(true)
    const existingStudentIds = new Set(monthInvoices.map((i) => i.student_id))
    const rows = enrolledStudents
      .filter((s) => s.class_id && !existingStudentIds.has(s.id))
      .map((s) => ({
        student_id: s.id,
        class_id: s.class_id!,
        month,
        amount: effectiveFee(s, classById),
        status: 'unpaid' as const,
      }))
    if (rows.length === 0) {
      setGenerating(false)
      show('Invoices already exist for every enrolled student this month.', 'error')
      return
    }
    const { error } = await supabase.from('invoices').insert(rows)
    setGenerating(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Generated ${rows.length} invoice(s) for ${formatMonth(month)}.`)
    load()
  }

  async function markPaid(invoice: Invoice) {
    const { error } = await supabase
      .from('invoices')
      .update({ status: 'paid', payment_date: todayLocalDate() })
      .eq('id', invoice.id)
    if (error) show(error.message, 'error')
    else {
      show('Marked as paid.')
      load()
    }
  }

  async function sendReminder(invoice: Invoice) {
    const student = studentById.get(invoice.student_id)
    if (!student?.guardian_email) {
      show('No guardian email on file for this student.', 'error')
      return
    }
    setSendingReminderId(invoice.id)
    const { data, error } = await supabase.functions.invoke('send-fee-reminder', {
      body: { invoiceId: invoice.id },
    })
    setSendingReminderId(null)
    if (error) {
      show(await edgeFunctionError(error, 'Failed to send reminder.'), 'error')
      return
    }
    const result = data as { error?: string; success?: boolean }
    if (result?.error) {
      show(result.error, 'error')
      return
    }
    show(`Reminder emailed to ${student.guardian_email}.`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Fees</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Student fee overview, monthly invoices, and payments.</p>
        </div>
        <div className="no-print flex gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1">
          <button
            onClick={() => setTab('overview')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'overview' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            Fee Overview
          </button>
          <button
            onClick={() => setTab('monthly')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'monthly' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
          >
            Monthly Invoices
          </button>
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Total Collected (all time)</p>
              <p className="mt-2 text-2xl font-semibold text-green-600">{formatCurrency(overviewTotals.totalPaidAllTime)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Total Remaining (all time)</p>
              <p className="mt-2 text-2xl font-semibold text-red-600 dark:text-red-400">{formatCurrency(overviewTotals.totalDueAllTime)}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
            <Select
              value={overviewStatusFilter}
              onChange={(e) => setOverviewStatusFilter(e.target.value)}
              className="max-w-[200px]"
            >
              <option value="all">All students</option>
              <option value="paid_this_month">Paid this month</option>
              <option value="unpaid_this_month">Not paid this month</option>
              <option value="has_due">Has any remaining due</option>
            </Select>
            <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">{overviewRows.length} students</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">This Month</th>
                  <th className="px-4 py-3">Total Paid</th>
                  <th className="px-4 py-3">Total Remaining</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : overviewRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                      No students match these filters.
                    </td>
                  </tr>
                ) : (
                  overviewRows.map(({ student, totalPaid, totalDue, thisMonthStatus }) => (
                    <tr
                      key={student.id}
                      onClick={() => setHistoryFor(student)}
                      className="cursor-pointer border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{student.full_name}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {student.class_id ? classById.get(student.class_id)?.name ?? '—' : '—'}
                        {student.class_id && classById.get(student.class_id)?.category && (
                          <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                            ({classById.get(student.class_id)?.category})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {thisMonthStatus ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              thisMonthStatus === 'paid'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : thisMonthStatus === 'overdue'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {thisMonthStatus}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Not generated</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-green-700 dark:text-green-400">{formatCurrency(totalPaid)}</td>
                      <td className="px-4 py-3 text-red-600 dark:text-red-400">{formatCurrency(totalDue)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setHistoryFor(student)
                          }}
                          className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                        >
                          View History
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="no-print flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setMonthValue(shiftMonthValue(monthValue, -1))} aria-label="Previous month">
              ‹
            </Button>
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm"
            />
            <Button variant="secondary" onClick={() => setMonthValue(shiftMonthValue(monthValue, 1))} aria-label="Next month">
              ›
            </Button>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate Invoices'}
            </Button>
          </div>

          <div className="no-print grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Collected — {formatMonth(month)}</p>
              <p className="mt-2 text-2xl font-semibold text-green-600">{formatCurrency(totals.collected)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Due — {formatMonth(month)}</p>
              <p className="mt-2 text-2xl font-semibold text-red-600 dark:text-red-400">{formatCurrency(totals.due)}</p>
            </div>
          </div>

          <div className="no-print flex flex-wrap gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[180px]">
              <option value="all">All statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </Select>
            <Button variant="secondary" onClick={() => window.print()}>
              Print List
            </Button>
          </div>

          <div className={receiptFor ? '' : 'print-area'}>
            <div className="hidden print:block">
              <DocumentLetterhead subtitle={`Fee Status · ${formatMonth(month)}`} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Payment Date</th>
                    <th className="no-print px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                        Loading...
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                        No invoices for this month yet. Click "Generate Invoices".
                      </td>
                    </tr>
                  ) : (
                    filtered.map((inv) => (
                      <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                          {studentById.get(inv.student_id)?.full_name ?? 'Unknown'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classById.get(inv.class_id)?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatCurrency(inv.amount)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              inv.status === 'paid'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : inv.status === 'overdue'
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(inv.payment_date)}</td>
                        <td className="no-print px-4 py-3 text-right">
                          {inv.status !== 'paid' && (
                            <>
                              <button onClick={() => markPaid(inv)} className="mr-3 text-sm text-brand-600 hover:underline">
                                Mark Paid
                              </button>
                              <button
                                onClick={() => sendReminder(inv)}
                                disabled={sendingReminderId === inv.id}
                                className="mr-3 text-sm text-amber-600 hover:underline disabled:opacity-50"
                              >
                                {sendingReminderId === inv.id ? 'Sending...' : 'Send Reminder'}
                              </button>
                            </>
                          )}
                          <button onClick={() => setReceiptFor(inv)} className="text-sm text-slate-600 dark:text-slate-300 hover:underline">
                            Receipt
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {receiptFor && (
        <Modal title="Fee Receipt" onClose={() => setReceiptFor(null)}>
          <div className="print-area space-y-4">
            <DocumentLetterhead subtitle="Fee Receipt" />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Receipt No.</span>
                <span className="font-mono">{receiptFor.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Student</span>
                <span>{studentById.get(receiptFor.student_id)?.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Class</span>
                <span>{classById.get(receiptFor.class_id)?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Month</span>
                <span>{formatMonth(receiptFor.month)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Amount</span>
                <span className="font-semibold">{formatCurrency(receiptFor.amount)}</span>
              </div>
              {receiptFor.discount > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Discount</span>
                    <span className="font-semibold">-{formatCurrency(receiptFor.discount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Amount Paid</span>
                    <span className="font-semibold">{formatCurrency(netInvoiceAmount(receiptFor))}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span className="capitalize">{receiptFor.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment Date</span>
                <span>{formatDate(receiptFor.payment_date)}</span>
              </div>
              {receiptFor.due_date && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Due Date</span>
                  <span>{formatDate(receiptFor.due_date)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="no-print mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReceiptFor(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        </Modal>
      )}

      {historyFor && (
        <FeeHistoryModal
          student={historyFor}
          className={historyFor.class_id ? classById.get(historyFor.class_id)?.name ?? '—' : '—'}
          invoices={invoices.filter((i) => i.student_id === historyFor.id).sort((a, b) => b.month.localeCompare(a.month))}
          onClose={() => setHistoryFor(null)}
          onOpenReceipt={(inv) => {
            setHistoryFor(null)
            setReceiptFor(inv)
          }}
        />
      )}
    </div>
  )
}

function FeeHistoryModal({
  student,
  className,
  invoices,
  onClose,
  onOpenReceipt,
}: {
  student: Student
  className: string
  invoices: Invoice[]
  onClose: () => void
  onOpenReceipt: (invoice: Invoice) => void
}) {
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + netInvoiceAmount(i), 0)
  const totalDue = invoices.filter((i) => i.status !== 'paid').reduce((sum, i) => sum + netInvoiceAmount(i), 0)

  return (
    <Modal title={`Fee History — ${student.full_name}`} onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
        <span>{className}</span>
        <div className="flex gap-4">
          <span>
            Total paid: <strong className="text-green-700 dark:text-green-400">{formatCurrency(totalPaid)}</strong>
          </span>
          <span>
            Total remaining: <strong className="text-red-600 dark:text-red-400">{formatCurrency(totalDue)}</strong>
          </span>
        </div>
      </div>
      {invoices.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No invoices recorded for this student yet.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-2 py-2">Month</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Payment Date</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                  <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{formatMonth(inv.month)}</td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatCurrency(inv.amount)}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        inv.status === 'paid'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : inv.status === 'overdue'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatDate(inv.payment_date)}</td>
                  <td className="px-2 py-2 text-right">
                    <button onClick={() => onOpenReceipt(inv)} className="text-sm text-brand-600 hover:underline dark:text-gold-400">
                      Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
