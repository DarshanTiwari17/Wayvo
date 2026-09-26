import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/** `/` decides where to send you based on the real session state. */
export function RootRedirect() {
  const { user, loading, status } = useAuth()

  if (status === 'unconfigured') return <Navigate to="/setup" replace />
  if (loading) return null
  return <Navigate to={user ? '/dashboard' : '/login'} replace />
}
