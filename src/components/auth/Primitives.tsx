import { useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react'
import { GoogleMark } from './GoogleMark'

/* ---------------------------------------------------------------------------
 * Status message
 * ------------------------------------------------------------------------- */

type AlertTone = 'error' | 'success' | 'info'

const ALERT_STYLES: Record<AlertTone, { className: string; Icon: typeof Info }> = {
  error: { className: 'wayvo-alert wayvo-alert--error', Icon: CircleAlert },
  success: { className: 'wayvo-alert wayvo-alert--success', Icon: CircleCheck },
  info: { className: 'wayvo-alert wayvo-alert--info', Icon: Info },
}

type FormAlertProps = {
  tone?: AlertTone
  children: ReactNode
  /** Announce immediately, e.g. right after a failed submit. */
  live?: boolean
  id?: string
}

export function FormAlert({ tone = 'error', children, live = false, id }: FormAlertProps) {
  if (!children) return null
  const { className, Icon } = ALERT_STYLES[tone]
  return (
    <p id={id} className={className} role={tone === 'error' ? 'alert' : 'status'} aria-live={live ? 'assertive' : 'polite'}>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/* ---------------------------------------------------------------------------
 * Submit button
 * Swaps the label for a spinner while a request is in flight without changing
 * the button's height, so the card layout never jumps.
 * ------------------------------------------------------------------------- */

type AuthButtonProps = {
  children: string
  pending?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: 'submit' | 'button'
}

export function AuthButton({ children, pending = false, disabled = false, onClick, type = 'submit' }: AuthButtonProps) {
  const label = pending ? 'Please wait' : children
  return (
    <button type={type} className="wayvo-button" onClick={onClick} disabled={pending || disabled} aria-busy={pending}>
      {pending && <LoaderCircle size={15} strokeWidth={2.6} className="animate-spin" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}

/* ---------------------------------------------------------------------------
 * Google sign-in button
 * Same height / radius / letter-spacing as the primary button, inverted fill so
 * the reference's button geometry carries straight through to the OAuth path.
 * ------------------------------------------------------------------------- */

type GoogleButtonProps = {
  pending?: boolean
  disabled?: boolean
  onClick: () => void
  label?: string
}

export function GoogleButton({ pending = false, disabled = false, onClick, label = 'Continue with Google' }: GoogleButtonProps) {
  return (
    <button
      type="button"
      className="wayvo-button wayvo-button--outline"
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? (
        <LoaderCircle size={15} strokeWidth={2.6} className="animate-spin" aria-hidden="true" />
      ) : (
        <GoogleMark size={17} />
      )}
      <span>{pending ? 'Opening Google…' : label}</span>
    </button>
  )
}

/** Thin "or" rule that separates the two sign-in paths. */
export function OrRule() {
  return (
    <div className="wayvo-or-rule" aria-hidden="true">
      or
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Field wrapper — keeps label / control / error spacing identical everywhere.
 * ------------------------------------------------------------------------- */

type FieldProps = {
  id: string
  label: string
  error?: string | null
  hint?: string
  children: ReactNode
}

export function Field({ id, label, error, hint, children }: FieldProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div>
      <label className="wayvo-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <span className="mt-1.5 block text-[12px] leading-[1.4] text-white/55" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="wayvo-field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Password visibility toggle — matches the reference input styling.
 * ------------------------------------------------------------------------- */

type PasswordInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
  invalid?: boolean
  disabled?: boolean
  describedBy?: string
}

export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  invalid = false,
  disabled = false,
  describedBy,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        type={visible ? 'text' : 'password'}
        className="wayvo-input pr-[72px]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-[68px] items-center justify-end pr-3.5 text-[12px] font-medium text-white/70 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
