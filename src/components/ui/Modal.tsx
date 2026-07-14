import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl border border-gold-400/30 bg-white p-6 shadow-lg dark:border-gold-500/20 dark:bg-slate-800`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-brand-800 dark:text-cream-50">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
