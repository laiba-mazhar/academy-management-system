import { useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'

const MIN_PASSWORD_LENGTH = 8

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-base font-semibold text-slate-800 dark:text-cream-50">{title}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/**
 * Self-service password change for any signed-in member of staff — admin,
 * teacher, or the front desk. Deliberately not admin-only: the alternative is
 * every forgotten password becoming an admin's errand.
 */
export function ChangePasswordCard() {
  const { profile } = useAuth()
  const { show } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current one.')
      return
    }
    if (!profile?.email) {
      setError('Your account has no email address on file, so the current password cannot be checked.')
      return
    }

    setSubmitting(true)

    // Supabase will change a password on the strength of the session alone,
    // which would let anyone who walked up to an unlocked browser set a new one.
    // Signing in again with the password that was just typed is what actually
    // proves the person knows it. It is the same account, so success simply
    // refreshes the session already in place.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    })
    if (reauthError) {
      setSubmitting(false)
      setError('Current password is incorrect.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    show('Password updated.')
  }

  return (
    <SettingsCard
      title="Change password"
      description="Enter your current password, then the new one. You stay signed in afterwards."
    >
      <form onSubmit={handleSubmit} className="max-w-sm space-y-4">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Updating...' : 'Update password'}
        </Button>
      </form>
    </SettingsCard>
  )
}
