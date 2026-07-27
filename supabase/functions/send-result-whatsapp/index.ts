// Sends a student's exam result to their guardian over WhatsApp. Runs
// server-side because it needs provider credentials, which must never reach
// the browser — same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy send-result-whatsapp
//
// Six providers are supported; pick one with the MESSAGE_PROVIDER secret, or
// list several comma-separated to get automatic failover. The recommended
// production setting pairs the cheap phone-based route with a paid gateway:
//
//   supabase secrets set MESSAGE_PROVIDER=httpsms,sms
//
// Each message tries httpsms first (fractions of a paisa) and only falls back
// to the gateway (~PKR 1) when the phone is offline, so an unplugged handset
// costs a little money instead of silently dropping notifications.
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
//   MESSAGE_PROVIDER=whapi    — WhatsApp via Whapi.Cloud, which pairs a normal
//     WhatsApp account by QR code instead of going through Meta. No Meta app, no
//     business verification, no template approval, and free-form text.
//       supabase secrets set MESSAGE_PROVIDER=whapi
//       supabase secrets set WHAPI_TOKEN=your-token
//     Optional: WHAPI_ENDPOINT (defaults to their text-message URL).
//     Unofficial: automated bulk sending breaches WhatsApp's terms and bans hit
//     the number itself, taking the institute's ordinary WhatsApp with it.
//     Prefer a chain such as "whapi,meta" so a dropped session or a ban still
//     leaves parents notified.
//
//   MESSAGE_PROVIDER=sendpk-wa — WhatsApp where SendPK is the provider holding
//     the number. Meta only lets one provider hold a number at a time, so if the
//     number is registered under SendPK the direct "meta" route will refuse it
//     and this is the way in. The template must be approved in SendPK's own
//     panel; the id below is theirs, not Meta's template name.
//       supabase secrets set MESSAGE_PROVIDER=sendpk-wa
//       supabase secrets set SENDPK_WA_API_KEY=your-api-key
//       supabase secrets set SENDPK_WA_TEMPLATE_ID=your-approved-template-id
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

// MESSAGE_PROVIDER accepts a comma-separated chain, tried left to right, so a
// cheap-but-fragile transport can be backed by a reliable paid one:
//   MESSAGE_PROVIDER=httpsms,sms
// A provider whose secrets are missing is skipped rather than treated as a
// failure, so half-configured chains still send by the routes that do work.
const PROVIDER_CHAIN = (Deno.env.get('MESSAGE_PROVIDER') ?? 'meta')
  .toLowerCase()
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? 'whatsapp:+14155238886'

const HTTPSMS_API_KEY = Deno.env.get('HTTPSMS_API_KEY')
const HTTPSMS_FROM = Deno.env.get('HTTPSMS_FROM')
const HTTPSMS_ENDPOINT = Deno.env.get('HTTPSMS_ENDPOINT') ?? 'https://api.httpsms.com/v1/messages/send'

const WHAPI_TOKEN = Deno.env.get('WHAPI_TOKEN')
const WHAPI_ENDPOINT = Deno.env.get('WHAPI_ENDPOINT') ?? 'https://gate.whapi.cloud/messages/text'

const SENDPK_WA_API_KEY = Deno.env.get('SENDPK_WA_API_KEY')
const SENDPK_WA_TEMPLATE_ID = Deno.env.get('SENDPK_WA_TEMPLATE_ID')

const SENDPK_SMS_USERNAME = Deno.env.get('SENDPK_SMS_USERNAME')
const SENDPK_SMS_PASSWORD = Deno.env.get('SENDPK_SMS_PASSWORD')
const SENDPK_SMS_SENDER = Deno.env.get('SENDPK_SMS_SENDER') ?? 'Maktab'

const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'result_notification'
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'en'
const API_VERSION = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v23.0'
// Meta rejects a send whose parameter count differs from the template's
// placeholder count (error #132000). The real template takes all seven values,
// but this allows a smoke test against a sample template with fewer — set it to
// that template's placeholder count and the extra values are dropped.
const TEMPLATE_PARAM_COUNT = Number(Deno.env.get('WHATSAPP_TEMPLATE_PARAM_COUNT') ?? '7')

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

// WhatsApp through Whapi.Cloud, which drives a WhatsApp account paired by QR
// code rather than going through Meta. That means no Meta app, no business
// verification and no approved template — free-form text sends straight away.
//
// The trade-off is real and worth restating where the code lives: this is not
// an official Meta route, automated bulk sending is against WhatsApp's terms,
// and enforcement lands on the *number*, so a ban takes the institute's normal
// WhatsApp with it. Sensible use is a modest, steady volume, and pairing it
// with an official fallback (MESSAGE_PROVIDER=whapi,meta) so a dropped session
// or a ban doesn't stop parents being notified.
async function sendViaWhapi(mobile: string, variables: string[]): Promise<SendResult> {
  const res = await fetch(WHAPI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to: mobile, body: composeMessage(variables) }),
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, error: text.slice(0, 300) || `Whapi returned status ${res.status}` }
  }
  return { ok: true }
}

