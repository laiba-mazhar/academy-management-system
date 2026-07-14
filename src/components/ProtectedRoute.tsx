import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types/database'

export function ProtectedRoute({ allowedRole }: { allowedRole: UserRole }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">Loading...</div>
    )
  }

  if (!session || !profile) {
    return <Navigate to="/login" replace />
  }

  if (profile.must_reset_password) {
    return <Navigate to="/reset-password" replace />
  }

  if (profile.role !== allowedRole) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/teacher'} replace />
  }

  return <Outlet />
}
