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
//
// The flag itself is mirrored into sessionStorage (not just kept in this
// module variable) because a plain in-memory default would reset to `true`
// on every page reload — which, for a "remember me: off" session actually
// sitting in sessionStorage, would make the adapter look in the (empty)
// localStorage instead and incorrectly treat a perfectly valid session as
// logged out. Reading the mirrored flag on module load survives reloads
// within the tab while still clearing naturally when the tab/browser closes.
const REMEMBER_ME_KEY = 'ems-remember-me'

function getStoredRememberMe(): boolean {
  if (typeof window === 'undefined') return true
  const stored = sessionStorage.getItem(REMEMBER_ME_KEY)
  return stored === null ? true : stored === 'true'
}

let rememberMe = getStoredRememberMe()
export function setRememberMe(remember: boolean) {
  rememberMe = remember
  if (typeof window !== 'undefined') sessionStorage.setItem(REMEMBER_ME_KEY, String(remember))
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
