import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { currentMonthValue, formatCurrency, formatMonth, monthValueToDate } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class, Student } from '@/types/database'

export function FeeChallanPage() {
  const { show } = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [classFilter, setClassFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [feeDrafts, setFeeDrafts] = useState<Record<string, string>>({})
  const [challanFor, setChallanFor] = useState<Student | null>(null)
  const [challanMonth, setChallanMonth] = useState(currentMonthValue())

  async function load() {
    setLoading(true)
    const [studentsRes, classesRes] = await Promise.all([
      supabase.from('students').select('*').eq('enrollment_status', 'enrolled').order('full_name'),
      supabase.from('classes').select('*').order('name'),
    ])
    if (studentsRes.error) show(studentsRes.error.message, 'error')
    else setStudents(studentsRes.data as Student[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const categories = useMemo(
    () => [...new Set(classes.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [classes]
  )

  function effectiveFee(s: Student): number {
    if (s.fee_override !== null && s.fee_override !== undefined) return s.fee_override
    return s.class_id ? classById.get(s.class_id)?.fee_amount ?? 0 : 0
  }

  const filtered = students.filter((s) => {
    const cls = s.class_id ? classById.get(s.class_id) : undefined
    if (classFilter !== 'all' && s.class_id !== classFilter) return false
    if (categoryFilter !== 'all' && cls?.category !== categoryFilter) return false
    return true
  })

  async function saveFeeOverride(student: Student) {
    const draft = feeDrafts[student.id]
    if (draft === undefined) return
    const value = Number(draft)
    if (Number.isNaN(value) || value < 0) {
      show('Fee must be a non-negative number.', 'error')
      return
    }
    const { error } = await supabase.from('students').update({ fee_override: value }).eq('id', student.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show(`Updated ${student.full_name}'s fee.`)
    setFeeDrafts((prev) => {
      const next = { ...prev }
      delete next[student.id]
      return next
    })
    load()
  }

  async function toggleAdmissionFee(student: Student) {
    const { error } = await supabase
      .from('students')
      .update({ admission_fee_paid: !student.admission_fee_paid })
      .eq('id', student.id)
    if (error) show(friendlyError(error.message), 'error')
    else load()
  }

  async function toggleSecurityFee(student: Student) {
    const { error } = await supabase
      .from('students')
      .update({ security_fee_paid: !student.security_fee_paid })
      .eq('id', student.id)
    if (error) show(friendlyError(error.message), 'error')
    else load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Fee Challans</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Set each student's fee (defaults from their class) and generate a printable challan.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
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
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Admission Fee</th>
              <th className="px-4 py-3">Security Fee</th>
              <th className="px-4 py-3">Monthly Fee</th>
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
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No students match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-700/60 dark:hover:bg-slate-700/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {s.class_id ? classById.get(s.class_id)?.name ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleAdmissionFee(s)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.admission_fee_paid
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}
                    >
                      {formatCurrency(s.admission_fee_amount)} · {s.admission_fee_paid ? 'Paid' : 'Unpaid'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleSecurityFee(s)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.security_fee_paid
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}
                    >
                      {formatCurrency(s.security_fee_amount)} · {s.security_fee_paid ? 'Paid' : 'Unpaid'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={feeDrafts[s.id] ?? String(effectiveFee(s))}
                        onChange={(e) => setFeeDrafts({ ...feeDrafts, [s.id]: e.target.value })}
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                      />
                      {feeDrafts[s.id] !== undefined && feeDrafts[s.id] !== String(effectiveFee(s)) && (
                        <button onClick={() => saveFeeOverride(s)} className="text-xs text-brand-600 hover:underline dark:text-gold-400">
                          Save
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setChallanMonth(currentMonthValue())
                        setChallanFor(s)
                      }}
                      className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                    >
                      Generate Challan
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {challanFor && (
        <Modal title="Fee Challan" onClose={() => setChallanFor(null)}>
          <div className="print-area space-y-4">
            <div className="text-center">
              <p className="text-lg font-semibold">Al Maktab Educational Institute</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Fee Challan</p>
            </div>
            <div className="no-print">
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Month</label>
              <input
                type="month"
                value={challanMonth}
                onChange={(e) => setChallanMonth(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Student</span>
                <span>{challanFor.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Class</span>
                <span>{challanFor.class_id ? classById.get(challanFor.class_id)?.name : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Month</span>
                <span>{formatMonth(monthValueToDate(challanMonth))}</span>
              </div>
              <div className="my-2 border-t border-slate-200 dark:border-slate-700" />
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Monthly Tuition Fee</span>
                <span className="font-semibold">{formatCurrency(effectiveFee(challanFor))}</span>
              </div>
              {!challanFor.admission_fee_paid && challanFor.admission_fee_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Admission Fee (unpaid)</span>
                  <span className="font-semibold">{formatCurrency(challanFor.admission_fee_amount)}</span>
                </div>
              )}
              {!challanFor.security_fee_paid && challanFor.security_fee_amount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Security Fee (unpaid)</span>
                  <span className="font-semibold">{formatCurrency(challanFor.security_fee_amount)}</span>
                </div>
              )}
              <div className="my-2 border-t border-slate-200 dark:border-slate-700" />
              <div className="flex justify-between text-base">
                <span className="font-semibold">Total Due</span>
                <span className="font-bold">
                  {formatCurrency(
                    effectiveFee(challanFor) +
                      (!challanFor.admission_fee_paid ? challanFor.admission_fee_amount : 0) +
                      (!challanFor.security_fee_paid ? challanFor.security_fee_amount : 0)
                  )}
                </span>
              </div>
            </div>
          </div>
          <div className="no-print mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setChallanFor(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
