// Sends a student's exam result to their guardian over WhatsApp. Runs
// server-side because it needs provider credentials, which must never reach
// the browser — same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy send-result-whatsapp
//
// Four providers are supported; pick one with the MESSAGE_PROVIDER secret.
//
//   MESSAGE_PROVIDER=httpsms  — cheapest. Sends through an Android phone
//     running the httpSMS app on an ordinary carrier SMS bundle (a Jazz/Telenor
//     monthly bundle works out around PKR 0.004-0.008 per SMS against ~PKR 1+
//     from a commercial gateway). httpSMS itself is free and the phone polls
//     their relay, so no port-forwarding is needed.
//       supabase secrets set MESSAGE_PROVIDER=httpsms
//       supabase secrets set HTTPSMS_API_KEY=your-api-key
//       supabase secrets set HTTPSMS_FROM=+92XXXXXXXXXX   # the phone's own number
//     Optional: HTTPSMS_ENDPOINT (defaults to their v1 send URL).
//     Caveats worth knowing before relying on this: consumer bundles are sold
//     for personal use and carriers cap daily SMS (often 300-500) and can block
//     a SIM that looks like a bulk sender; throughput is roughly one SMS every
//     few seconds; and the sender shows as the SIM's number, never a brand.
//
//   MESSAGE_PROVIDER=sms      — SendPK SMS. The only channel here that does
//     not depend on a Meta WhatsApp Business Account, so it keeps working when
//     a Meta business portfolio is restricted. Cheapest per message, but the
//     copy is trimmed to fit one 160-character SMS (see composeSms).
//       supabase secrets set MESSAGE_PROVIDER=sms
//       supabase secrets set SENDPK_SMS_USERNAME=your-username
//       supabase secrets set SENDPK_SMS_PASSWORD=your-password
//       supabase secrets set SENDPK_SMS_SENDER=Maktab
//     A branded sender ID needs PTA/NTN registration; without one the gateway
//     falls back to its own numeric sender.
//
//   MESSAGE_PROVIDER=twilio   — testing. Twilio's WhatsApp sandbox needs no
//     Meta business account and no approved template (it sends free-form text
//     inside the 24h window that opens when a recipient sends the join code to
//     the sandbox number). Sandbox sessions expire after ~3 days; the
//     recipient just re-sends the join code.
//       supabase secrets set MESSAGE_PROVIDER=twilio
//       supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxx
//       supabase secrets set TWILIO_AUTH_TOKEN=your-auth-token
//       supabase secrets set TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
//
//   MESSAGE_PROVIDER=meta     — production. Meta's WhatsApp Cloud API, using
//     an approved template with SEVEN body variables in this exact order (see
//     README): {{1}} guardian, {{2}} student, {{3}} marks, {{4}} total marks,
//     {{5}} subject, {{6}} exam name, {{7}} Pass/Fail.
//       supabase secrets set MESSAGE_PROVIDER=meta
//       supabase secrets set WHATSAPP_ACCESS_TOKEN=your-token
//       supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
//     Optional: WHATSAPP_TEMPLATE_NAME (default "result_notification"),
//     WHATSAPP_TEMPLATE_LANG (default "en"), WHATSAPP_API_VERSION (default
//     "v23.0"). Meta's quick-start token expires after 24 hours — a 401/190
//     means the token expired, not that this function is broken.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const PROVIDER = (Deno.env.get('MESSAGE_PROVIDER') ?? 'meta').toLowerCase()

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? 'whatsapp:+14155238886'

const HTTPSMS_API_KEY = Deno.env.get('HTTPSMS_API_KEY')
const HTTPSMS_FROM = Deno.env.get('HTTPSMS_FROM')
const HTTPSMS_ENDPOINT = Deno.env.get('HTTPSMS_ENDPOINT') ?? 'https://api.httpsms.com/v1/messages/send'

const SENDPK_SMS_USERNAME = Deno.env.get('SENDPK_SMS_USERNAME')
const SENDPK_SMS_PASSWORD = Deno.env.get('SENDPK_SMS_PASSWORD')
const SENDPK_SMS_SENDER = Deno.env.get('SENDPK_SMS_SENDER') ?? 'Maktab'

const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'result_notification'
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'en'
const API_VERSION = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v23.0'

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

type SendResult = { ok: boolean; error?: string }

// The seven values below are positional: they fill {{1}}..{{7}} of the Meta
// template, and the same order is rendered into prose for Twilio.
function composeMessage(v: string[]): string {
  const [guardian, student, marks, total, subject, examName, passLabel] = v
  return (
    `Dear ${guardian}, your child ${student} scored ${marks} out of ${total} marks in ` +
    `${subject} (${examName}). Result: ${passLabel}. For any questions, please contact ` +
    `the school office. Thank you, Maktab - The Educational Institute.`
  )
}

// SMS bills per 160 characters, so this deliberately drops the salutation and
// sign-off that the WhatsApp copy carries — it keeps the whole message inside
// a single billable part (~80 chars) instead of spilling into a second one.
function composeSms(v: string[]): string {
  const [, student, marks, total, subject, examName, passLabel] = v
  return `Maktab: ${student} scored ${marks}/${total} in ${subject} (${examName}). Result: ${passLabel}.`
}

