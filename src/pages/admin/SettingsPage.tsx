import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { friendlyError } from '@/lib/errors'
import type { AttendanceSettings } from '@/types/database'

const MIN_PASSWORD_LENGTH = 8

// The attendance rules an admin can tune without a code change. Each one is a
// policy decision the academy owns, so the wording here is about what happens
// at the door rather than what the column is called.
const TIMING_FIELDS = [
  {
    key: 'grace_minutes' as const,
    label: 'Grace period (minutes)',
    help: 'Arriving within this many minutes of the class start still counts as on time.',
  },
  {
    key: 'very_late_minutes' as const,
    label: 'Very late after (minutes)',
    help: 'Past this, the arrival is flagged for the office as well as marked late.',
  },
  {
    key: 'arrival_cutoff_minutes' as const,
    label: 'Arrival cutoff (minutes)',
    help: 'Past this, a first scan of the day is treated as going home, not arriving — the student still counts present, but the missing sign-in is flagged.',
  },
  {
    key: 'min_stay_minutes' as const,
    label: 'Minimum stay (minutes)',
    help: 'A visit shorter than this is flagged as a short stay.',
  },
  {
    key: 'rescan_window_seconds' as const,
    label: 'Ignore repeat scans within (seconds)',
    help: 'Stops a scanner that reads a card twice from signing the student straight back out.',
  },
]

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-base font-semibold text-slate-800 dark:text-cream-50">{title}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const { profile } = useAuth()
  const { show } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)

  const [timing, setTiming] = useState<Record<string, string>>({})
  const [loadingTiming, setLoadingTiming] = useState(true)
  const [savingTiming, setSavingTiming] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      const { data, error } = await supabase.from('attendance_settings').select('*').eq('id', 1).single()
      if (error) {
        show(friendlyError(error.message), 'error')
      } else if (data) {
        const row = data as AttendanceSettings
        setTiming(Object.fromEntries(TIMING_FIELDS.map((f) => [f.key, String(row[f.key])])))
      }
      setLoadingTiming(false)
    }
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError('The new password must be different from the current one.')
      return
    }
    if (!profile?.email) {
      setPasswordError('Your account has no email address on file, so the current password cannot be checked.')
      return
    }

    setChangingPassword(true)

    // Supabase will happily change a password on the strength of the session
    // alone, which would let anyone who walked up to an unlocked browser set a
    // new one. Signing in again with the password the admin just typed is what
    // actually proves they know it. It reuses the same account, so a success
    // simply refreshes the session already in place.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    })
    if (reauthError) {
      setChangingPassword(false)
      setPasswordError('Current password is incorrect.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (updateError) {
      setPasswordError(updateError.message)
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    show('Password updated.')
  }

  async function handleTimingSave() {
    const payload: Record<string, number> = {}
    for (const field of TIMING_FIELDS) {
      const value = Number(timing[field.key])
      if (!Number.isInteger(value) || value < 0) {
        show(`${field.label} must be a whole number of 0 or more.`, 'error')
        return
      }
      payload[field.key] = value
    }
    if (payload.grace_minutes > payload.very_late_minutes) {
      show('The grace period cannot be longer than the very-late threshold.', 'error')
      return
    }
    if (payload.very_late_minutes > payload.arrival_cutoff_minutes) {
      show('The very-late threshold cannot be later than the arrival cutoff.', 'error')
      return
    }

    setSavingTiming(true)
    const { error } = await supabase.from('attendance_settings').update(payload).eq('id', 1)
    setSavingTiming(false)
    if (error) {
      show(friendlyError(error.message), 'error')
      return
    }
    show('Attendance rules updated.')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-cream-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your own password, and the rules the attendance desk follows.
        </p>
      </div>

      <Card
        title="Change password"
        description="Enter your current password, then the new one. You stay signed in afterwards."
      >
        <form onSubmit={handlePasswordChange} className="max-w-sm space-y-4">
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
          {passwordError && <p className="text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
          <Button type="submit" disabled={changingPassword}>
            {changingPassword ? 'Updating...' : 'Update password'}
          </Button>
        </form>
      </Card>

      <Card
        title="Attendance rules"
        description="How the desk reads a scan. These take effect on the next card, with no redeploy."
      >
        {loadingTiming ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {TIMING_FIELDS.map((field) => (
                <div key={field.key}>
                  <Field label={field.label}>
                    <Input
                      type="number"
                      min={0}
                      value={timing[field.key] ?? ''}
                      onChange={(e) => setTiming({ ...timing, [field.key]: e.target.value })}
                    />
                  </Field>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{field.help}</p>
                </div>
              ))}
            </div>
            <Button onClick={handleTimingSave} disabled={savingTiming}>
              {savingTiming ? 'Saving...' : 'Save rules'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
