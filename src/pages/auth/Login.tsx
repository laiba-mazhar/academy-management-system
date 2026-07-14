import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ThemeToggle } from '@/components/ThemeToggle'

export function Login() {
  const { session, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session && profile) {
    if (profile.must_reset_password) return <Navigate to="/reset-password" replace />
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/teacher'} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError('Invalid email or password. Please try again.')
    }
  }

  return (
    <div className="relative flex min-h-screen bg-cream-50 dark:bg-slate-900">
      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle />
      </div>

      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, #dfb65b 0, #dfb65b 1px, transparent 1px, transparent 16px)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-400 text-lg font-serif font-semibold text-gold-300">
            AM
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-gold-400">Al Maktab</p>
            <p className="text-xs text-cream-200/70">Educational Institute</p>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-serif text-3xl font-semibold leading-snug text-cream-50">
            Excellence in education,
            <br />
            simplified in one system.
          </h1>
          <p className="mt-4 max-w-sm text-sm text-cream-200/80">
            Manage students, staff, attendance, fees, exams, and timetables — all from a single,
            secure dashboard built for Al Maktab Educational Institute.
          </p>
          <div className="mt-8 h-px w-24 bg-gold-400/50" />
        </div>
        <p className="relative text-xs text-cream-200/50">
          &copy; {new Date().getFullYear()} Al Maktab Educational Institute
        </p>
      </div>

      <div className="flex w-full flex-col items-center justify-center px-4 lg:w-1/2">
        <div className="w-full max-w-sm rounded-2xl border border-gold-400/30 bg-white p-8 shadow-lg dark:border-gold-500/20 dark:bg-slate-800">
          <div className="mb-6 text-center lg:hidden">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-500 text-lg font-serif font-semibold text-brand-700 dark:text-gold-400">
              AM
            </div>
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-700 dark:text-gold-400">
              Al Maktab
            </p>
          </div>
          <h1 className="mb-1 text-xl font-semibold text-brand-800 dark:text-cream-50">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
              />
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg border border-gold-500/50 bg-brand-700 px-3 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
