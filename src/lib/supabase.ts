import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

// "Remember me": Supabase persists sessions in localStorage by default (i.e.
// always remembered). To let the user opt out and have the session cleared
// when the browser closes, the storage adapter below checks a flag at every
// read/write and redirects to sessionStorage instead — set via
// setRememberMe() before signing in.
let rememberMe = true
export function setRememberMe(remember: boolean) {
  rememberMe = remember
}

const dynamicStorage = {
  getItem: (key: string) => (rememberMe ? localStorage : sessionStorage).getItem(key),
  setItem: (key: string, value: string) => (rememberMe ? localStorage : sessionStorage).setItem(key, value),
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

// Not using createClient<Database>(): the installed postgrest-js's generic
// query-builder types expect a schema shape produced by `supabase gen types`
// (with per-column nullability/defaults), which our hand-written Database
// interface can't satisfy exactly. Query results are typed explicitly at the
// call site instead, using the interfaces in '@/types/database'.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: dynamicStorage },
})
