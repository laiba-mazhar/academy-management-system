import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { homePathForRole } from '@/lib/utils'
import { ThemeToggle } from '@/components/ThemeToggle'

// A password-recovery link (from "Forgot password?") lands here the same way
// a forced first-login reset does, but the account's must_reset_password flag
// is false in that case — so a separate signal is needed to keep this page
// open instead of bouncing the user straight to their dashboard.
//
// Supabase strips the recovery hash from the URL and fires PASSWORD_RECOVERY
// only once, right after the link is first opened. A plain React state flag
// would forget "we're in a recovery flow" the moment the tab reloads (a
// refresh, or a backgrounded mobile tab getting reloaded) — before the user
// has actually set a new password — which would then silently bounce them to
// their dashboard with their password never changed. Mirroring the flag into
// sessionStorage lets it survive a reload within the same tab, while still
// clearing itself once the password is actually saved (or the tab closes).
const RECOVERY_FLAG_KEY = 'ems-password-recovery'

function hasRecoveryHash(): boolean {
  return typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
}

function hasStoredRecoveryFlag(): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem(RECOVERY_FLAG_KEY) === 'true'
}

export function ResetPassword() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [isRecovery, setIsRecovery] = useState(() => hasRecoveryHash() || hasStoredRecoveryFlag())

  // Only the actual forced first-login/admin-reset case asks for a name —
  // a plain "forgot password" recovery on an already-named account shouldn't
  // add extra friction to a routine password reset.
  const isFirstLogin = profile?.must_reset_password === true

  useEffect(() => {
    if (profile?.full_name) setFullName((prev) => prev || profile.full_name)
  }, [profile])

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
        sessionStorage.setItem(RECOVERY_FLAG_KEY, 'true')
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (!loading && (!session || !profile) && !isRecovery) {
    return <Navigate to="/login" replace />
  }

  if (!loading && profile && !profile.must_reset_password && !isRecovery) {
    return <Navigate to={homePathForRole(profile.role)} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (isFirstLogin && !fullName.trim()) {
      setError('Enter your full name.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    if (isFirstLogin) {
      const { error: nameError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', session!.user.id)
      if (nameError) {
        setSubmitting(false)
        setError(nameError.message)
        return
      }
    }

    const { error: profileError } = await supabase.rpc('clear_must_reset_password')

    setSubmitting(false)
    if (profileError) {
      setError(profileError.message)
      return
    }
    sessionStorage.removeItem(RECOVERY_FLAG_KEY)
    await refreshProfile()
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-cream-50 px-4 dark:bg-slate-900">
      <div className="absolute right-4 z-10 sm:right-6" style={{ top: 'max(1rem, env(safe-area-inset-top))' }}>
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-gold-400/30 bg-white p-8 shadow-lg dark:border-gold-500/20 dark:bg-slate-800">
        <h1 className="mb-1 text-xl font-semibold text-brand-800 dark:text-cream-50">Set a new password</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          {isRecovery && !profile?.must_reset_password
            ? 'Choose a new password to finish resetting your account.'
            : 'This is your first login, or an admin reset your password. Choose a new password to continue.'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isFirstLogin && (
            <div>
              <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
              />
            </div>
          )}
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg border border-gold-500/50 bg-brand-700 px-3 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
          >
            {submitting ? 'Saving...' : 'Save password'}
          </button>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem(RECOVERY_FLAG_KEY)
              signOut()
            }}
            className="w-full text-center text-sm text-slate-500 transition-colors hover:text-brand-700 dark:text-slate-400 dark:hover:text-cream-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
