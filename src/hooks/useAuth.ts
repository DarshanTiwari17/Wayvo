import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'

/**
 * The one hook components use to reach authentication state.
 * Throws if used outside <AuthProvider>, which catches wiring mistakes early.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth() must be used inside <AuthProvider>.')
  }
  return context
}
