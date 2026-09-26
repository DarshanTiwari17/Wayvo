/**
 * POST /functions/v1/gmail-extract   { messageId, attachmentId? }
 *
 * Fetches exactly one chosen message, pulls the plaintext body and (optionally)
 * one attachment, and returns the text for the browser to parse.
 *
 * The attachment is returned as a data URL rather than being forwarded to
 * Supabase Storage from here, so the file is stored once, by the client, under
 * the caller's own RLS-scoped path. Nothing about the message is persisted.
 */
import {
  GMAIL_API,
  corsHeaders,
  extractPlainText,
  findTravelAttachments,
  json,
  refreshAccessToken,
  type Env,
  type GmailPart,
} from '../_shared/gmail.ts'

interface Connection {
  refresh_token: string | null
  access_token: string | null
  token_expires_at: string | null
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

Deno.serve(async (request) => {
  const env = {
    GOOGLE_CLIENT_ID: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
    GOOGLE_CLIENT_SECRET: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ALLOWED_REDIRECT_ORIGINS: Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '',
  } satisfies Env & { SUPABASE_SERVICE_ROLE_KEY: string }

  const headers = corsHeaders(request.headers.get('origin'), env)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers)

  const jwt = (request.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!jwt) return json({ error: 'unauthorised' }, 401, headers)

  const body = (await request.json().catch(() => ({}))) as { messageId?: string; attachmentId?: string }
  const messageId = body.messageId
  if (!messageId) return json({ error: 'invalid_request', message: 'messageId is required.' }, 400, headers)

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!userRes.ok) return json({ error: 'unauthorised' }, 401, headers)
  const { data: userData } = (await userRes.json()) as { id: string }

  const connRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/gmail_connections?select=refresh_token,access_token,token_expires_at&profile_id=eq.${userData.id}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  )
  const connection = ((await connRes.json().catch(() => [])) as Connection[])[0]
  if (!connection?.refresh_token) {
    return json(
      { error: 'not_connected', message: 'Connect your Gmail account to find your travel bookings.' },
      409,
      headers,
    )
  }

  let accessToken = connection.access_token
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if (!accessToken || Date.now() > expiresAt - 60_000) {
    try {
      const refreshed = await refreshAccessToken(env, connection.refresh_token)
      accessToken = refreshed.access_token
    } catch {
      return json(
        { error: 'reauth_required', message: "Gmail access wasn't granted. You can try again or upload your booking manually." },
        401,
        headers,
      )
    }
  }

  // Full message: needed now that the traveller has chosen it.
  const messageRes = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!messageRes.ok) {
    return json({ error: 'gmail_error', message: 'That email could not be read.' }, 502, headers)
  }

  const message = (await messageRes.json()) as {
    payload?: { headers?: { name: string; value: string }[]; parts?: GmailPart[] }
  }

  const header = (name: string) =>
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

  const text = extractPlainText(message.payload)
  const attachments = findTravelAttachments(message.payload?.parts)

  let attachment: { fileName: string; mimeType: string; dataUrl: string; size: number } | null = null
  const wanted = body.attachmentId
    ? attachments.find((a) => a.attachmentId === body.attachmentId)
    : attachments.find((a) => a.size <= MAX_ATTACHMENT_BYTES)

  if (wanted && wanted.size <= MAX_ATTACHMENT_BYTES) {
    const attRes = await fetch(`${GMAIL_API}/messages/${messageId}/attachments/${wanted.attachmentId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (attRes.ok) {
      const { data } = (await attRes.json()) as { data: string }
      if (data) {
        attachment = {
          fileName: wanted.fileName,
          mimeType: wanted.mimeType,
          size: wanted.size,
          dataUrl: `data:${wanted.mimeType};base64,${data}`,
        }
      }
    }
  }

  return json(
    {
      messageId,
      from: header('From'),
      subject: header('Subject'),
      date: header('Date'),
      text,
      attachments: attachments.map(({ attachmentId, fileName, mimeType, size }) => ({
        attachmentId,
        fileName,
        mimeType,
        size,
      })),
      attachment,
    },
    200,
    headers,
  )
})
