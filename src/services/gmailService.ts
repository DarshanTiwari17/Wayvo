/**
 * Browser side of the Gmail import.
 *
 * Every call goes to an Edge Function. The Google client secret and the Gmail
 * refresh token live only on the server, so nothing sensitive is ever held in
 * the browser, in localStorage, or in this bundle.
 */
import { getSupabase } from '../lib/supabase'

export interface GmailConnection {
  profile_id: string
  gmail_address: string | null
  scopes: string | null
  status: 'connected' | 'error' | 'revoked'
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface GmailEmailSummary {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  hasAttachment: boolean
}

export interface GmailAttachmentSummary {
  attachmentId: string
  fileName: string
  mimeType: string
  size: number
}

export interface GmailExtraction {
  messageId: string
  from: string
  subject: string
  date: string
  text: string
  attachments: GmailAttachmentSummary[]
  attachment: { fileName: string; mimeType: string; dataUrl: string; size: number } | null
}

/** Every failure the traveller can see, phrased for them. */
export const GMAIL_ERRORS = {
  not_deployed:
    'Gmail import is not set up on this project yet. You can upload a ticket or PDF instead.',
  not_connected: 'Connect your Gmail account to find your travel bookings.',
  denied: "Gmail access wasn't granted. You can try again or upload your booking manually.",
  reauth_required: "Gmail access wasn't granted. You can try again or upload your booking manually.",
  no_results: "We couldn't find any recent travel bookings in your Gmail.",
} as const

export type GmailErrorCode = keyof typeof GMAIL_ERRORS

export class GmailError extends Error {
  readonly code: GmailErrorCode
  constructor(code: GmailErrorCode, message?: string) {
    super(message ?? GMAIL_ERRORS[code])
    this.name = 'GmailError'
    this.code = code
  }
}

/** A function that has not been deployed answers 404, not JSON. */
function normalise(error: { message: string } | null, status: number): GmailError {
  const code = safeParseCode(error?.message) ?? inferCode(status)
  return new GmailError(code)
}

function safeParseCode(raw?: string): GmailErrorCode | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { error?: string }
    return parsed.error && parsed.error in GMAIL_ERRORS ? (parsed.error as GmailErrorCode) : null
  } catch {
    return null
  }
}

function inferCode(status: number): GmailErrorCode {
  if (status === 404 || status === 503) return 'not_deployed'
  if (status === 409) return 'not_connected'
  if (status === 401) return 'reauth_required'
  return 'not_deployed'
}

/* -------------------------------------------------------------------------- */

async function invoke<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase()
  const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} })

  // A missing function surfaces as a generic error rather than JSON.
  if (error) throw normalise(error as { message: string }, 404)
  if (!data) throw new GmailError('not_deployed')
  return data as T
}

/* -------------------------------------------------------------------------- */

/** Reads the connection row. Only the safe columns are readable by the client. */
export async function getGmailConnection(): Promise<GmailConnection | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('gmail_connections')
    .select('profile_id, gmail_address, scopes, status, last_synced_at, created_at, updated_at')
    .maybeSingle()

  if (error) return null
  return data as GmailConnection | null
}

export async function disconnectGmail(): Promise<void> {
  const supabase = getSupabase()
  // Deletes the row, which removes the stored refresh token with it.
  await supabase.from('gmail_connections').delete().neq('profile_id', '00000000-0000-0000-0000-000000000000')
}

/**
 * Begins the Google consent flow by navigating the browser to Google's consent
 * screen. Returns nothing: on success the user leaves the app.
 */
export async function beginGmailConnect(): Promise<never> {
  const supabase = getSupabase()
  const { data: sessionData } = await supabase.auth.getSession()
  const jwt = sessionData.session?.access_token
  if (!jwt) throw new GmailError('reauth_required')

  const { data, error } = await supabase.functions.invoke('gmail-connect', {
    body: { redirectTo: `${window.location.origin}/journeys` },
  })

  if (error || !data) throw normalise((error as { message: string }) ?? null, 404)

  const { url, state, returnTo } = data as { url: string; state: string; scopes: string; returnTo?: string }

  // Carry the JWT through the round trip so the callback can attribute the
  // connection. It lives in the URL for the length of one redirect only.
  const target = new URL(url)
  target.searchParams.set('session', jwt)
  target.searchParams.set('state', state)
  target.searchParams.set('return_to', returnTo ?? '')

  window.location.assign(target.toString())
  // Never resolves: the browser is navigating away.
  return new Promise<never>(() => {})
}

export async function searchGmail(): Promise<GmailEmailSummary[]> {
  const { emails } = await invoke<{ emails: GmailEmailSummary[] }>('gmail-search')
  return emails ?? []
}

export async function extractFromEmail(
  messageId: string,
  attachmentId?: string,
): Promise<GmailExtraction> {
  return invoke<GmailExtraction>('gmail-extract', { messageId, attachmentId })
}

/** Turns the returned data URL into a File the normal upload path can reuse. */
export async function attachmentToFile(
  attachment: NonNullable<GmailExtraction['attachment']>,
): Promise<File> {
  const response = await fetch(attachment.dataUrl)
  const blob = await response.blob()
  return new File([blob], attachment.fileName, { type: attachment.mimeType })
}
