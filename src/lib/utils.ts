export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(timestamp: string | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatMonth(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
}

export function firstOfMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function monthValueToDate(monthValue: string): string {
  return `${monthValue}-01`
}

// Shifts a "YYYY-MM" value by whole months (negative to go back) — powers
// one-click prev/next navigation instead of relying on the native month
// picker's fiddly calendar popup.
export function shiftMonthValue(monthValue: string, delta: number): string {
  const [year, month] = monthValue.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Local calendar date (YYYY-MM-DD), not UTC — new Date().toISOString() shifts
// by the timezone offset and can land on the wrong day (e.g. still "yesterday"
// in UTC during early morning hours in UTC+ zones).
export function todayLocalDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(10)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function percentage(obtained: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((obtained / total) * 1000) / 10
}

const PLANNER_DAYS: Record<'weekly' | 'biweekly' | 'monthly', number> = {
  weekly: 7,
  biweekly: 15,
  monthly: 30,
}

// Splits a date range into fixed-length slots (7/15/30 days) for the course
// breakdown planner. The last slot is capped at endDate even if shorter.
export function generateCourseSlots(
  startDate: string,
  endDate: string,
  plannerType: 'weekly' | 'biweekly' | 'monthly'
): { start: string; end: string }[] {
  const days = PLANNER_DAYS[plannerType]
  const slots: { start: string; end: string }[] = []
  const cursor = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (cursor <= end) {
    const slotEnd = new Date(cursor)
    slotEnd.setDate(slotEnd.getDate() + days - 1)
    const cappedEnd = slotEnd > end ? end : slotEnd
    slots.push({
      start: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      end: `${cappedEnd.getFullYear()}-${String(cappedEnd.getMonth() + 1).padStart(2, '0')}-${String(cappedEnd.getDate()).padStart(2, '0')}`,
    })
    cursor.setDate(cursor.getDate() + days)
  }
  return slots
}
