/**
 * Reads and validates Supabase configuration from Vite env vars.
 *
 * This module never throws and never creates a client, so the app can render a
 * clear "not configured" screen instead of crashing on a blank page.
 *
 * IMPORTANT: only the *anon* key belongs here. The `service_role` key bypasses
 * Row Level Security and must never be bundled into frontend code.
 */

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

function validate(): string | null {
  if (!url && !anonKey) {
    return 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Copy .env.example to .env.local and add your Supabase project credentials.'
  }
  if (!url) return 'VITE_SUPABASE_URL is not set. Copy .env.example to .env.local and add your Supabase project URL.'
  if (!anonKey) return 'VITE_SUPABASE_ANON_KEY is not set. Copy .env.example to .env.local and add your Supabase anon key.'
  if (!/^https?:\/\//.test(url)) return `VITE_SUPABASE_URL must start with http:// or https:// (received "${url}").`
  return null
}

export const supabaseConfigError = validate()

export const isSupabaseConfigured = supabaseConfigError === null

export const supabaseUrl = url
export const supabaseAnonKey = anonKey

/**
 * Where Supabase should send the user after they follow a link from an email
 * (password recovery, and email-confirmation confirm links).
 */
export const authRedirectUrl = (import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_URL ?? '').trim()

/** Local fallback so recovery still works if the env var was forgotten. */
export function resolvePasswordRecoveryRedirect(): string {
  if (authRedirectUrl) return authRedirectUrl
  if (typeof window === 'undefined') return '/reset-password'
  return `${window.location.origin}/reset-password`
}

/**
 * Where Google sends the traveller back to.
 *
 * `/dashboard` is protected: on success the restored session passes straight
 * through, and on a declined consent screen the visitor is bounced to /login
 * where the reason from the URL is shown.
 */
export function oauthRedirectUrl(): string {
  if (typeof window === 'undefined') return '/dashboard'
  return `${window.location.origin}/dashboard`
}
