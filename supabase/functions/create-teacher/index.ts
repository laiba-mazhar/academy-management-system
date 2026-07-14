// Creates a teacher's Supabase Auth account + profile + teacher row.
// Must run server-side (Edge Function) because it needs the service role key
// to call the Auth Admin API — that key must never reach the browser.
//
// Deploy: supabase functions deploy create-teacher
// Invoke from the app only as a signed-in admin; this function re-checks the
// caller's role server-side rather than trusting the client.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace('Bearer ', '')
  if (!callerToken) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Verify the caller is an authenticated admin before doing anything else.
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
    return jsonResponse({ error: 'Only admins can create teacher accounts' }, 403)
  }

  const body = await req.json().catch(() => null)
  const { email, tempPassword, fullName, phone, monthlySalary } = body ?? {}

  if (!email || !tempPassword || !fullName) {
    return jsonResponse({ error: 'email, tempPassword, and fullName are required' }, 400)
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })

  if (createError || !created.user) {
    return jsonResponse({ error: createError?.message ?? 'Failed to create user' }, 400)
  }

  const newUserId = created.user.id

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: newUserId,
    role: 'teacher',
    full_name: fullName,
    email,
    phone: phone ?? null,
    must_reset_password: true,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(newUserId)
    return jsonResponse({ error: profileError.message }, 400)
  }

  const { error: teacherError } = await adminClient.from('teachers').insert({
    id: newUserId,
    monthly_salary: monthlySalary ?? 0,
  })

  if (teacherError) {
    await adminClient.auth.admin.deleteUser(newUserId)
    return jsonResponse({ error: teacherError.message }, 400)
  }

  return jsonResponse({ id: newUserId, email })
})
