import { NavLink } from 'react-router-dom'

export interface NavItem {
  label: string
  to: string
  end?: boolean
}

export function Sidebar({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <aside className="no-print flex w-60 shrink-0 flex-col bg-gradient-to-b from-brand-800 to-brand-900 shadow-lg">
      <div className="border-b border-gold-400/20 px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-400">Al Maktab</p>
        <p className="text-sm font-semibold text-cream-50">Educational Institute</p>
        <p className="mt-1 text-xs font-medium text-cream-200/70">{title} Panel</p>
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
        Al Maktab Educational Institute
      </div>
    </aside>
  )
}
