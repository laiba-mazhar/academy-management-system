import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

// Not using createClient<Database>(): the installed postgrest-js's generic
// query-builder types expect a schema shape produced by `supabase gen types`
// (with per-column nullability/defaults), which our hand-written Database
// interface can't satisfy exactly. Query results are typed explicitly at the
// call site instead, using the interfaces in '@/types/database'.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
