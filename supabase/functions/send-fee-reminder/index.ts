// Sends a real fee-reminder email to a student's guardian via Resend.
// Must run server-side because it needs the Resend API key, which must
// never reach the browser — same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy send-fee-reminder
// Requires the RESEND_API_KEY secret: supabase secrets set RESEND_API_KEY=...
//
// Sandbox note: until you verify a domain in Resend, emails can only be
// delivered to the address you signed up to Resend with — any other
// recipient will be rejected by Resend, not by this function.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// No sandbox fallback on purpose. Defaulting to onboarding@resend.dev used to
// make a misconfigured install look healthy: Resend accepted every request and
// then delivered only to the account owner, so "Reminder sent" appeared on
// screen while guardians received nothing and no error was raised anywhere.
// Requiring the address means a missing domain fails loudly at the first send.
const FROM_ADDRESS = Deno.env.get('REMINDER_FROM_ADDRESS')

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

  if (!FROM_ADDRESS) {
    return jsonResponse(
      {
        error:
          'REMINDER_FROM_ADDRESS is not configured, so mail would be sent from the Resend sandbox sender and reach nobody but the Resend account owner. ' +
          'Verify a domain in Resend, then run: supabase secrets set REMINDER_FROM_ADDRESS="Your Academy <noreply@yourdomain.com>"',
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

  if (callerProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Only admins can send fee reminders' }, 403)
  }

  const body = await req.json().catch(() => null)
  const invoiceId = body?.invoiceId
  if (!invoiceId) {
    return jsonResponse({ error: 'invoiceId is required' }, 400)
  }

  const { data: invoice, error: invoiceError } = await adminClient
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()
  if (invoiceError || !invoice) {
    return jsonResponse({ error: 'Invoice not found' }, 404)
  }

  const { data: student, error: studentError } = await adminClient
    .from('students')
    .select('full_name, guardian_name, guardian_email')
    .eq('id', invoice.student_id)
    .single()
  if (studentError || !student) {
    return jsonResponse({ error: 'Student not found' }, 404)
  }
  if (!student.guardian_email) {
    return jsonResponse({ error: 'No guardian email on file for this student' }, 400)
  }

  const { data: klass } = await adminClient.from('classes').select('name').eq('id', invoice.class_id).single()

  const monthLabel = new Date(invoice.month + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  })
  const dueLabel = invoice.due_date
    ? new Date(invoice.due_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null
  const amountLabel = new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(invoice.amount)

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #7a1f2e;">Maktab - The Educational Institute</h2>
      <p>Dear ${student.guardian_name ?? 'Parent/Guardian'},</p>
      <p>This is a reminder that the fee for <strong>${student.full_name}</strong>${klass?.name ? ` (${klass.name})` : ''} for <strong>${monthLabel}</strong> is still outstanding.</p>
      <p><strong>Amount due:</strong> ${amountLabel}${dueLabel ? `<br/><strong>Due date:</strong> ${dueLabel}` : ''}</p>
      <p>Please arrange payment at your earliest convenience. If you've already paid, kindly disregard this message.</p>
      <p>Thank you,<br/>Maktab - The Educational Institute</p>
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
      subject: `Fee Reminder — ${student.full_name} — ${monthLabel}`,
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

  await adminClient.from('invoices').update({ reminder_sent_at: new Date().toISOString() }).eq('id', invoiceId)

  return jsonResponse({ success: true, to: student.guardian_email })
})
