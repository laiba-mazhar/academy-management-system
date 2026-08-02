import { UserIcon } from './icons'

// Initials placeholder — the student records carry no photo, so the desk gets a
// consistent brand-tinted monogram rather than a stock silhouette on every row.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const sizeClasses = {
  sm: 'h-9 w-9 text-xs',
  lg: 'h-14 w-14 text-lg sm:h-16 sm:w-16 sm:text-xl',
} as const

export function StudentAvatar({
  name,
  size = 'sm',
  className = '',
}: {
  name: string
  size?: keyof typeof sizeClasses
  className?: string
}) {
  const initials = initialsOf(name)

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-cream-100 font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-900/10 dark:bg-slate-700 dark:text-cream-100 dark:ring-white/10 ${sizeClasses[size]} ${className}`}
    >
      {initials || <UserIcon size={size === 'lg' ? 26 : 16} />}
    </span>
  )
}
