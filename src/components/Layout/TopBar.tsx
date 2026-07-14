import { useAuth } from '@/context/AuthContext'
import { ThemeToggle } from '@/components/ThemeToggle'

export function TopBar() {
  const { profile, signOut } = useAuth()

  return (
    <header className="no-print flex h-14 shrink-0 items-center justify-between border-b-2 border-gold-400/40 bg-cream-50 px-6 dark:border-gold-500/20 dark:bg-slate-800">
      <div />
      <div className="flex items-center gap-3">
        <span className="text-sm text-brand-800 dark:text-cream-100">{profile?.full_name}</span>
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:border-slate-600 dark:text-cream-100 dark:hover:bg-slate-700"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
