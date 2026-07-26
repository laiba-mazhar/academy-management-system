// Sends a student's exam result to their guardian over WhatsApp via SendPK
// (wa.sendpk.com). Runs server-side because it needs the SendPK API key, which
// must never reach the browser — same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy send-result-whatsapp
// Requires two secrets (set them yourself so the key never lives in the repo):
//   supabase secrets set SENDPK_API_KEY=your-api-key
//   supabase secrets set SENDPK_TEMPLATE_ID=your-approved-template-id
//
// The template must be approved by WhatsApp/Meta first, with SEVEN variables in
// this exact order (see README): {{1}} guardian, {{2}} student, {{3}} marks,
// {{4}} total marks, {{5}} subject, {{6}} exam name, {{7}} Pass/Fail. If your
// approved template uses different variable placeholder keys, adjust
// `template_data` below.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SENDPK_API_KEY = Deno.env.get('SENDPK_API_KEY')
const SENDPK_TEMPLATE_ID = Deno.env.get('SENDPK_TEMPLATE_ID')
const SENDPK_ENDPOINT = 'https://wa.sendpk.com/api/send.php'

// Mirrors PASS_THRESHOLD in the admin/teacher dashboards — if your institute
// changes the passing mark, update it there and here together.
const PASS_THRESHOLD = 40

// Mirrors src/lib/utils.ts:toPakistaniMsisdn — kept in sync by hand since the
// edge function (Deno) can't import from the Vite app's src tree.
function toPakistaniMsisdn(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0092')) digits = digits.slice(2)
  else if (digits.startsWith('92')) { /* already country-coded */ }
  else if (digits.startsWith('0')) digits = '92' + digits.slice(1)
  else if (digits.length === 10 && digits.startsWith('3')) digits = '92' + digits
  return /^923\d{9}$/.test(digits) ? digits : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!SENDPK_API_KEY || !SENDPK_TEMPLATE_ID) {
    return jsonResponse(
      {
        error:
          'SendPK is not configured. Run: supabase secrets set SENDPK_API_KEY=your-key SENDPK_TEMPLATE_ID=your-template-id',
      },
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

  // Marks entry is a teacher (and admin) workflow, so both roles may notify.
  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'teacher') {
    return jsonResponse({ error: 'Only admins and teachers can send result messages' }, 403)
  }

  const body = await req.json().catch(() => null)
  const examId = body?.examId as string | undefined
  const requestedStudentIds = Array.isArray(body?.studentIds) ? (body.studentIds as string[]) : null
  if (!examId) {
    return jsonResponse({ error: 'examId is required' }, 400)
  }

  const { data: exam, error: examError } = await adminClient
    .from('exams')
    .select('id, name, total_marks, subject_id, class_id')
    .eq('id', examId)
    .single()
  if (examError || !exam) {
    return jsonResponse({ error: 'Exam not found' }, 404)
  }

  const { data: subject } = await adminClient.from('subjects').select('name').eq('id', exam.subject_id).single()
  const subjectName = subject?.name ?? 'the subject'

  // Only students who actually have a recorded result can be notified.
  let resultsQuery = adminClient.from('exam_results').select('id, student_id, marks_obtained').eq('exam_id', examId)
  if (requestedStudentIds && requestedStudentIds.length > 0) {
    resultsQuery = resultsQuery.in('student_id', requestedStudentIds)
  }
  const { data: results, error: resultsError } = await resultsQuery
  if (resultsError) {
    return jsonResponse({ error: resultsError.message }, 500)
  }
  if (!results || results.length === 0) {
    return jsonResponse({ error: 'No saved results found for the selected student(s).' }, 400)
  }

  const studentIds = results.map((r) => r.student_id)
  const { data: students } = await adminClient
    .from('students')
    .select('id, full_name, guardian_name, guardian_phone')
    .in('id', studentIds)
  const studentById = new Map((students ?? []).map((s) => [s.id, s]))

  const outcomes: { studentId: string; ok: boolean; error?: string }[] = []

  for (const result of results) {
    const student = studentById.get(result.student_id)
    if (!student) {
      outcomes.push({ studentId: result.student_id, ok: false, error: 'Student record not found.' })
      continue
    }
    const mobile = toPakistaniMsisdn(student.guardian_phone)
    if (!mobile) {
      outcomes.push({ studentId: result.student_id, ok: false, error: 'No valid guardian phone on file.' })
      continue
    }

    // Guard against a zero/invalid total so a bad exam row can't report a
    // pass off a division by zero.
    const pct = exam.total_marks > 0 ? (result.marks_obtained / exam.total_marks) * 100 : 0
    const passLabel = pct >= PASS_THRESHOLD ? 'Pass' : 'Fail'

    // Variable order MUST match the approved template (see README).
    const templateData = [
      {
        mobile,
        '1': student.guardian_name ?? 'Parent/Guardian',
        '2': student.full_name,
        '3': String(result.marks_obtained),
        '4': String(exam.total_marks),
        '5': subjectName,
        '6': exam.name,
        '7': passLabel,
      },
    ]

    const form = new URLSearchParams({
      api_key: SENDPK_API_KEY,
      template_id: SENDPK_TEMPLATE_ID,
      template_data: JSON.stringify(templateData),
    })

    try {
      const res = await fetch(SENDPK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      const text = await res.text()
      // SendPK can return 200 with an error payload, so check both the status
      // and the body for a failure signal before counting it as sent.
      const looksFailed =
        !res.ok || /"?(status|success)"?\s*[:=]\s*"?(error|false|0|failed)"?/i.test(text) || /error/i.test(text)
      if (looksFailed) {
        outcomes.push({
          studentId: result.student_id,
          ok: false,
          error: text.slice(0, 300) || `SendPK returned status ${res.status}`,
        })
        continue
      }
      await adminClient
        .from('exam_results')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', result.id)
      outcomes.push({ studentId: result.student_id, ok: true })
    } catch (err) {
      outcomes.push({ studentId: result.student_id, ok: false, error: (err as Error).message })
    }
  }

  const sent = outcomes.filter((o) => o.ok).length
  return jsonResponse({ success: sent > 0, sent, total: outcomes.length, results: outcomes })
})
