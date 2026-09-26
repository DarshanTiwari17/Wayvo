/**
 * POST /functions/v1/gmail-connect
 *
 * Step 1 of connecting Gmail: returns the Google consent URL for the browser to
 * open. The client secret and the service role key stay on the server.
 *
 * This function is protected by Supabase's own JWT verification (do NOT deploy
 * it with `--no-verify-jwt`): the caller must be a signed-in Wayvo user, and
 * the connection is attributed to the user id taken from that verified token.
 */
import { GMAIL_SCOPES, GOOGLE_AUTH_ENDPOINT, corsHeaders, json, type Env } from '../_shared/gmail.ts'
import { signState } from '../_shared/state.ts'

/** Ten minutes is ample to click through Google's consent screen. */
const STATE_TTL_SECONDS = 600

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

  // A real setup state, rather than a button that quietly does nothing.
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json(
      {
        error: 'not_configured',
        message:
          'Gmail import is not set up on this project yet. An administrator needs to set the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET function secrets.',
      },
      503,
      headers,
    )
  }

  // Supabase has already verified the signature and expiry of this JWT.
  const jwt = (request.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!jwt) return json({ error: 'unauthorised' }, 401, headers)

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!userRes.ok) return json({ error: 'unauthorised' }, 401, headers)

  const { data: userData } = (await userRes.json()) as { id: string }

  const body = (await request.json().catch(() => ({}))) as { redirectTo?: string }
  const fallbackOrigin = env.ALLOWED_REDIRECT_ORIGINS.split(',')[0]?.trim() || 'http://localhost:5173'

  // The state is signed and expiring, and carries only the profile id and the
  // return path. No access token, refresh token or JWT ever enters the URL.
  const state = await signState(
    {
      p: userData.id,
      r: body.redirectTo ?? `${fallbackOrigin}/journeys`,
      x: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    },
    env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    // Minimum scopes: read-only mail, plus the address to display.
    // No Drive, no Calendar, no contacts, no send.
    scope: GMAIL_SCOPES,
    response_type: 'code',
    // 'offline' + 'consent' guarantees a refresh token even if this Google
    // account has consented to something else before.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    redirect_uri: `${env.SUPABASE_URL}/functions/v1/gmail-callback`,
  })

  return json(
    {
      url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
      scopes: GMAIL_SCOPES,
      /** What the traveller is about to be asked to approve. */
      consentSummary:
        'Wayvo will be able to find and read your travel booking emails. It cannot send, delete or modify email.',
    },
    200,
    headers,
  )
})
