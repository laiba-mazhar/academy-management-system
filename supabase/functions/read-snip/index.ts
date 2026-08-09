// Reads the text out of a snipped region of a scanned book page.
//
// Deploy: supabase functions deploy read-snip
//
// This is only needed for a true scan. A book uploaded as a digital PDF carries
// its own text layer, and the app takes the characters straight out of it —
// exact, free, and not a recognition at all. The app only offers this button on
// pages where that text layer is missing.
//
// See _shared/gemini.ts for the API key setup.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callGemini, checkConfigured, requireStaff } from '../_shared/gemini.ts'

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

  const configured = checkConfigured()
  if (!configured.ok) return configured.response

  const staff = await requireStaff(req)
  if (!staff.ok) return staff.response

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

  const result = await callGemini(PROMPT, [{ imageBase64, mimeType: body.mimeType }], {
    maxOutputTokens: 8192,
  })
  if (!result.ok) return result.response

  if (!result.text || result.text === 'NO_TEXT') {
    return jsonResponse({ text: '', empty: true })
  }
  return jsonResponse({ text: result.text })
})