// WhatsApp through SendPK acting as the BSP for the number. Use this when the
// number is registered under SendPK rather than your own Cloud API app — Meta
// only lets one provider hold a number at a time, so the direct "meta" route
// will refuse a number they already manage. Needs a template approved inside
// SendPK's own panel; its id is theirs, not Meta's template name.
async function sendViaSendpkWhatsApp(mobile: string, variables: string[]): Promise<SendResult> {
  const [guardian, student, marks, total, subject, examName, passLabel] = variables
  const templateData = [
    { mobile, '1': guardian, '2': student, '3': marks, '4': total, '5': subject, '6': examName, '7': passLabel },
  ]
  const form = new URLSearchParams({
    api_key: SENDPK_WA_API_KEY!,
    template_id: SENDPK_WA_TEMPLATE_ID!,
    template_data: JSON.stringify(templateData),
  })
  const res = await fetch('https://wa.sendpk.com/api/send.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const text = (await res.text()).trim()
  // They answer 200 even for rejections, so the body has to be inspected.
  if (!res.ok || /error|invalid|fail|insufficient|denied/i.test(text)) {
    return { ok: false, error: text.slice(0, 300) || `SendPK returned status ${res.status}` }
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
          components: [
            {
              type: 'body',
              parameters: variables
                .slice(0, TEMPLATE_PARAM_COUNT)
                .map((text) => ({ type: 'text', text })),
            },
          ],
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
const KNOWN_PROVIDERS = ['httpsms', 'sms', 'whapi', 'sendpk-wa', 'twilio', 'meta'] as const

// Why a given provider can't be used right now, or null if it's ready.
function providerUnavailableReason(provider: string): string | null {
  switch (provider) {
    case 'httpsms':
      return !HTTPSMS_API_KEY || !HTTPSMS_FROM
        ? 'httpsms: set HTTPSMS_API_KEY and HTTPSMS_FROM'
        : null
    case 'sms':
      return !SENDPK_SMS_USERNAME || !SENDPK_SMS_PASSWORD
        ? 'sms: set SENDPK_SMS_USERNAME and SENDPK_SMS_PASSWORD'
        : null
    case 'whapi':
      return !WHAPI_TOKEN ? 'whapi: set WHAPI_TOKEN' : null
    case 'sendpk-wa':
      return !SENDPK_WA_API_KEY || !SENDPK_WA_TEMPLATE_ID
        ? 'sendpk-wa: set SENDPK_WA_API_KEY and SENDPK_WA_TEMPLATE_ID'
        : null
    case 'twilio':
      return !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN
        ? 'twilio: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN'
        : null
    case 'meta':
      return !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID
        ? 'meta: set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID'
        : null
    default:
      return `unknown provider "${provider}" — expected one of ${KNOWN_PROVIDERS.join(', ')}`
  }
}

function sendWith(provider: string, mobile: string, variables: string[]): Promise<SendResult> {
  switch (provider) {
    case 'httpsms':
      return sendViaHttpSms(mobile, variables)
    case 'sms':
      return sendViaSendpkSms(mobile, variables)
    case 'whapi':
      return sendViaWhapi(mobile, variables)
    case 'sendpk-wa':
      return sendViaSendpkWhatsApp(mobile, variables)
    case 'twilio':
      return sendViaTwilio(mobile, variables)
    default:
      return sendViaMeta(mobile, variables)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Resolve the chain once per request rather than per student.
  const unavailable = PROVIDER_CHAIN.map((p) => providerUnavailableReason(p)).filter(Boolean)
  const usableProviders = PROVIDER_CHAIN.filter((p) => providerUnavailableReason(p) === null)
  if (usableProviders.length === 0) {
    return jsonResponse(
      { error: `No usable message provider configured. ${unavailable.join('; ')}` },
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
      // Walk the chain until one transport accepts the message. Errors are
      // collected rather than returned on first failure, so a message that
      // nothing could deliver reports why every route refused it.
      let sendResult: SendResult = { ok: false }
      const attemptErrors: string[] = []
      for (const provider of usableProviders) {
        sendResult = await sendWith(provider, mobile, variables)
        if (sendResult.ok) break
        attemptErrors.push(`${provider}: ${sendResult.error ?? 'failed'}`)
      }
      if (!sendResult.ok) {
        outcomes.push({ studentId: result.student_id, ok: false, error: attemptErrors.join(' | ') })
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
