import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ThemeToggle } from '@/components/ThemeToggle'

export function ResetPassword() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && (!session || !profile)) {
    return <Navigate to="/login" replace />
  }

  if (!loading && profile && !profile.must_reset_password) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/teacher'} replace />
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

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setSubmitting(false)
      setError(updateError.message)
      return
    }

    const { error: profileError } = await supabase.rpc('clear_must_reset_password')

    setSubmitting(false)
    if (profileError) {
      setError(profileError.message)
      return
    }
    await refreshProfile()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-cream-50 px-4 dark:bg-slate-900">
      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-gold-400/30 bg-white p-8 shadow-lg dark:border-gold-500/20 dark:bg-slate-800">
        <h1 className="mb-1 text-xl font-semibold text-brand-800 dark:text-cream-50">Set a new password</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          This is your first login (or an admin reset your password). Choose a new password to continue.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            onClick={() => signOut()}
            className="w-full text-center text-sm text-slate-500 transition-colors hover:text-brand-700 dark:text-slate-400 dark:hover:text-cream-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
