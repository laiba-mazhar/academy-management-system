// Edge Functions don't get CORS headers for free — the browser sends an
// OPTIONS preflight before the real POST (cross-origin: the app runs on
// localhost/your domain, the function on *.supabase.co), and without a
// matching response the browser blocks it before our code ever sees it.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
