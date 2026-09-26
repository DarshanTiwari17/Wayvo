import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LandingPage } from './LandingPage'

/** The root shows the public landing page or sends a signed-in user to the app. */
export function RootRedirect() {
  const { user, loading, status } = useAuth()

  if (status === 'unconfigured') return <Navigate to="/setup" replace />
  if (loading) return null
  return user ? <Navigate to="/dashboard" replace /> : <LandingPage />
}
