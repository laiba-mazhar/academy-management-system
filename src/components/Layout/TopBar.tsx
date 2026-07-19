import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { supabase } from '@/lib/supabase'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import logoUrl from '@/assets/maktab_logo_transparent.png'

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile, refreshProfile, signOut } = useAuth()
  const { show } = useToast()
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)

  function openEditName() {
    setNameDraft(profile?.full_name ?? '')
    setNameError(null)
    setEditingName(true)
  }

  async function saveName() {
    if (!profile) return
    if (!nameDraft.trim()) {
      setNameError('Name is required.')
      return
    }
    setSavingName(true)
    const { error } = await supabase.from('profiles').update({ full_name: nameDraft.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) {
      setNameError(error.message)
      return
    }
    await refreshProfile()
    setEditingName(false)
    show('Name updated.')
  }

  return (
    <header
      className="no-print flex h-14 shrink-0 items-center justify-between border-b-2 border-gold-400/40 bg-cream-50 px-3 dark:border-gold-500/20 dark:bg-slate-800 sm:px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand-700 hover:bg-brand-50 dark:text-cream-100 dark:hover:bg-slate-700 lg:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <img src={logoUrl} alt="Maktab - The Educational Institute crest" className="h-8 w-auto shrink-0" />
        <span className="hidden truncate text-sm font-semibold text-brand-800 dark:text-cream-100 sm:inline">
          Maktab - The Educational Institute
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <button
          onClick={openEditName}
          title="Edit your name"
          className="hidden rounded-md px-1.5 py-1 text-sm text-brand-800 transition-colors hover:bg-brand-50 dark:text-cream-100 dark:hover:bg-slate-700 sm:inline"
        >
          {profile?.full_name}
        </button>
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="rounded-lg border border-brand-300 px-2.5 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:border-slate-600 dark:text-cream-100 dark:hover:bg-slate-700 sm:px-3"
        >
          Sign out
        </button>
      </div>

      {editingName && (
        <Modal title="Edit your name" onClose={() => setEditingName(false)}>
          <div className="space-y-3">
            <Field label="Full name">
              <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
            </Field>
            {nameError && <p className="text-sm text-red-600 dark:text-red-400">{nameError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditingName(false)}>
                Cancel
              </Button>
              <Button onClick={saveName} disabled={savingName}>
                {savingName ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </header>
  )
}
