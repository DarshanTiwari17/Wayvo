/**
 * POST /functions/v1/gmail-connect
 *
 * Step 1 of connecting Gmail. Returns the Google consent URL for the browser
 * to navigate to. The client secret never leaves this function.
 */
import { GMAIL_SCOPES, GOOGLE_AUTH_ENDPOINT, corsHeaders, json, type Env } from '../_shared/gmail.ts'

/** Short-lived, signed value so the callback can only serve this user's request. */
function makeState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (request) => {
  const env = {
    GOOGLE_CLIENT_ID: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
    GOOGLE_CLIENT_SECRET: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    ALLOWED_REDIRECT_ORIGINS: Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '',
  } satisfies Env

  const headers = corsHeaders(request.headers.get('origin'), env)

  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers)

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

  // The caller's JWT is required; this function must never be anonymous.
  const auth = request.headers.get('Authorization') ?? ''
  const jwt = auth.replace('Bearer ', '').trim()
  if (!jwt) return json({ error: 'unauthorised' }, 401, headers)

  const { data: userData, error: userError } = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (userError || !userData) return json({ error: 'unauthorised' }, 401, headers)

  const body = (await request.json().catch(() => ({}))) as { redirectTo?: string }
  const state = makeState()

  const target = body.redirectTo ?? env.SUPABASE_URL

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    // Minimum scopes: read-only mail, plus the address to display.
    // No Drive, no Calendar, no contacts.
    scope: GMAIL_SCOPES,
    response_type: 'code',
    // 'offline' + 'consent' guarantees a refresh token is returned, even if
    // this Google account consented to something else previously.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    redirect_uri: `${env.SUPABASE_URL}/functions/v1/gmail-callback`,
  })

  return json(
    {
      url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
      state,
      // Echoed back so the callback can only return the user to the app that
      // started the flow.
      returnTo: target,
      scopes: GMAIL_SCOPES,
    },
    200,
    headers,
  )
})
