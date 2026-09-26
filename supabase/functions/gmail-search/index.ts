/**
 * POST /functions/v1/gmail-search
 *
 * Finds likely travel booking emails and returns only what is needed to
 * recognise them: sender, subject, date and a short snippet.
 *
 * The query runs in Gmail, so no inbox is downloaded. Full message bodies are
 * never fetched here — that happens only in `gmail-extract`, for the one
 * message the traveller chooses.
 */
import {
  GMAIL_API,
  TRAVEL_QUERY,
  corsHeaders,
  json,
  parseListItem,
  refreshAccessToken,
  type Env,
} from '../_shared/gmail.ts'

interface Connection {
  refresh_token: string | null
  access_token: string | null
  token_expires_at: string | null
}

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

  const auth = request.headers.get('Authorization') ?? ''
  const jwt = auth.replace('Bearer ', '').trim()
  if (!jwt) return json({ error: 'unauthorised' }, 401, headers)

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!userRes.ok) return json({ error: 'unauthorised' }, 401, headers)
  const { data: userData } = (await userRes.json()) as { id: string }

  // Service role: the client is not granted the token columns.
  const connRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/gmail_connections?select=refresh_token,access_token,token_expires_at&profile_id=eq.${userData.id}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  )
  const connections = (await connRes.json().catch(() => [])) as Connection[]
  const connection = connections[0]
  if (!connection?.refresh_token) {
    return json(
      { error: 'not_connected', message: "Connect your Gmail account to find your travel bookings." },
      409,
      headers,
    )
  }

  // Refresh if the access token has expired.
  let accessToken = connection.access_token
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if (!accessToken || Date.now() > expiresAt - 60_000) {
    try {
      const refreshed = await refreshAccessToken(env, connection.refresh_token)
      accessToken = refreshed.access_token
      await fetch(`${env.SUPABASE_URL}/rest/v1/gmail_connections?profile_id=eq.${userData.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          access_token: refreshed.access_token,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        }),
      })
    } catch {
      return json(
        { error: 'reauth_required', message: "Gmail access wasn't granted. You can try again or upload your booking manually." },
        401,
        headers,
      )
    }
  }

  const params = new URLSearchParams({
    q: TRAVEL_QUERY,
    maxResults: '25',
    includeSpamTrash: 'false',
  })

  const listRes = await fetch(`${GMAIL_API}/messages?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })

  if (!listRes.ok) {
    if (listRes.status === 401) {
      return json(
        { error: 'reauth_required', message: "Gmail access wasn't granted. You can try again or upload your booking manually." },
        401,
        headers,
      )
    }
    return json({ error: 'gmail_error', message: 'Gmail could not be searched right now. Please try again.' }, 502, headers)
  }

  const { messages = [] } = (await listRes.json()) as { messages?: { id: string }[] }
  // Record that a real search happened, and clear any earlier error state.
  await fetch(`${env.SUPABASE_URL}/rest/v1/gmail_connections?profile_id=eq.${userData.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ last_synced_at: new Date().toISOString(), status: 'connected' }),
  })

  if (messages.length === 0) {
    return json({ emails: [], query: TRAVEL_QUERY }, 200, headers)
  }

  // Metadata for each hit, so the traveller can recognise a booking.
  const detailUrl = (id: string) =>
    `${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`

  const details = await Promise.all(
    messages.map(async (message) => {
      const response = await fetch(detailUrl(message.id), {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      if (!response.ok) return null
      return (await response.json()) as Parameters<typeof parseListItem>[1]
    }),
  )

  const emails = details
    .map((payload, index) => (payload ? parseListItem(messages[index].id, payload) : null))
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return json({ emails, query: TRAVEL_QUERY }, 200, headers)
})
