// Deletes a teacher's Supabase Auth account (their `profiles` and `teachers`
// rows cascade-delete via FK). Needs the service role key, so this must run
// server-side, same reasoning as create-teacher.
//
// Deploy: supabase functions deploy delete-teacher

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
    return jsonResponse({ error: 'Only admins can delete teacher accounts' }, 403)
  }

  const body = await req.json().catch(() => null)
  const teacherId = body?.teacherId
  if (!teacherId) {
    return jsonResponse({ error: 'teacherId is required' }, 400)
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(teacherId)
  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 400)
  }

  return jsonResponse({ success: true })
})
