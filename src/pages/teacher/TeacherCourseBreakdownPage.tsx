import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Input'
import { formatDate, formatDateTime, generateCourseSlots } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class, CourseBreakdown, CourseBreakdownSlot, PlannerType, Subject } from '@/types/database'

export function TeacherCourseBreakdownPage() {
  const { show } = useToast()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [breakdowns, setBreakdowns] = useState<CourseBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [slots, setSlots] = useState<CourseBreakdownSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    subject_id: '',
    total_chapters: '10',
    start_date: '',
    end_date: '',
    planner_type: 'weekly' as PlannerType,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [subjectsRes, classesRes, breakdownsRes] = await Promise.all([
      supabase.from('subjects').select('*').eq('status', 'active'),
      supabase.from('classes').select('*'),
      supabase.from('course_breakdowns').select('*').order('start_date', { ascending: false }),
    ])
    if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[])
    if (classesRes.data) setClasses(classesRes.data as Class[])
    if (breakdownsRes.error) show(breakdownsRes.error.message, 'error')
    else setBreakdowns(breakdownsRes.data as CourseBreakdown[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  function openCreate() {
    setEditingId(null)
    setForm({
      subject_id: subjects[0]?.id ?? '',
      total_chapters: '10',
      start_date: '',
      end_date: '',
      planner_type: 'weekly',
    })
    setError(null)
    setShowForm(true)
  }

  function openEdit(b: CourseBreakdown) {
    setEditingId(b.id)
    setForm({
      subject_id: b.subject_id,
      total_chapters: String(b.total_chapters),
      start_date: b.start_date,
      end_date: b.end_date,
      planner_type: b.planner_type,
    })
    setError(null)
    setShowForm(true)
  }

  async function regenerateSlots(breakdownId: string) {
    const slotRanges = generateCourseSlots(form.start_date, form.end_date, form.planner_type)
    const slotRows = slotRanges.map((r, idx) => ({
      course_breakdown_id: breakdownId,
      slot_number: idx + 1,
      slot_start: r.start,
      slot_end: r.end,
      chapters: '',
      is_done: false,
    }))
    await supabase.from('course_breakdown_slots').delete().eq('course_breakdown_id', breakdownId)
    return supabase.from('course_breakdown_slots').insert(slotRows)
  }

  async function handleSave() {
    if (!form.subject_id || !form.start_date || !form.end_date) {
      setError('Subject, start date, and end date are required.')
      return
    }
    if (form.end_date <= form.start_date) {
      setError('End date must be after start date.')
      return
    }
    const totalChapters = Number(form.total_chapters)
    if (Number.isNaN(totalChapters) || totalChapters <= 0) {
      setError('Total chapters must be a positive number.')
      return
    }

    const original = editingId ? breakdowns.find((b) => b.id === editingId) ?? null : null
    const scheduleChanged =
      !!original &&
      (original.start_date !== form.start_date ||
        original.end_date !== form.end_date ||
        original.planner_type !== form.planner_type)

    if (scheduleChanged) {
      const confirmed = window.confirm(
        'Changing the date range or planner interval will reset the weekly/biweekly/monthly slots — any chapters already filled in or marked done will be lost. Continue?'
      )
      if (!confirmed) return
    }

    setSaving(true)

    if (editingId) {
      const { error: updateError } = await supabase
        .from('course_breakdowns')
        .update({
          subject_id: form.subject_id,
          planner_type: form.planner_type,
          total_chapters: totalChapters,
          start_date: form.start_date,
          end_date: form.end_date,
        })
        .eq('id', editingId)

      if (updateError) {
        setSaving(false)
        setError(friendlyError(updateError.message))
        return
      }

      if (scheduleChanged) {
        const { error: slotsError } = await regenerateSlots(editingId)
        if (slotsError) {
          setSaving(false)
          setError(friendlyError(slotsError.message))
          return
        }
      }

      setSaving(false)
      show('Course breakdown plan updated.')
      setShowForm(false)
      load()
      if (openId === editingId) openDetail(editingId)
      return
    }

    const { data: breakdown, error: breakdownError } = await supabase
      .from('course_breakdowns')
      .insert({
        subject_id: form.subject_id,
        planner_type: form.planner_type,
        total_chapters: totalChapters,
        start_date: form.start_date,
        end_date: form.end_date,
      })
      .select()
      .single()

    if (breakdownError || !breakdown) {
      setSaving(false)
      setError(friendlyError(breakdownError?.message ?? 'Failed to create plan.'))
      return
    }

    const slotRanges = generateCourseSlots(form.start_date, form.end_date, form.planner_type)
    const slotRows = slotRanges.map((r, idx) => ({
      course_breakdown_id: (breakdown as CourseBreakdown).id,
      slot_number: idx + 1,
      slot_start: r.start,
      slot_end: r.end,
      chapters: '',
      is_done: false,
    }))
    const { error: slotsError } = await supabase.from('course_breakdown_slots').insert(slotRows)
    setSaving(false)
    if (slotsError) {
      setError(friendlyError(slotsError.message))
      return
    }
    show('Course breakdown plan created.')
    setShowForm(false)
    load()
  }

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

  async function updateSlot(slot: CourseBreakdownSlot, patch: Partial<CourseBreakdownSlot>) {
    const { error } = await supabase.from('course_breakdown_slots').update(patch).eq('id', slot.id)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    setSlots((prev) => prev.map((s) => (s.id === slot.id ? { ...s, ...patch } : s)))
  }

  async function deleteBreakdown(id: string) {
    const { error } = await supabase.from('course_breakdowns').delete().eq('id', id)
    if (error) show(friendlyError(error.message), 'error')
    else {
      show('Plan deleted.')
      setOpenId(null)
      load()
    }
  }

  const openBreakdown = breakdowns.find((b) => b.id === openId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Course Breakdown</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Plan how you'll pace your chapters across the term.
          </p>
        </div>
        <Button onClick={openCreate} disabled={subjects.length === 0}>
          + New Plan
        </Button>
      </div>

      {loading ? (
        <p className="text-slate-400 dark:text-slate-500">Loading...</p>
      ) : breakdowns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500">
          No course breakdown plans yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Planner</th>
                <th className="px-4 py-3">Chapters</th>
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
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{subject?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {subject ? classById.get(subject.class_id)?.name ?? '—' : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {formatDate(b.start_date)} – {formatDate(b.end_date)}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-300">{b.planner_type}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{b.total_chapters}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(b.id)
                        }}
                        className="text-sm text-brand-600 hover:underline dark:text-gold-400"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? 'Edit Course Breakdown Plan' : 'New Course Breakdown Plan'} onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <Field label="Subject">
              <Select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({classById.get(s.class_id)?.name ?? '?'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Total chapters">
              <Input
                type="number"
                min="1"
                value={form.total_chapters}
                onChange={(e) => setForm({ ...form, total_chapters: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </Field>
              <Field label="End date">
                <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </Field>
            </div>
            <Field label="Planner interval">
              <Select
                value={form.planner_type}
                onChange={(e) => setForm({ ...form, planner_type: e.target.value as PlannerType })}
              >
                <option value="weekly">Weekly (7 days)</option>
                <option value="biweekly">Biweekly (15 days)</option>
                <option value="monthly">Monthly (30 days)</option>
              </Select>
            </Field>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Plan'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {openBreakdown && (
        <Modal
          title={`${subjectById.get(openBreakdown.subject_id)?.name ?? 'Subject'} — Course Breakdown`}
          onClose={() => setOpenId(null)}
          wide
        >
          <div className="mb-1 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>
              {formatDate(openBreakdown.start_date)} – {formatDate(openBreakdown.end_date)} ·{' '}
              {openBreakdown.total_chapters} chapters · {openBreakdown.planner_type}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => openEdit(openBreakdown)}
                className="text-sm text-brand-600 hover:underline dark:text-gold-400"
              >
                Edit Plan
              </button>
              <button
                onClick={() => deleteBreakdown(openBreakdown.id)}
                className="text-sm text-red-600 hover:underline dark:text-red-400"
              >
                Delete Plan
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
            Created {formatDateTime(openBreakdown.created_at)} · Last updated {formatDateTime(openBreakdown.updated_at)}
          </p>
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
                    <th className="px-2 py-2">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{slot.slot_number}</td>
                      <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                        {formatDate(slot.slot_start)} – {formatDate(slot.slot_end)}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          defaultValue={slot.chapters ?? ''}
                          onBlur={(e) => updateSlot(slot, { chapters: e.target.value })}
                          placeholder="e.g. Chapters 1-2"
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={slot.is_done}
                          onChange={(e) => updateSlot(slot, { is_done: e.target.checked })}
                          className="h-4 w-4"
                        />
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
