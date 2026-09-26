import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { RouteLoader } from './RouteLoader'

/**
 * Wraps routes that require a signed-in user.
 *
 * While the session is being restored we render a loader instead of
 * redirecting — otherwise a page refresh would briefly bounce a logged-in user
 * to /login.
 *
 * Unauthenticated visitors are sent to /login, with the page they wanted kept
 * in `location.state` so they can be returned there after signing in.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, status } = useAuth()
  const location = useLocation()

  if (status === 'unconfigured') {
    return <Navigate to="/setup" replace />
  }

  if (loading) {
    return <RouteLoader label="Checking your session" />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
