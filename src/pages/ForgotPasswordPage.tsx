import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AuthShell } from '../components/auth/AuthShell'
import { AuthButton, Field, FormAlert } from '../components/auth/Primitives'
import { useAuth } from '../hooks/useAuth'
import { validateEmail } from '../lib/authErrors'

/**
 * Wayvo — /forgot-password
 *
 * Step 1 of 2. Calls Supabase `resetPasswordForEmail`, which emails a
 * one-time recovery link. Step 2 lives on /reset-password.
 */
export function ForgotPasswordPage() {
  const { resetPassword, user } = useAuth()

  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSentTo(null)

    const emailError = validateEmail(email)
    setFieldError(emailError)
    if (emailError) return

    setPending(true)
    const result = await resetPassword(email)
    setPending(false)

    if (result.ok) {
      setSentTo(email.trim())
    } else {
      setFormError(result.error.message)
    }
  }

  if (sentTo) {
    return (
      <AuthShell>
        <h2 className="wayvo-card__title">Check your inbox</h2>
        <p className="wayvo-card__subtitle">
          If an account exists for <strong className="font-semibold text-white">{sentTo}</strong>, a password reset link
          is on its way. The link expires after a short while — request another if it does.
        </p>

        <div className="mt-11 flex flex-col items-end gap-3.5">
          <Link to="/login" className="wayvo-link">
            Back to login
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h2 className="wayvo-card__title">Forgot Password?</h2>
      <p className="wayvo-card__subtitle">
        Enter the email you signed up with and we&apos;ll send you a link to choose a new password.
      </p>

      <form className="mt-11 flex flex-col" onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="mb-6">
            <FormAlert tone="error" live>
              {formError}
            </FormAlert>
          </div>
        )}

        <Field id="email" label="Email" error={fieldError}>
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
            aria-invalid={Boolean(fieldError) || undefined}
            aria-describedby={fieldError ? 'email-error' : undefined}
            disabled={pending}
          />
        </Field>

        <div className="mt-9">
          <AuthButton pending={pending}>Send reset link</AuthButton>
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
