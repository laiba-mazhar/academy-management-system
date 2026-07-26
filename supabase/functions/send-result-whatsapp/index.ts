// Sends a student's exam result to their guardian's phone via the httpsms
// gateway (an Android phone acting as the sender). Must run server-side
// because it needs the httpsms API key, which must never reach the browser —
// same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy send-result-whatsapp
// Requires these secrets:
//   supabase secrets set MESSAGE_PROVIDER=httpsms
//   supabase secrets set HTTPSMS_API_KEY=your-api-key
//   supabase secrets set HTTPSMS_FROM=+923057666707

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MESSAGE_PROVIDER = Deno.env.get('MESSAGE_PROVIDER') ?? 'httpsms'
const HTTPSMS_API_KEY = Deno.env.get('HTTPSMS_API_KEY')
const HTTPSMS_FROM = Deno.env.get('HTTPSMS_FROM')

// Guardian phone numbers are entered loosely (local format, spaces, dashes —
// see isValidPhone on the frontend) but httpsms requires E.164. Pakistani
// mobile numbers are the only case this school enters, so a local "0..."
// number is normalized to "+92...int"; anything already starting with "+" is
// assumed to already carry its country code.
function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`
  return `+${digits}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (MESSAGE_PROVIDER !== 'httpsms') {
    return jsonResponse({ error: `Unsupported MESSAGE_PROVIDER "${MESSAGE_PROVIDER}"` }, 500)
  }
  if (!HTTPSMS_API_KEY || !HTTPSMS_FROM) {
    return jsonResponse(
      {
        error:
          'HTTPSMS_API_KEY / HTTPSMS_FROM are not configured. Run: supabase secrets set HTTPSMS_API_KEY=... and supabase secrets set HTTPSMS_FROM=...',
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

  const body = await req.json().catch(() => null)
  const examResultId = body?.examResultId
  if (!examResultId) {
    return jsonResponse({ error: 'examResultId is required' }, 400)
  }

  const { data: result, error: resultError } = await adminClient
    .from('exam_results')
    .select('*')
    .eq('id', examResultId)
    .single()
  if (resultError || !result) {
    return jsonResponse({ error: 'Exam result not found' }, 404)
  }

  const { data: exam, error: examError } = await adminClient
    .from('exams')
    .select('*')
    .eq('id', result.exam_id)
    .single()
  if (examError || !exam) {
    return jsonResponse({ error: 'Exam not found' }, 404)
  }

  const { data: subject } = await adminClient.from('subjects').select('*').eq('id', exam.subject_id).single()

  const isAdmin = callerProfile?.role === 'admin'
  const isOwningTeacher = subject?.teacher_id === callerUser.user.id
  if (!isAdmin && !isOwningTeacher) {
    return jsonResponse({ error: 'Only an admin or that subject\'s teacher can send this result' }, 403)
  }

  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('full_name, guardian_name, guardian_phone')
    .eq('id', result.student_id)
    .single()
  if (studentError || !student) {
    return jsonResponse({ error: 'Student not found' }, 404)
  }
  if (!student.guardian_phone) {
    return jsonResponse({ error: 'No guardian phone on file for this student' }, 400)
  }

  const percent = Math.round((result.marks_obtained / exam.total_marks) * 1000) / 10
  const message =
    `Dear ${student.guardian_name ?? 'Parent/Guardian'}, ${student.full_name} obtained ` +
    `${result.marks_obtained}/${exam.total_marks} (${percent}%) in ${exam.name}` +
    `${subject?.name ? ` (${subject.name})` : ''}. - Maktab - The Educational Institute`

  const smsRes = await fetch('https://api.httpsms.com/v1/messages/send', {
    method: 'POST',
    headers: {
      'x-api-key': HTTPSMS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: message,
      from: HTTPSMS_FROM,
      to: toE164(student.guardian_phone),
    }),
  })

  const smsBody = await smsRes.json().catch(() => ({}))

  if (!smsRes.ok) {
    return jsonResponse(
      { error: smsBody?.message ?? `httpsms rejected the message (status ${smsRes.status})`, httpsms: smsBody },
      502
    )
  }

  await adminClient
    .from('exam_results')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', examResultId)

  return jsonResponse({ success: true, to: student.guardian_phone })
})
