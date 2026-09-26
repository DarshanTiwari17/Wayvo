/**
 * Shared helpers for the Wayvo Gmail Edge Functions.
 *
 * The Google client secret lives here and nowhere else. These functions run
 * with the service role so they can read and write `gmail_connections`, whose
 * token columns the browser is not granted.
 */

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/** The minimum: read-only mail plus the address to show in the UI. */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** Public URL of this deployment, e.g. https://<ref>.supabase.co */
  SUPABASE_URL: string
  /** OIDC issuer of this project, used to verify the caller's JWT. */
  SUPABASE_ANON_KEY: string
  ALLOWED_REDIRECT_ORIGINS?: string
}

export function corsHeaders(origin: string | null, env?: Env): Record<string, string> {
  const allowList = (env?.ALLOWED_REDIRECT_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const allowed = origin && (allowList.length === 0 || allowList.includes(origin)) ? origin : 'null'

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

/* -------------------------------------------------------------------------- */

export interface TokenBundle {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  token_type: string
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TokenBundle> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Google token exchange failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return (await response.json()) as TokenBundle
}

export async function refreshAccessToken(env: Env, refreshToken: string): Promise<TokenBundle> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Google token refresh failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return (await response.json()) as TokenBundle
}

export async function getGmailAddress(accessToken: string): Promise<string | null> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return null
  const info = (await response.json()) as { email?: string }
  return info.email ?? null
}

/* -------------------------------------------------------------------------- */

/**
 * The Gmail search used to surface booking confirmations.
 *
 * Gmail's own query syntax, so the work happens server-side at Gmail rather
 * than by downloading an inbox. Scoped to recent mail and to likely senders /
 * subjects; no message bodies are fetched at this stage.
 */
export const TRAVEL_QUERY =
  '(subject:(booking OR confirmation OR ticket OR itinerary OR reservation OR "travel details" OR e-ticket OR "boarding pass" OR "train ticket" OR "flight booking" OR "hotel booking" OR "bus ticket") OR from:(irctc OR railways OR indianairlines OR indigo OR akasaair OR gofirst OR spicejet OR booking OR reservations OR travel OR airtel OR makemytrip OR irctcconnect)) newer_than:180d -from:(noreply OR no-reply OR donotreply)'

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailListItem {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  hasAttachment: boolean
}

/** Decodes base64url and parses the RFC 2822 headers we need. */
export function parseListItem(
  id: string,
  payload: { headers?: GmailHeader[]; snippet?: string; labelIds?: string[] },
): GmailListItem {
  const header = (name: string) =>
    payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

  return {
    id,
    from: header('From'),
    subject: header('Subject') || '(no subject)',
    date: header('Date'),
    // Gmail's snippet is a short plaintext preview. It is used only to help the
    // traveller recognise the booking; the full body is never fetched here.
    snippet: (payload.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
    hasAttachment: (payload.labelIds ?? []).includes('ATTACHMENT') || /attachment/i.test(payload.snippet ?? ''),
  }
}

/** Finds PDF or image attachments on a message. */
export interface GmailAttachment {
  attachmentId: string
  fileName: string
  mimeType: string
  size: number
}

export function findTravelAttachments(
  parts: GmailPart[] | undefined,
): GmailAttachment[] {
  if (!parts) return []
  const wanted = /^(application\/pdf|image\/(jpeg|jpg|png|webp))$/i

  const out: GmailAttachment[] = []
  const walk = (list: GmailPart[]) => {
    for (const part of list) {
      if (part.filename && part.body?.attachmentId && wanted.test(part.mimeType ?? '')) {
        out.push({
          attachmentId: part.body.attachmentId,
          fileName: part.filename,
          mimeType: part.mimeType ?? 'application/octet-stream',
          size: Number(part.body.size ?? 0),
        })
      }
      if (part.parts) walk(part.parts)
    }
  }
  walk(parts)
  return out
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: GmailPart[]
}

/** Recursively collects the plaintext body, preferring text/plain. */
export function extractPlainText(payload: { parts?: GmailPart[] } | undefined): string {
  if (!payload) return ''

  const plain: string[] = []
  const walk = (part: GmailPart, inherited: string) => {
    const mime = part.mimeType ?? inherited
    if (mime === 'text/plain' && part.body?.data) {
      plain.push(decodeBase64Url(part.body.data))
    } else if (mime === 'text/html' && part.body?.data && plain.length === 0) {
      plain.push(decodeBase64Url(part.body.data).replace(/<[^>]+>/g, ' '))
    }
    part.parts?.forEach((child) => walk(child, mime))
  }

  walk(payload, 'multipart/mixed')
  return plain.join('\n').replace(/&nbsp;/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
}

export function decodeBase64Url(value: string): string {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)

  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))

  // Documents may be plain text; anything that is not valid UTF-8 is treated as
  // binary and produces no text.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return ''
  }
}
