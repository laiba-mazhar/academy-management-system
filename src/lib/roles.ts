import type { UserRole } from '@/types/database'

// Where each role lands after login, and where a role-mismatched route sends
// someone. Kept in one place so adding a role doesn't mean hunting down every
// ternary that assumed there were only two.
export function roleHome(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'attendance':
      return '/scan'
    default:
      return '/teacher'
  }
}
