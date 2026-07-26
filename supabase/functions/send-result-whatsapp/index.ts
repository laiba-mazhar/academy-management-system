// Sends a student's exam result to their guardian over WhatsApp via Meta's
// WhatsApp Cloud API. Runs server-side because it needs the access token,
// which must never reach the browser — same reasoning as the other edge
// functions.
//
// Deploy: supabase functions deploy send-result-whatsapp
// Required secrets (set them yourself so the token never lives in the repo):
//   supabase secrets set WHATSAPP_ACCESS_TOKEN=your-token
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
// Optional overrides:
//   WHATSAPP_TEMPLATE_NAME (default "result_notification")
//   WHATSAPP_TEMPLATE_LANG (default "en")
//   WHATSAPP_API_VERSION   (default "v23.0")
//
// The template must be approved in WhatsApp Manager with SIX body variables in
// this exact order (see README): {{1}} guardian, {{2}} student, {{3}} marks,
// {{4}} total marks, {{5}} subject, {{6}} exam name.
//
// Testing note: Meta's free test number only delivers to recipient numbers you
// have explicitly added in the developer dashboard, and its quick-start access
// token expires after 24 hours — a 401/190 from Meta usually means the token
// expired, not that this function is broken.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'result_notification'
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'en'
const API_VERSION = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v23.0'

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

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return jsonResponse(
      {
        error:
          'WhatsApp is not configured. Run: supabase secrets set WHATSAPP_ACCESS_TOKEN=your-token WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id',
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

  const endpoint = `https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`
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

    // Parameter order MUST match the approved template (see README).
    const variables = [
      student.guardian_name ?? 'Parent/Guardian',
      student.full_name,
      String(result.marks_obtained),
      String(exam.total_marks),
      subjectName,
      exam.name,
    ]

    const payload = {
      messaging_product: 'whatsapp',
      to: mobile,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: variables.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok || resBody?.error) {
        // Meta's error messages are specific and actionable (expired token,
        // recipient not in the test allow-list, template not approved) — pass
        // them straight through rather than flattening to a generic failure.
        outcomes.push({
          studentId: result.student_id,
          ok: false,
          error: resBody?.error?.message ?? `WhatsApp API returned status ${res.status}`,
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
