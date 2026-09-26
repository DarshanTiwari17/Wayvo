/**
 * Reads the error fragment Supabase appends to the redirect URL when a link
 * from an auth email could not be honoured (expired OTP, already-used recovery
 * token, wrong redirect URL, ...).
 *
 * Example fragment:
 *   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
 */
import { AUTH_ERROR_CODES, toFriendlyError, type FriendlyError } from './authErrors'

/**
 * Returns the error carried in the current URL, then strips the error params so
 * a page refresh does not show a stale failure.
 *
 * Supabase reports failures in the fragment for email links and in the query
 * string for OAuth redirects, so both are checked.
 */
export function consumeAuthUrlError(): FriendlyError | null {
  if (typeof window === 'undefined') return null

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const search = window.location.search

  // Fragment wins: that is the implicit/PKCE email-link path.
  const params = hash.has('error') || hash.has('error_code') || hash.has('error_description') ? hash : new URLSearchParams(search)

  const error = params.get('error')
  const errorCode = params.get('error_code')
  const errorDescription = params.get('error_description')

  if (!error && !errorCode && !errorDescription) return null

  // Clean the URL in place (replaceState avoids adding history entries).
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)

  if (errorCode === AUTH_ERROR_CODES.OTP_EXPIRED) {
    return toFriendlyError({ code: AUTH_ERROR_CODES.OTP_EXPIRED })
  }

  return toFriendlyError({
    code: errorCode || null,
    message: errorDescription || error || null,
  })
}

/**
 * Detects the one-shot `?` query flags we set ourselves when redirecting.
 */
export function takeQueryFlag(name: string): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const value = params.get(name)
  if (!value) return null
  params.delete(name)
  const query = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  return value
}
