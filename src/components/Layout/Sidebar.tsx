import { NavLink } from 'react-router-dom'
import logoUrl from '@/assets/maktab_logo_transparent.png'

export interface NavItem {
  label: string
  to: string
  end?: boolean
}

export function Sidebar({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <aside className="no-print flex w-60 shrink-0 flex-col bg-gradient-to-b from-brand-800 to-brand-900 shadow-lg">
      <div className="flex items-center gap-3 border-b border-gold-400/20 px-5 py-5">
        <img src={logoUrl} alt="Maktab Educational Institute crest" className="h-10 w-auto shrink-0" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-400">Maktab</p>
          <p className="text-sm font-semibold text-cream-50">Educational Institute</p>
          <p className="mt-1 text-xs font-medium text-cream-200/70">{title} Panel</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `block rounded-lg border-l-4 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
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
        Maktab Educational Institute
      </div>
    </aside>
  )
}
