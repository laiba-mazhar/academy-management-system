// Shared plumbing for the two functions that read a page with a vision model:
// read-snip (transcribe one region) and read-questions (pull structured
// questions off whole pages).
//
// Both need the same three things — an API key that must never reach the
// browser, the same staff-only gate as the rest of the exam tooling, and the
// same mapping of Google's failures onto messages a teacher can act on.
//
// Get a key from https://aistudio.google.com/apikey (free), then:
//
//   supabase secrets set GEMINI_API_KEY=your-key
//
// Optional: GEMINI_MODEL to pin a different model than the default below.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse } from './cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Flash reads a printed page as well as the heavier models do; the difference
// between them shows up in reasoning, which is not what this is for.
//
// The floating alias rather than a pinned version, deliberately: Google closes
// old models to new API keys, so a key issued today gets "limit: 0" or "no
// longer available to new users" from anything pinned. Verified against a
// fresh key — gemini-2.0-flash and gemini-2.5-flash both refuse, while the
// alias resolves to the current flash model and works.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest'

/** A failed check, carrying the response to return as-is. */
export interface Denied {
  ok: false
  response: Response
}
export interface Allowed {
  ok: true
}

// Missing configuration is reported as a setup instruction rather than a
// generic 500, because that is exactly what it is.
export function checkConfigured(): Allowed | Denied {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, response: jsonResponse({ error: 'Server is not configured' }, 500) }
  }
  if (!GEMINI_API_KEY) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            'Reading with AI is not set up. Add a free Gemini API key: supabase secrets set GEMINI_API_KEY=your-key',
        },
        503
      ),
    }
  }
  return { ok: true }
}

// Staff only: never the attendance kiosk account, never an unauthenticated
// caller. Mirrors the gate on the rest of the exam functions.
export async function requireStaff(req: Request): Promise<Allowed | Denied> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const callerToken = authHeader.replace('Bearer ', '').trim()
  if (!callerToken) {
    return { ok: false, response: jsonResponse({ error: 'Missing Authorization header' }, 401) }
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: callerUser, error: callerError } = await adminClient.auth.getUser(callerToken)
  if (callerError || !callerUser?.user) {
    return { ok: false, response: jsonResponse({ error: 'Invalid session' }, 401) }
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.user.id)
    .single()

  if (callerProfile?.role !== 'admin' && callerProfile?.role !== 'teacher') {
    return { ok: false, response: jsonResponse({ error: 'Only admins and teachers can read book pages' }, 403) }
  }
  return { ok: true }
}

export interface ImagePart {
  imageBase64: string
  mimeType?: string
}

interface GeminiPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

export interface GeminiConfig {
  /**
   * Budget for the whole answer. Current flash models think before they reply
   * and those thinking tokens count against this, so it has to be several
   * times what the visible answer needs — one dense page measured 2.2k tokens
   * of output behind 3.8k tokens of thinking. Set it too low and the reply
   * comes back empty rather than short.
   */
  maxOutputTokens: number
  /** Set to make the model answer with JSON matching a schema. */
  responseSchema?: unknown
}

export type GeminiResult = { ok: true; text: string } | Denied

export async function callGemini(
  prompt: string,
  images: ImagePart[],
  config: GeminiConfig
): Promise<GeminiResult> {
  const parts: GeminiPart[] = [{ text: prompt }]
  for (const image of images) {
    parts.push({ inline_data: { mime_type: image.mimeType ?? 'image/jpeg', data: image.imageBase64 } })
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          // Transcription and extraction, not writing: the least creative
          // setting is the most faithful one.
          temperature: 0,
          maxOutputTokens: config.maxOutputTokens,
          ...(config.responseSchema
            ? { responseMimeType: 'application/json', responseSchema: config.responseSchema }
            : {}),
        },
      }),
    })
  } catch (err) {
    return {
      ok: false,
      response: jsonResponse({ error: `Could not reach the AI service. ${(err as Error).message}` }, 502),
    }
  }

  const payload = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    error?: { message?: string }
  } | null

  if (!response.ok) {
    const message = payload?.error?.message ?? `AI service returned ${response.status}`
    // 429 is the free tier's per-minute or daily cap. Worth naming, because the
    // caller can retry a rate limit but not a bad request.
    return { ok: false, response: jsonResponse({ error: message }, response.status === 429 ? 429 : 502) }
  }

  const candidate = payload?.candidates?.[0]
  // A truncated answer is worse than none when it is meant to be JSON: it
  // parses as far as it goes and silently loses the last questions.
  if (candidate?.finishReason === 'MAX_TOKENS') {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'There was too much on those pages to read in one go. Try fewer pages at a time.' },
        413
      ),
    }
  }

  return { ok: true, text: (candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim() }
}
