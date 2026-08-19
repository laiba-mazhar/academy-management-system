import type { Class, Student, UserRole } from '@/types/database'

// Where a signed-in user belongs, by role — used by the login redirect, the
// forced-password-reset screen, and the wrong-panel bounce in ProtectedRoute.
export function homePathForRole(role: UserRole): string {
  if (role === 'admin') return '/admin'
  if (role === 'attendance') return '/scan'
  return '/teacher'
}

export function effectiveFee(student: Student, classById: Map<string, Class>): number {
  if (student.fee_override !== null && student.fee_override !== undefined) return student.fee_override
  return student.class_id ? classById.get(student.class_id)?.fee_amount ?? 0 : 0
}

export function isValidPhone(phone: string): boolean {
  const digitCount = (phone.match(/\d/g) ?? []).length
  return /^[0-9+\-\s()]+$/.test(phone) && digitCount >= 7 && digitCount <= 15
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}


export function netInvoiceAmount(invoice: { amount: number; discount: number }): number {
  return Math.max(0, invoice.amount - invoice.discount)
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
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

/** Clock time only — what the attendance desk and the register care about. */
export function formatClockTime(timestamp: string | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** A span of minutes as "5h 37m" / "45m". Reads faster than a decimal at a desk. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes < 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
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

export function daysAgoLocalDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
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
