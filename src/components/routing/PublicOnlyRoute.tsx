import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { RouteLoader } from './RouteLoader'

/**
 * Wraps the auth pages (/login, /signup, /forgot-password, /reset-password).
 *
 * A user who already has a session is redirected to /dashboard instead of
 * being shown the login form.
 */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading, status } = useAuth()

  if (status === 'unconfigured') {
    return <Navigate to="/setup" replace />
  }

  if (loading) {
    return <RouteLoader label="Checking your session" />
  }

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
