import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthProvider'
import { ProtectedRoute } from './components/routing/ProtectedRoute'
import { PublicOnlyRoute } from './components/routing/PublicOnlyRoute'
import { isSupabaseConfigured } from './lib/supabaseConfig'
import { RootRedirect } from './pages/RootRedirect'
import { LoginPage } from './pages/LoginPage'
import { SignUpPage } from './pages/SignUpPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SupabaseSetupPage } from './pages/SupabaseSetupPage'

/**
 * Wayvo route map
 *
 *   /                 → /login or /dashboard depending on the real session
 *   /login            → public only   (redirects to /dashboard when signed in)
 *   /signup           → public only
 *   /forgot-password  → public only
 *   /reset-password   → public only   (arrives here from a recovery email)
 *   /dashboard        → protected     (redirects to /login when signed out)
 *   /setup            → Supabase not configured
 */
export function App() {
  // No credentials means no app. Say so instead of rendering a login form that
  // cannot possibly work.
  if (!isSupabaseConfigured) {
    return <SupabaseSetupPage />
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicOnlyRoute>
                <SignUpPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPasswordPage />
              </PublicOnlyRoute>
            }
          />
          {/*
            NOTE: /reset-password is deliberately NOT wrapped in PublicOnlyRoute.
            Following a Supabase recovery link *creates a session* (the token is
            exchanged on arrival), so a public-only guard would bounce the
            traveller to /dashboard before they could choose a new password.
            The page handles both cases itself: it offers the form when a
            session exists and explains an expired link when one does not.
          */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
