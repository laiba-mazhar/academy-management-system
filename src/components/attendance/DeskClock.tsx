import { useEffect, useState } from 'react'

// Kept in its own component so the once-a-second tick re-renders the clock
// alone. Holding it in the page's state would re-render the scan input, the
// result card and the whole register every second.
export function DeskClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="text-right leading-tight">
      <p className="text-xl font-semibold tabular-nums text-slate-800 dark:text-slate-100 sm:text-2xl">
        {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
    </div>
  )
}
