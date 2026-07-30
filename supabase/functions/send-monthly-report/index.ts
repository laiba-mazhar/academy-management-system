// Emails a guardian a combined attendance + exam report for one student for
// one month. Manual/test-trigger only for now — invoked per student from the
// admin UI. No automated month-end scheduling is wired up yet; that's a
// deliberate next step once someone has reviewed how these emails look.
//
// Deploy: supabase functions deploy send-monthly-report
// Requires the RESEND_API_KEY secret (shared with send-fee-reminder):
//   supabase secrets set RESEND_API_KEY=...
//
// Sandbox note: until you verify a domain in Resend, emails can only be
// delivered to the address you signed up to Resend with — any other
// recipient will be rejected by Resend, not by this function.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS = Deno.env.get('REMINDER_FROM_ADDRESS') ?? '"Maktab - The Educational Institute" <onboarding@resend.dev>'

function addMonths(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!RESEND_API_KEY) {
    return jsonResponse(
      { error: 'RESEND_API_KEY is not configured. Run: supabase secrets set RESEND_API_KEY=your-key' },
      500
    )
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace('Bearer ', '')
  if (!callerToken) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: callerUser, error: callerError } = await adminClient.auth.getUser(callerToken)
  if (callerError || !callerUser?.user) {
    return jsonResponse({ error: 'Invalid session' }, 401)
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.user.id)
    .single()

  if (callerProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Only admins can send monthly reports' }, 403)
  }

  const body = await req.json().catch(() => null)
  const studentId = body?.studentId
  const month = body?.month // 'YYYY-MM-01'
  if (!studentId || !month) {
    return jsonResponse({ error: 'studentId and month are required' }, 400)
  }

  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('full_name, guardian_name, guardian_email, class_id')
    .eq('id', studentId)
    .single()
  if (studentError || !student) {
    return jsonResponse({ error: 'Student not found' }, 404)
  }
  if (!student.guardian_email) {
    return jsonResponse({ error: 'No guardian email on file for this student' }, 400)
  }

  const monthStart = month
  const monthEnd = addMonths(month, 1)
  const monthLabel = new Date(monthStart + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  const { data: klass } = student.class_id
    ? await adminClient.from('classes').select('name').eq('id', student.class_id).single()
    : { data: null }

  const { data: attendanceRows } = await adminClient
    .from('attendance')
    .select('status')
    .eq('student_id', studentId)
    .gte('date', monthStart)
    .lt('date', monthEnd)

  const attendance = attendanceRows ?? []
  const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length
  const total = attendance.length
  const attendancePercent = total > 0 ? Math.round((present / total) * 1000) / 10 : null

  let examRows: { name: string; subjectName: string; obtained: number; total: number }[] = []
  if (student.class_id) {
    const { data: exams } = await adminClient
      .from('exams')
      .select('id, name, subject_id, total_marks')
      .eq('class_id', student.class_id)
      .gte('exam_date', monthStart)
      .lt('exam_date', monthEnd)

    if (exams && exams.length > 0) {
      const examIds = exams.map((e) => e.id)
      const { data: results } = await adminClient
        .from('exam_results')
        .select('exam_id, marks_obtained')
        .eq('student_id', studentId)
        .in('exam_id', examIds)

      const subjectIds = [...new Set(exams.map((e) => e.subject_id))]
      const { data: subjects } = subjectIds.length
        ? await adminClient.from('subjects').select('id, name').in('id', subjectIds)
        : { data: [] as { id: string; name: string }[] }
      const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]))
      const resultByExamId = new Map((results ?? []).map((r) => [r.exam_id, r.marks_obtained]))

      examRows = exams
        .filter((e) => resultByExamId.has(e.id))
        .map((e) => ({
          name: e.name,
          subjectName: subjectNameById.get(e.subject_id) ?? '—',
          obtained: resultByExamId.get(e.id)!,
          total: e.total_marks,
        }))
    }
  }

  const attendanceSection =
    total > 0
      ? `
      <h3 style="color: #7a1f2e; margin-bottom: 4px;">Attendance</h3>
      <p style="margin-top: 0;">Present: <strong>${present}</strong> / ${total} days recorded (<strong>${attendancePercent}%</strong>)</p>
    `
      : `
      <h3 style="color: #7a1f2e; margin-bottom: 4px;">Attendance</h3>
      <p style="margin-top: 0; color: #666;">No attendance was recorded for this month.</p>
    `

  // Per the "no exams that month → no exam section" requirement, this block
  // is omitted from the email entirely rather than shown as an empty state.
  const examSection =
    examRows.length > 0
      ? `
      <h3 style="color: #7a1f2e; margin-bottom: 4px;">Exam Results</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="text-align: left; border-bottom: 1px solid #ddd;">
            <th style="padding: 4px 0;">Exam</th>
            <th style="padding: 4px 0;">Subject</th>
            <th style="padding: 4px 0;">Marks</th>
          </tr>
        </thead>
        <tbody>
          ${examRows
            .map(
              (r) => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 4px 0;">${r.name}</td>
              <td style="padding: 4px 0;">${r.subjectName}</td>
              <td style="padding: 4px 0;">${r.obtained} / ${r.total}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `
      : ''

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #7a1f2e;">Maktab - The Educational Institute</h2>
      <p>Dear ${student.guardian_name ?? 'Parent/Guardian'},</p>
      <p>Here is <strong>${student.full_name}</strong>'s report${klass?.name ? ` (${klass.name})` : ''} for <strong>${monthLabel}</strong>.</p>
      ${attendanceSection}
      ${examSection}
      <p style="margin-top: 24px;">Thank you,<br/>Maktab - The Educational Institute</p>
    </div>
  `

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [student.guardian_email],
      subject: `Monthly Report — ${student.full_name} — ${monthLabel}`,
      html,
    }),
  })

  const resendBody = await resendRes.json().catch(() => ({}))

  if (!resendRes.ok) {
    return jsonResponse(
      { error: resendBody?.message ?? `Resend rejected the email (status ${resendRes.status})`, resend: resendBody },
      502
    )
  }

  await adminClient
    .from('monthly_reports')
    .upsert({ student_id: studentId, month: monthStart, sent_at: new Date().toISOString() }, { onConflict: 'student_id,month' })

  return jsonResponse({ success: true, to: student.guardian_email, hadExams: examRows.length > 0 })
})
