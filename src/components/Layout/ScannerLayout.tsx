import { Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ThemeToggle } from '@/components/ThemeToggle'
import logoUrl from '@/assets/maktab_logo_transparent.png'

// The attendance desk runs on one screen with one job, so it gets a bare
// header instead of the sidebar shell the admin/teacher panels use.
export function ScannerLayout() {
  const { profile, signOut } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col bg-cream-50 dark:bg-slate-900">
      <header
        className="flex h-14 shrink-0 items-center justify-between border-b-2 border-gold-400/40 bg-white px-3 dark:border-gold-500/20 dark:bg-slate-800 sm:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <img src={logoUrl} alt="Maktab - The Educational Institute crest" className="h-8 w-auto shrink-0" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-brand-800 dark:text-cream-100">
              Maktab - The Educational Institute
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Attendance Desk</p>
          </div>
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
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
