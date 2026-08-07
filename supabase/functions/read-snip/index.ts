// Reads the text out of a snipped region of a scanned book page, using a
// vision model. Runs server-side because it needs an API key, which must never
// reach the browser — same reasoning as the other edge functions.
//
// Deploy: supabase functions deploy read-snip
//
// This is only needed for a true scan. A book uploaded as a digital PDF carries
// its own text layer, and the app takes the characters straight out of it —
// exact, free, and not a recognition at all. The app only offers this button on
// pages where that text layer is missing.
//
// Google Gemini is used rather than OpenAI because it has a genuinely free API
// tier, and because it reads Urdu and Arabic script markedly better. Get a key
// from https://aistudio.google.com/apikey (free), then:
//
//   supabase secrets set GEMINI_API_KEY=your-key
//
// Optional: GEMINI_MODEL to pin a different model than the default below.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Flash is the free tier's workhorse and is plenty for reading a few lines off
// a page; the heavier models cost more for no gain on this task.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash'

// Deliberately narrow. A vision model asked loosely to "read this" will happily
// translate, tidy up spelling or answer the question instead of transcribing
// it — any of which would silently change a teacher's paper.
const PROMPT = `Transcribe the text in this image exactly as it appears.

Rules:
- Reproduce the original script and language exactly. If the text is Urdu, output Urdu. If Arabic, output Arabic. Never translate, transliterate or romanise.
- Preserve mathematical notation as written, using Unicode symbols such as √ π ≤ ≥ ≠ ∫ ² ³ ½ where the image shows them.
- Keep line breaks where the image has them.
- Keep sub-part markers such as (i), (ii), a), b) exactly as printed.
- Do not correct spelling, do not rephrase, do not add commentary, do not answer the question.
- If the image contains no legible text, reply with exactly: NO_TEXT

Output only the transcription.`

interface RequestBody {
  // Base64 JPEG/PNG of the cropped region, without a data: prefix.
  imageBase64?: string
  mimeType?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server is not configured' }, 500)
  }
  if (!GEMINI_API_KEY) {
    return jsonResponse(
      {
        error:
          'Reading with AI is not set up. Add a free Gemini API key: supabase secrets set GEMINI_API_KEY=your-key',
      },
      503
    )
  }

  // Same gate as the rest of the exam tooling: staff only, never the
  // attendance kiosk account, and never an unauthenticated caller.
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace('Bearer ', '').trim()
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

  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'teacher') {
    return jsonResponse({ error: 'Only admins and teachers can read book pages' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const imageBase64 = body.imageBase64?.trim()
  if (!imageBase64) {
    return jsonResponse({ error: 'imageBase64 is required' }, 400)
  }
  // A snip is a few lines off one page. Anything much larger is a whole page or
  // a mistake, and would burn the free tier's quota for no benefit.
  if (imageBase64.length > 6_000_000) {
    return jsonResponse({ error: 'That region is too large to read. Snip a smaller part of the page.' }, 413)
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: body.mimeType ?? 'image/jpeg', data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          // Transcription, not writing: the least creative setting is the
          // most faithful one.
          temperature: 0,
          maxOutputTokens: 2048,
        },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: `Could not reach the AI service. ${(err as Error).message}` }, 502)
  }

  const payload = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    error?: { message?: string }
  } | null

  if (!response.ok) {
    const message = payload?.error?.message ?? `AI service returned ${response.status}`
    // 429 is the free tier's daily or per-minute cap, which is worth naming
    // rather than reporting as a generic failure.
    const status = response.status === 429 ? 429 : 502
    return jsonResponse({ error: message }, status)
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  const cleaned = text.trim()

  if (!cleaned || cleaned === 'NO_TEXT') {
    return jsonResponse({ text: '', empty: true })
  }

  return jsonResponse({ text: cleaned })
})
