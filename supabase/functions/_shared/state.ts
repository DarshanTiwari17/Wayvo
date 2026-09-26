/**
 * Signed, expiring `state` values for the Gmail OAuth round trip.
 *
 * The `state` parameter is what stops an attacker from feeding a victim's
 * browser someone else's authorisation code. It carries:
 *
 *   p  the Wayvo profile id the connection belongs to
 *   r  where to send the traveller afterwards
 *   x  expiry, so a captured URL cannot be replayed later
 *
 * It is signed with HMAC-SHA256 using the service role key, so the callback can
 * trust it without a database round trip — and, critically, without putting the
 * user's Supabase JWT in a URL that gets handed to Google.
 */

export interface StatePayload {
  /** Wayvo profile id. */
  p: string
  /** Return URL, always validated against ALLOWED_REDIRECT_ORIGINS on use. */
  r: string
  /** Expiry, seconds since the epoch. */
  x: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** RFC 4648 §5 base64url, without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** `base64url(payload).base64url(hmac)` */
export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`
}

export type StateFailure = 'malformed' | 'bad_signature' | 'expired'

export type VerifyResult = { ok: true; payload: StatePayload } | { ok: false; reason: StateFailure }

export async function verifyState(
  state: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const [body, signature] = state.split('.')
  if (!body || !signature) return { ok: false, reason: 'malformed' }

  let payload: StatePayload
  try {
    payload = JSON.parse(decoder.decode(base64UrlDecode(body))) as StatePayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (!payload || typeof payload.p !== 'string' || typeof payload.x !== 'number') {
    return { ok: false, reason: 'malformed' }
  }

  let valid = false
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature) as unknown as BufferSource,
      encoder.encode(body),
    )
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  if (!valid) return { ok: false, reason: 'bad_signature' }

  if (nowSeconds > payload.x) return { ok: false, reason: 'expired' }

  return { ok: true, payload }
}

/**
 * Resolves a return URL against the allow list, so a tampered `state` cannot
 * turn the callback into an open redirect.
 */
export function safeReturnTo(candidate: string | undefined, allowedOrigins: string): string {
  const fallback = allowedOrigins.split(',')[0]?.trim() || 'http://localhost:5173'

  if (!candidate) return fallback
  try {
    const url = new URL(candidate)
    const allowed = allowedOrigins
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    return allowed.includes(url.origin) ? `${url.origin}${url.pathname}${url.search}` : fallback
  } catch {
    return fallback
  }
}