// Sends through an Android phone running the httpSMS app, using whatever SMS
// bundle that phone's SIM is on — the cheapest route by a wide margin, since a
// carrier bundle costs a fraction of a paisa per message against ~PKR 1+ from a
// commercial gateway. The phone polls httpSMS, so no port-forwarding or static
// IP is needed. Endpoint and field names are overridable because their API
// reference is not publicly fetchable; a shape change is then a secret edit
// rather than a redeploy.
async function sendViaHttpSms(mobile: string, variables: string[]): Promise<SendResult> {
  const res = await fetch(HTTPSMS_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': HTTPSMS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: composeSms(variables),
      from: HTTPSMS_FROM,
      to: `+${mobile}`,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, error: text.slice(0, 300) || `httpSMS returned status ${res.status}` }
  }
  return { ok: true }
}

async function sendViaSendpkSms(mobile: string, variables: string[]): Promise<SendResult> {
  // Credentials go in the POST body rather than the query string the docs show,
  // so the account password stays out of proxy/access logs. Their endpoint is
  // PHP and reads either; switch to a GET URL if a future change breaks this.
  const form = new URLSearchParams({
    username: SENDPK_SMS_USERNAME!,
    password: SENDPK_SMS_PASSWORD!,
    sender: SENDPK_SMS_SENDER,
    mobile,
    message: composeSms(variables),
  })
  const res = await fetch('https://sendpk.com/api/sms.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const text = (await res.text()).trim()
  // The gateway answers with a plain-text status rather than JSON, and returns
  // 200 even for rejections, so the body has to be inspected for a failure word.
  if (!res.ok || /error|invalid|fail|insufficient|denied/i.test(text)) {
    return { ok: false, error: text.slice(0, 300) || `SMS gateway returned status ${res.status}` }
  }
  return { ok: true }
}

async function sendViaTwilio(mobile: string, variables: string[]): Promise<SendResult> {
  const form = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: `whatsapp:+${mobile}`,
    Body: composeMessage(variables),
  })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    }
  )
  const body = await res.json().catch(() => ({}))
  // Twilio's messages are specific ("recipient has not joined the sandbox",
  // "unverified number on trial account") — surface them rather than a
  // generic failure.
  if (!res.ok || body?.error_code) {
    return { ok: false, error: body?.message ?? `Twilio returned status ${res.status}` }
  }
  return { ok: true }
}

async function sendViaMeta(mobile: string, variables: string[]): Promise<SendResult> {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: mobile,
        type: 'template',
        template: {
          name: TEMPLATE_NAME,
          language: { code: TEMPLATE_LANG },
          components: [{ type: 'body', parameters: variables.map((text) => ({ type: 'text', text })) }],
        },
      }),
    }
  )
  const body = await res.json().catch(() => ({}))
  // Meta's error messages are actionable (expired token, recipient not in the
  // test allow-list, template not approved) — pass them straight through.
  if (!res.ok || body?.error) {
    return { ok: false, error: body?.error?.message ?? `WhatsApp API returned status ${res.status}` }
  }
  return { ok: true }
}

// Returns an error string when the selected provider isn't fully configured,
// so a misconfiguration fails loudly up front instead of once per student.
function providerConfigError(): string | null {
  if (PROVIDER === 'twilio') {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return 'Twilio is not configured. Run: supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=...'
    }
    return null
  }
  if (PROVIDER === 'meta') {
    if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      return 'WhatsApp is not configured. Run: supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...'
    }
    return null
  }
  if (PROVIDER === 'sms') {
    if (!SENDPK_SMS_USERNAME || !SENDPK_SMS_PASSWORD) {
      return 'SMS is not configured. Run: supabase secrets set SENDPK_SMS_USERNAME=... SENDPK_SMS_PASSWORD=...'
    }
    return null
  }
  if (PROVIDER === 'httpsms') {
    if (!HTTPSMS_API_KEY || !HTTPSMS_FROM) {
      return 'httpSMS is not configured. Run: supabase secrets set HTTPSMS_API_KEY=... HTTPSMS_FROM=+92XXXXXXXXXX'
    }
    return null
  }
  return `Unknown MESSAGE_PROVIDER "${PROVIDER}" — expected "twilio", "meta", "sms" or "httpsms".`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const configError = providerConfigError()
  if (configError) {
    return jsonResponse({ error: configError }, 500)
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

    // Order MUST match the approved template's {{1}}..{{7}} (see README).
    const variables = [
      student.guardian_name ?? 'Parent/Guardian',
      student.full_name,
      String(result.marks_obtained),
      String(exam.total_marks),
      subjectName,
      exam.name,
      passLabel,
    ]

    try {
      const sendResult =
        PROVIDER === 'twilio'
          ? await sendViaTwilio(mobile, variables)
          : PROVIDER === 'sms'
            ? await sendViaSendpkSms(mobile, variables)
            : PROVIDER === 'httpsms'
              ? await sendViaHttpSms(mobile, variables)
              : await sendViaMeta(mobile, variables)
      if (!sendResult.ok) {
        outcomes.push({ studentId: result.student_id, ok: false, error: sendResult.error })
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
