import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { AuthButton, Field, FormAlert, GoogleButton, OrRule, PasswordInput } from '../components/auth/Primitives'
import { useAuth } from '../hooks/useAuth'
import { isEmailNotConfirmed, validateEmail, validatePassword } from '../lib/authErrors'

/**
 * Wayvo — /login
 *
 * The markup below is the reference design, component for component:
 *   "Login to Your Account" heading
 *   Email label + input
 *   Password label + input
 *   Remember me? checkbox
 *   white uppercase LOGIN button
 *   right-aligned "Forgot Password?" link
 *
 * Every control is wired to real Supabase Auth — there is no mock user, no
 * localStorage session and no hardcoded credential anywhere in this file.
 */
export function LoginPage() {
  const { signIn, signInWithGoogle, resendVerificationEmail, user, setRememberSession, urlAuthError, clearUrlAuthError } =
    useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMeState] = useState(true)

  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [resending, setResending] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)

  // Safety net in case a stale click lands here with an active session.
  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  /**
   * Google leaves the page, so on failure the reason comes back in the URL and
   * is surfaced here by the auth provider.
   */
  async function handleGoogle() {
    setFormError(null)
    setNotice(null)
    setGooglePending(true)
    setRememberSession(rememberMe)

    const result = await signInWithGoogle()
    if (!result.ok) {
      setGooglePending(false)
      setFormError(result.error.message)
    }
    // On success the browser navigates to Google; nothing to do here.
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    setNeedsVerification(false)

    const nextErrors: { email?: string; password?: string } = {}
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)
    if (emailError) nextErrors.email = emailError
    if (passwordError) nextErrors.password = passwordError
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setPending(true)

    // Choose the session store *before* signing in so the token is written to
    // the right place from the first save.
    setRememberSession(rememberMe)

    const result = await signIn({ email, password })

    if (result.ok) {
      navigate(redirectTo, { replace: true })
      setPending(false)
      return
    }

    setPending(false)
    if (isEmailNotConfirmed(result.error)) {
      setNeedsVerification(true)
      setFormError(result.error.message)
      return
    }
    setFormError(result.error.message)
  }

  async function handleResendVerification() {
    setResending(true)
    setFormError(null)
    setNotice(null)
    const result = await resendVerificationEmail(email)
    setResending(false)

    if (result.ok) {
      setNeedsVerification(false)
      setNotice('A fresh verification link is on its way. Check your inbox (and spam folder).')
    } else {
      setFormError(result.error.message)
    }
  }

  return (
    <AuthShell>
      <div className="wayvo-login">
        <p className="wayvo-login__eyebrow">Your next journey starts here</p>
        <h2 className="wayvo-card__title">Welcome back.</h2>
        <p className="wayvo-login__intro">Sign in to see your journeys and travel updates.</p>

      {/* Vertical rhythm mirrors the reference: a wide gap below the heading,
          ~38px between field groups, a tighter gap into the checkbox row and
          button. */}
      <form className="mt-8 flex flex-col" onSubmit={handleSubmit} noValidate>
        {(formError || urlAuthError) && (
          <div className="mb-6">
            <FormAlert tone="error" live>
              {formError ?? urlAuthError?.message}
            </FormAlert>
          </div>
        )}

        {notice && (
          <div className="mb-6">
            <FormAlert tone="success">{notice}</FormAlert>
          </div>
        )}

        {urlAuthError && !formError && (
          <button
            type="button"
            onClick={clearUrlAuthError}
            className="wayvo-link wayvo-link--quiet mb-4 self-start text-[12px]"
          >
            Dismiss
          </button>
        )}

        <Field id="email" label="Email" error={fieldErrors.email}>
          <input
            id="email"
            name="email"
            type="email"
            className="wayvo-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            aria-invalid={Boolean(fieldErrors.email) || undefined}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            disabled={pending}
          />
        </Field>

        <div className="mt-9">
          <Field id="password" label="Password" error={fieldErrors.password}>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              invalid={Boolean(fieldErrors.password)}
              describedBy={fieldErrors.password ? 'password-error' : undefined}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="mt-6 flex items-center gap-2.5">
          <input
            id="remember"
            name="remember"
            type="checkbox"
            className="wayvo-checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMeState(event.target.checked)}
            disabled={pending}
          />
          <label className="wayvo-checkbox-label" htmlFor="remember">
            Remember me?
          </label>
        </div>

        <div className="mt-6">
          <AuthButton pending={pending} disabled={googlePending}>
            Login
          </AuthButton>
        </div>

        <div className="mt-5">
          <OrRule />
        </div>

        <div className="mt-5">
          <GoogleButton pending={googlePending} disabled={pending} onClick={handleGoogle} />
        </div>

        {needsVerification && (
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resending || pending}
            className="wayvo-link wayvo-link--quiet mt-5 self-start text-[13px] disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>
        )}

        <div className="mt-5 flex flex-col items-end gap-3.5">
          <Link to="/forgot-password" className="wayvo-link">
            Forgot Password?
          </Link>
          <p className="w-full text-[13px] leading-[1.4] text-white/70">
            New to Wayvo?{' '}
            <Link to="/signup" className="wayvo-link wayvo-link--quiet">
              Create an account
            </Link>
          </p>
        </div>
      </form>
      </div>
    </AuthShell>
  )
}
