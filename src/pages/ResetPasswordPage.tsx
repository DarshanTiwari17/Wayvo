import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { AuthButton, Field, FormAlert, PasswordInput } from '../components/auth/Primitives'
import { useAuth } from '../hooks/useAuth'
import { VALIDATION, validatePassword } from '../lib/authErrors'

/**
 * Wayvo — /reset-password
 *
 * Step 2 of 2. The user arrives here by clicking the link in the recovery
 * email. supabase-js validates the token from the URL fragment (PKCE), fires
 * `PASSWORD_RECOVERY` and holds a temporary session. We then call
 * `updateUser({ password })` to set the new password.
 *
 * If the link has expired or was already used, there is no session — we say so
 * rather than pretending, and point back at /forgot-password.
 */
export function ResetPasswordPage() {
  const { session, loading, updatePassword, urlAuthError, clearUrlAuthError } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // The token may be in the URL *and* invalid (expired / reused link).
  const linkError = urlAuthError

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: Record<string, string | undefined> = {}
    const passwordError = validatePassword(password)
    if (passwordError) nextErrors.password = passwordError

    if (!confirmPassword) {
      nextErrors.confirmPassword = VALIDATION.required
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = VALIDATION.passwordMismatch
    }

    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setPending(true)
    const result = await updatePassword(password)
    setPending(false)

    if (result.ok) {
      // Reuse the live session the recovery link created.
      navigate('/dashboard', { replace: true })
    } else {
      setFormError(result.error.message)
    }
  }

  /* --- invalid / expired link -------------------------------------------- */

  if (!loading && (linkError || !session)) {
    return (
      <AuthShell>
        <h2 className="wayvo-card__title">Reset link expired</h2>
        <p className="wayvo-card__subtitle">
          {linkError
            ? linkError.message
            : 'This password reset link is no longer valid. Reset links can only be used once and expire after a short while.'}
        </p>

        <div className="mt-11 flex flex-col items-end gap-3.5">
          <button type="button" className="wayvo-link wayvo-link--quiet self-start" onClick={clearUrlAuthError}>
            Dismiss
          </button>
          <Link to="/forgot-password" className="wayvo-link">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    )
  }

  /* --- set the new password ---------------------------------------------- */

  return (
    <AuthShell>
      <h2 className="wayvo-card__title">Set a new password</h2>
      <p className="wayvo-card__subtitle">Choose something you have not used before. You&apos;ll stay signed in afterwards.</p>

      <form className="mt-11 flex flex-col" onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="mb-6">
            <FormAlert tone="error" live>
              {formError}
            </FormAlert>
          </div>
        )}

        <Field id="password" label="New password" error={fieldErrors.password} hint="At least 8 characters.">
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

        <div className="mt-9">
          <Field id="confirmPassword" label="Confirm new password" error={fieldErrors.confirmPassword}>
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

        <div className="mt-9">
          <AuthButton pending={pending}>Update password</AuthButton>
        </div>

        <div className="mt-5 flex flex-col items-end gap-3.5">
          <Link to="/login" className="wayvo-link">
            Back to login
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
