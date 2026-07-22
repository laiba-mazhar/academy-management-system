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
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        className={`flex max-h-[90vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex-col rounded-xl border border-gold-400/30 bg-white shadow-lg dark:border-gold-500/20 dark:bg-slate-800`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700/60">
          <h2 className="text-base font-semibold text-brand-800 dark:text-cream-50">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
