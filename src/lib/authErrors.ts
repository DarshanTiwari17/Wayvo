/**
 * Turns Supabase/PostgREST errors into messages a traveller can act on.
 *
 * The raw messages are terse and sometimes leaky, so we map the codes we can
 * expect from auth + the `profiles` table and fall back to the original text
 * for anything unrecognised (never swallow it — an unknown error should still
 * be visible rather than silently faked as success).
 */

export const AUTH_ERROR_CODES = {
  EMAIL_NOT_CONFIRMED: 'email_not_confirmed',
  INVALID_CREDENTIALS: 'invalid_credentials',
  USER_ALREADY_EXISTS: 'user_already_exists',
  EMAIL_EXISTS: 'email_exists',
  RATE_LIMITED: 'rate_limit',
  WEAK_PASSWORD: 'weak_password',
  OVER_EMAIL_SEND_RATE: 'over_email_send_rate',
  OVER_REQUEST_RATE: 'over_request_rate',
  OTP_EXPIRED: 'otp_expired',
  SAME_PASSWORD: 'same_password',
  RECOVERY_LINK_INVALID: 'recovery_link_invalid',
  NEW_PASSWORD_SAME: 'new_password_should_be_different',
  OAUTH_CANCELLED: 'access_denied',
  OAUTH_FAILED: 'server_error',
} as const

const MESSAGES: Record<string, string> = {
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]:
    'That email and password combination does not match an account.',
  [AUTH_ERROR_CODES.EMAIL_NOT_CONFIRMED]:
    'Please verify your email address before signing in. Check your inbox for the Wayvo verification link.',
  [AUTH_ERROR_CODES.USER_ALREADY_EXISTS]:
    'An account already exists with this email. Try signing in instead.',
  [AUTH_ERROR_CODES.EMAIL_EXISTS]: 'An account already exists with this email. Try signing in instead.',
  [AUTH_ERROR_CODES.WEAK_PASSWORD]:
    'Please choose a stronger password — at least 8 characters with a mix of letters and numbers.',
  [AUTH_ERROR_CODES.SAME_PASSWORD]:
    'Your new password must be different from your current one.',
  [AUTH_ERROR_CODES.NEW_PASSWORD_SAME]:
    'Your new password must be different from your current one.',
  [AUTH_ERROR_CODES.OVER_EMAIL_SEND_RATE]:
    'For your security, an email was already sent recently. Please wait a minute before trying again.',
  [AUTH_ERROR_CODES.OVER_REQUEST_RATE]: 'Too many attempts. Please wait a moment and try again.',
  [AUTH_ERROR_CODES.RATE_LIMITED]: 'Too many attempts. Please wait a moment and try again.',
  [AUTH_ERROR_CODES.OTP_EXPIRED]: 'This link has expired. Request a new one to continue.',
  [AUTH_ERROR_CODES.RECOVERY_LINK_INVALID]:
    'This password reset link is invalid or has already been used. Request a new one to continue.',
  [AUTH_ERROR_CODES.OAUTH_CANCELLED]: 'Google sign-in was cancelled. No worries — you can sign in with email instead.',
  [AUTH_ERROR_CODES.OAUTH_FAILED]:
    'Google sign-in could not be completed. Please try again, or use email and password.',
  FORBIDDEN_ROW: 'You do not have permission to change that record.',
  PGRST116: 'That record could not be found.',
  PGRST301: 'This sign-in method is not enabled for this project.',
}

export interface FriendlyError {
  message: string
  code: string | null
  /** True when the remedy is "go to your inbox". */
  isEmailIssue: boolean
}

type SupabaseLikeError = {
  message?: string | null
  code?: string | null
  status?: number | null
} | null

function normaliseCode(error: SupabaseLikeError): string {
  if (!error) return ''
  if (error.code) return error.code
  const message = (error.message ?? '').toLowerCase()
  // Some auth errors only carry a message, no code.
  if (message.includes('email not confirmed')) return AUTH_ERROR_CODES.EMAIL_NOT_CONFIRMED
  if (message.includes('invalid login credentials')) return AUTH_ERROR_CODES.INVALID_CREDENTIALS
  if (message.includes('already registered') || message.includes('already been registered')) {
    return AUTH_ERROR_CODES.USER_ALREADY_EXISTS
  }
  if (message.includes('rate limit') || message.includes('too many')) return AUTH_ERROR_CODES.RATE_LIMITED
  if (message.includes('should be at least')) return AUTH_ERROR_CODES.WEAK_PASSWORD
  if (message.includes('same as the old') || message.includes('different from')) {
    return AUTH_ERROR_CODES.SAME_PASSWORD
  }
  return ''
}

export function toFriendlyError(error: SupabaseLikeError, fallback = 'Something went wrong. Please try again.'): FriendlyError {
  const code = normaliseCode(error)
  const rawMessage = (error?.message ?? '').trim()

  return {
    message: (code && MESSAGES[code]) || rawMessage || fallback,
    code: code || error?.code || null,
    isEmailIssue: code === AUTH_ERROR_CODES.EMAIL_NOT_CONFIRMED,
  }
}

export function isEmailNotConfirmed(error: SupabaseLikeError): boolean {
  return normaliseCode(error) === AUTH_ERROR_CODES.EMAIL_NOT_CONFIRMED
}

/** Field-level validation messages, kept in one place so forms stay consistent. */
export const VALIDATION = {
  email: 'Enter a valid email address.',
  password: 'Your password must be at least 8 characters.',
  passwordMismatch: 'Those passwords do not match.',
  required: 'This field is required.',
  fullName: 'Enter your full name (at least 2 characters).',
  newPasswordDifferent: 'Choose a password you have not used before.',
} as const

export function validateEmail(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return VALIDATION.required
  // Deliberately permissive; Supabase is the authority on deliverability.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return VALIDATION.email
  return null
}

export function validatePassword(value: string): string | null {
  if (!value) return VALIDATION.required
  if (value.length < 8) return VALIDATION.password
  return null
}

export function validateFullName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return VALIDATION.required
  if (trimmed.length < 2) return VALIDATION.fullName
  return null
}
