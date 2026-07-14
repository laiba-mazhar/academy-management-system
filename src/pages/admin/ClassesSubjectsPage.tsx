import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Input'
import { formatCurrency } from '@/lib/utils'
import { friendlyError } from '@/lib/errors'
import type { Class, Subject } from '@/types/database'

type TeacherOption = { id: string; full_name: string }

export function ClassesSubjectsPage() {
  const { show } = useToast()
  const [classes, setClasses] = useState<Class[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [teachers, setTeachers] = useState<TeacherOption[]>([])
  const [loading, setLoading] = useState(true)

  const [classForm, setClassForm] = useState<{ id: string | null; name: string; fee_amount: string; category: string } | null>(
    null
  )
  const [classError, setClassError] = useState<string | null>(null)
  const [deleteClass, setDeleteClass] = useState<Class | null>(null)

  const [subjectForm, setSubjectForm] = useState<{
    id: string | null
    name: string
    class_id: string
    teacher_id: string
  } | null>(null)
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [deleteSubject, setDeleteSubject] = useState<Subject | null>(null)

  async function load() {
    setLoading(true)
    const [classesRes, subjectsRes, profilesRes] = await Promise.all([
      supabase.from('classes').select('*').order('name'),
      supabase.from('subjects').select('*').order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
    ])
    if (classesRes.error) show(classesRes.error.message, 'error')
    else setClasses(classesRes.data as Class[])
    if (subjectsRes.error) show(subjectsRes.error.message, 'error')
    else setSubjects(subjectsRes.data as Subject[])
    if (profilesRes.error) show(profilesRes.error.message, 'error')
    else setTeachers(profilesRes.data as unknown as TeacherOption[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const pendingSubjects = subjects.filter((s) => s.status === 'pending_approval')
  const activeSubjects = subjects.filter((s) => s.status === 'active')

  async function saveClass() {
    if (!classForm || !classForm.name.trim()) {
      setClassError('Class name is required.')
      return
    }
    const feeAmount = Number(classForm.fee_amount)
    if (Number.isNaN(feeAmount) || feeAmount < 0) {
      setClassError('Fee amount must be a non-negative number.')
      return
    }
    const payload = {
      name: classForm.name.trim(),
      fee_amount: feeAmount,
      category: classForm.category.trim() || null,
    }
    const result = classForm.id
      ? await supabase.from('classes').update(payload).eq('id', classForm.id)
      : await supabase.from('classes').insert(payload)
    if (result.error) {
      setClassError(friendlyError(result.error.message))
      return
    }
    show(classForm.id ? 'Class updated.' : 'Class added.')
    setClassForm(null)
    load()
  }

  async function handleDeleteClass() {
    if (!deleteClass) return
    const { error } = await supabase.from('classes').delete().eq('id', deleteClass.id)
    if (error) show(error.message, 'error')
    else {
      show('Class deleted.')
      load()
    }
    setDeleteClass(null)
  }

  async function saveSubject() {
    if (!subjectForm || !subjectForm.name.trim() || !subjectForm.class_id) {
      setSubjectError('Subject name and class are required.')
      return
    }
    const payload = {
      name: subjectForm.name.trim(),
      class_id: subjectForm.class_id,
      teacher_id: subjectForm.teacher_id || null,
      status: 'active' as const,
    }
    const result = subjectForm.id
      ? await supabase.from('subjects').update(payload).eq('id', subjectForm.id)
      : await supabase.from('subjects').insert(payload)
    if (result.error) {
      setSubjectError(friendlyError(result.error.message))
      return
    }
    show(subjectForm.id ? 'Subject updated.' : 'Subject added.')
    setSubjectForm(null)
    load()
  }

  async function handleDeleteSubject() {
    if (!deleteSubject) return
    const { error } = await supabase.from('subjects').delete().eq('id', deleteSubject.id)
    if (error) show(error.message, 'error')
    else {
      show('Subject deleted.')
      load()
    }
    setDeleteSubject(null)
  }

  async function approveSubject(subject: Subject, teacherId: string) {
    if (!teacherId) {
      show('Pick a teacher to assign before approving.', 'error')
      return
    }
    const { error } = await supabase
      .from('subjects')
      .update({ status: 'active', teacher_id: teacherId })
      .eq('id', subject.id)
    if (error) show(error.message, 'error')
    else {
      show('Subject request approved.')
      load()
    }
  }

  async function rejectSubject(subject: Subject) {
    const { error } = await supabase.from('subjects').delete().eq('id', subject.id)
    if (error) show(error.message, 'error')
    else {
      show('Subject request rejected.')
      load()
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Classes & Subjects</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage class fees, subjects, and teacher assignments.</p>
      </div>

      {pendingSubjects.length > 0 && (
        <PendingApprovalPanel
          pending={pendingSubjects}
          classById={classById}
          teachers={teachers}
          onApprove={approveSubject}
          onReject={rejectSubject}
        />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Classes</h2>
          <Button onClick={() => setClassForm({ id: null, name: '', fee_amount: '0', category: '' })}>+ Add Class</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category / Stream</th>
                <th className="px-4 py-3">Monthly Fee</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : classes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    No classes yet.
                  </td>
                </tr>
              ) : (
                classes.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{c.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.category || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatCurrency(c.fee_amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() =>
                          setClassForm({
                            id: c.id,
                            name: c.name,
                            fee_amount: String(c.fee_amount),
                            category: c.category ?? '',
                          })
                        }
                        className="mr-3 text-sm text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button onClick={() => setDeleteClass(c)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Subjects</h2>
          <Button
            onClick={() => setSubjectForm({ id: null, name: '', class_id: classes[0]?.id ?? '', teacher_id: '' })}
            disabled={classes.length === 0}
          >
            + Add Subject
          </Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {activeSubjects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    No subjects yet.
                  </td>
                </tr>
              ) : (
                activeSubjects.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{s.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classById.get(s.class_id)?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.teacher_id ? teacherById.get(s.teacher_id)?.full_name ?? 'Unknown' : 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() =>
                          setSubjectForm({
                            id: s.id,
                            name: s.name,
                            class_id: s.class_id,
                            teacher_id: s.teacher_id ?? '',
                          })
                        }
                        className="mr-3 text-sm text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button onClick={() => setDeleteSubject(s)} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {classForm && (
        <Modal title={classForm.id ? 'Edit Class' : 'Add Class'} onClose={() => setClassForm(null)}>
          <div className="space-y-3">
            <Field label="Class name">
              <Input value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
            </Field>
            <Field label="Category / stream (optional)">
              <Input
                list="class-category-options"
                placeholder="e.g. Biology, Computer Science, Pre-Medical, Pre-Engineering"
                value={classForm.category}
                onChange={(e) => setClassForm({ ...classForm, category: e.target.value })}
              />
              <datalist id="class-category-options">
                <option value="Biology" />
                <option value="Computer Science" />
                <option value="Pre-Medical" />
                <option value="Pre-Engineering" />
                <option value="General" />
              </datalist>
            </Field>
            <Field label="Monthly fee amount">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={classForm.fee_amount}
                onChange={(e) => setClassForm({ ...classForm, fee_amount: e.target.value })}
              />
            </Field>
            {classError && <p className="text-sm text-red-600 dark:text-red-400">{classError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setClassForm(null)}>
                Cancel
              </Button>
              <Button onClick={saveClass}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {subjectForm && (
        <Modal title={subjectForm.id ? 'Edit Subject' : 'Add Subject'} onClose={() => setSubjectForm(null)}>
          <div className="space-y-3">
            <Field label="Subject name">
              <Input
                value={subjectForm.name}
                onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
              />
            </Field>
            <Field label="Class">
              <Select
                value={subjectForm.class_id}
                onChange={(e) => setSubjectForm({ ...subjectForm, class_id: e.target.value })}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned teacher">
              <Select
                value={subjectForm.teacher_id}
                onChange={(e) => setSubjectForm({ ...subjectForm, teacher_id: e.target.value })}
              >
                <option value="">Unassigned</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            {subjectError && <p className="text-sm text-red-600 dark:text-red-400">{subjectError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSubjectForm(null)}>
                Cancel
              </Button>
              <Button onClick={saveSubject}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteClass && (
        <ConfirmDialog
          title="Delete class"
          message={`Delete ${deleteClass.name}? Its subjects, timetable slots, and exams will also be deleted. Students in this class become unassigned.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteClass(null)}
          onConfirm={handleDeleteClass}
        />
      )}

      {deleteSubject && (
        <ConfirmDialog
          title="Delete subject"
          message={`Delete ${deleteSubject.name}? Its questions, exams, and timetable slots will also be deleted.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteSubject(null)}
          onConfirm={handleDeleteSubject}
        />
      )}
    </div>
  )
}

function PendingApprovalPanel({
  pending,
  classById,
  teachers,
  onApprove,
  onReject,
}: {
  pending: Subject[]
  classById: Map<string, Class>
  teachers: TeacherOption[]
  onApprove: (subject: Subject, teacherId: string) => void
  onReject: (subject: Subject) => void
}) {
  const [picks, setPicks] = useState<Record<string, string>>({})

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-amber-900">
        Pending subject requests ({pending.length})
      </h2>
      <div className="space-y-2">
        {pending.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-slate-800 p-3">
            <div className="text-sm">
              <span className="font-medium text-slate-800 dark:text-slate-100">{s.name}</span>
              <span className="text-slate-500 dark:text-slate-400"> — {classById.get(s.class_id)?.name ?? 'Unknown class'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={picks[s.id] ?? s.requested_by ?? ''}
                onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })}
                className="w-44"
              >
                <option value="">Assign teacher...</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </Select>
              <Button onClick={() => onApprove(s, picks[s.id] ?? s.requested_by ?? '')}>Approve</Button>
              <Button variant="danger" onClick={() => onReject(s)}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
