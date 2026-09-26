import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { AuthButton, Field, FormAlert, GoogleButton, OrRule, PasswordInput } from '../components/auth/Primitives'
import { useAuth } from '../hooks/useAuth'
import { VALIDATION, validateEmail, validateFullName, validatePassword } from '../lib/authErrors'
import { takeQueryFlag } from '../lib/authUrlState'

/**
 * Wayvo — /signup
 *
 * Same card, same field styling, same white uppercase button as the reference
 * login screen; only the field set and the button label change.
 *
 * On success Supabase creates the row in `auth.users` and the
 * `handle_new_user` trigger creates the matching `public.profiles` row. The
 * full name travels in `user_metadata` and is copied into the profile by the
 * trigger, so it is never entered twice.
 */
export function SignUpPage() {
  const { signUp, signInWithGoogle, resendVerificationEmail, user, setRememberSession } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [resending, setResending] = useState(false)

  // Set by the router when /login sends an unconfirmed visitor here.
  // Read once via a lazy initialiser: takeQueryFlag also scrubs the query
  // string, which must not happen on every render.
  const [verifyEmail] = useState(() => takeQueryFlag('verify'))

  // Shown instead of the form once the account exists but is not yet verified.
  const [awaitingVerification, setAwaitingVerification] = useState(Boolean(verifyEmail))
  const [sentTo, setSentTo] = useState(verifyEmail ?? '')

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: Record<string, string | undefined> = {}
    const nameError = validateFullName(fullName)
    const emailError = validateEmail(email)
    const passwordError = validatePassword(password)

    if (nameError) nextErrors.fullName = nameError
    if (emailError) nextErrors.email = emailError
    if (passwordError) nextErrors.password = passwordError
    if (!confirmPassword) {
      nextErrors.confirmPassword = VALIDATION.required
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = VALIDATION.passwordMismatch
    }

    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setPending(true)
    setRememberSession(rememberMe)

    const result = await signUp({ email, password, fullName })

    if (!result.ok) {
      setPending(false)
      setFormError(result.error.message)
      return
    }

    if (result.requiresEmailConfirmation) {
      setPending(false)
      setSentTo(email.trim())
      setAwaitingVerification(true)
      return
    }

    // Email confirmation is disabled in the Supabase project: the session is
    // already live, so go straight through.
    navigate('/dashboard', { replace: true })
  }

  async function handleResend() {
    setResending(true)
    setFormError(null)
    const result = await resendVerificationEmail(sentTo || email)
    setResending(false)
    if (!result.ok) setFormError(result.error.message)
  }

  /**
   * Google creates the auth user itself, so the `handle_new_user` trigger
   * creates the profile from Google's name/picture metadata — no separate
   * sign-up step is needed.
   */
  async function handleGoogle() {
    setFormError(null)
    setGooglePending(true)
    setRememberSession(rememberMe)

    const result = await signInWithGoogle()
    if (!result.ok) {
      setGooglePending(false)
      setFormError(result.error.message)
    }
  }

  if (awaitingVerification) {
    return (
      <AuthShell>
        <h2 className="wayvo-card__title">Verify your email</h2>
        <p className="wayvo-card__subtitle">
          We sent a confirmation link to <strong className="font-semibold text-white">{sentTo}</strong>. Open it to
          activate your Wayvo account, then come back and sign in.
        </p>

        <div className="mt-11 flex flex-col gap-6">
          {formError && (
            <FormAlert tone="error" live>
              {formError}
            </FormAlert>
          )}

          <AuthButton pending={resending} onClick={handleResend} type="button">
            Resend email
          </AuthButton>

          <div className="flex flex-col items-end gap-3.5">
            <Link to="/login" className="wayvo-link">
              Back to login
            </Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h2 className="wayvo-card__title">Create Your Account</h2>
      <p className="wayvo-card__subtitle">Leave every place better than you found it.</p>

      <form className="mt-7 flex flex-col" onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="mb-6">
            <FormAlert tone="error" live>
              {formError}
            </FormAlert>
          </div>
        )}

        <Field id="fullName" label="Full name" error={fieldErrors.fullName}>
          <input
            id="fullName"
            name="fullName"
            type="text"
            className="wayvo-input"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Alex Rivera"
            autoComplete="name"
            autoFocus
            aria-invalid={Boolean(fieldErrors.fullName) || undefined}
            aria-describedby={fieldErrors.fullName ? 'fullName-error' : undefined}
            disabled={pending}
          />
        </Field>

        <div className="mt-6">
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
              aria-invalid={Boolean(fieldErrors.email) || undefined}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="mt-6">
          <Field id="password" label="Password" error={fieldErrors.password} hint="At least 8 characters.">
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={Boolean(fieldErrors.password)}
              describedBy={fieldErrors.password ? 'password-error' : 'password-hint'}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="mt-6">
          <Field id="confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              invalid={Boolean(fieldErrors.confirmPassword)}
              describedBy={fieldErrors.confirmPassword ? 'confirmPassword-error' : undefined}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-2.5">
          <input
            id="remember"
            name="remember"
            type="checkbox"
            className="wayvo-checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            disabled={pending}
          />
          <label className="wayvo-checkbox-label" htmlFor="remember">
            Remember me?
          </label>
        </div>

        <div className="mt-5">
          <AuthButton pending={pending} disabled={googlePending}>
            Sign up
          </AuthButton>
        </div>

        <div className="mt-4">
          <OrRule />
        </div>

        <div className="mt-4">
          <GoogleButton pending={googlePending} disabled={pending} onClick={handleGoogle} />
        </div>

        <div className="mt-4 flex flex-col items-end gap-3.5">
          <p className="w-full text-[13px] leading-[1.4] text-white/70">
            Already have an account?{' '}
            <Link to="/login" className="wayvo-link wayvo-link--quiet">
              Sign in
            </Link>
          </p>
        </div>
      </form>
    </AuthShell>
  )
}
