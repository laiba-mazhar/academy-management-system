import { useAuth } from '@/context/AuthContext'
import { ThemeToggle } from '@/components/ThemeToggle'
import logoUrl from '@/assets/maktab_logo_transparent.png'

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile, signOut } = useAuth()

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
        <span className="hidden text-sm text-brand-800 dark:text-cream-100 sm:inline">{profile?.full_name}</span>
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="rounded-lg border border-brand-300 px-2.5 py-1.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 dark:border-slate-600 dark:text-cream-100 dark:hover:bg-slate-700 sm:px-3"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
