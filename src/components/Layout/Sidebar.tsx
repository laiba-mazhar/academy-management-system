import { NavLink } from 'react-router-dom'
import logoUrl from '@/assets/maktab_logo_transparent.png'

export interface NavItem {
  label: string
  to: string
  end?: boolean
}

export function Sidebar({
  title,
  items,
  isOpen,
  onClose,
}: {
  title: string
  items: NavItem[]
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <>
      {/* Backdrop — mobile/tablet only, closes the drawer on tap. */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}
      {/* On desktop this is sticky rather than static, so the navigation stays
          put while a long page scrolls behind it.

          `sticky` alone does nothing here. As a flex child the aside stretches
          to the row's full height — the height of the whole page — so it has
          no room to move within and scrolls away exactly as before. Measured
          at 5784px against an 800px viewport. Giving it `h-dvh` both stops
          that stretch and holds it to one screen; `self-start` says the same
          thing explicitly, so a later change to the height cannot quietly
          bring the stretch back. The nav inside already scrolls on its own
          when the list is taller than the screen.

          Below `lg` it stays a fixed overlay drawer, unchanged. */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col bg-gradient-to-b from-brand-800 to-brand-900 shadow-lg transition-transform duration-200 ease-in-out lg:sticky lg:bottom-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-60 lg:max-w-none lg:translate-x-0 lg:self-start lg:shadow-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-3 border-b border-gold-400/20 px-5 py-5">
          <img src={logoUrl} alt="Maktab - The Educational Institute crest" className="h-10 w-auto shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-400">Maktab</p>
            <p className="text-sm font-semibold text-cream-50">The Educational Institute</p>
            <p className="mt-1 text-xs font-medium text-cream-200/70">{title} Panel</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-cream-200/80 hover:bg-white/10 hover:text-cream-50 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `block rounded-lg border-l-4 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'border-gold-400 bg-white/10 text-cream-50'
                    : 'border-transparent text-cream-200/80 hover:border-gold-400/50 hover:bg-white/5 hover:text-cream-50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gold-400/20 px-5 py-3 text-[11px] text-cream-200/50">
          Maktab - The Educational Institute
        </div>
      </aside>
    </>
  )
}
