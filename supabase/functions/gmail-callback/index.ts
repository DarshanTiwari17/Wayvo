/**
 * GET /functions/v1/gmail-callback?code=...&state=...&session=<jwt>
 *
 * Step 2. Google redirects here. This function holds the client secret, swaps
 * the code for tokens, stores the refresh token, and sends the traveller back
 * to the app.
 *
 * The refresh token is written with the service role into `gmail_connections`,
 * a table the browser is deliberately not granted access to.
 */
import {
  corsHeaders,
  exchangeCodeForTokens,
  getGmailAddress,
  json,
  type Env,
} from '../_shared/gmail.ts'

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
  const url = new URL(request.url)

  // Where the browser ends up either way.
  const appOrigin = env.ALLOWED_REDIRECT_ORIGINS.split(',')[0]?.trim() || 'http://localhost:5173'
  const back = (params: Record<string, string>) =>
    `${appOrigin}/journeys?${new URLSearchParams(params).toString()}`
  const redirectBack = (params: Record<string, string>) => Response.redirect(back(params), 302)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (url.searchParams.get('error')) {
    return redirectBack({ gmail: 'denied', reason: url.searchParams.get('error')! })
  }
  if (!code || !state) {
    return json({ error: 'invalid_request', message: 'Missing code or state.' }, 400, headers)
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { error: 'not_configured', message: 'Gmail import is not configured on this project yet.' },
      503,
      headers,
    )
  }

  // The caller's JWT rides through the flow in `session` so the connection can
  // be attributed to them without trusting the `state` round trip.
  const jwt =
    url.searchParams.get('session') ?? request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''

  if (!jwt) return redirectBack({ gmail: 'error', reason: 'no_session' })

  const verify = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY },
  })
  if (!verify.ok) return redirectBack({ gmail: 'error', reason: 'unauthorised' })

  const { data: userData } = (await verify.json()) as { id: string }

  try {
    const tokens = await exchangeCodeForTokens(
      env,
      code,
      `${env.SUPABASE_URL}/functions/v1/gmail-callback`,
    )
    const gmailAddress = await getGmailAddress(tokens.access_token)

    // Service role only: the browser cannot read the token columns.
    const store = await fetch(`${env.SUPABASE_URL}/rest/v1/gmail_connections`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        profile_id: userData.id,
        gmail_address: gmailAddress,
        scopes: tokens.scope,
        status: 'connected',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      }),
    })

    if (!store.ok) {
      console.error('Could not store the Gmail connection:', store.status, (await store.text()).slice(0, 300))
      return redirectBack({ gmail: 'error', reason: 'storage' })
    }

    return redirectBack({ gmail: 'connected' })
  } catch (cause) {
    console.error('Gmail connection failed:', cause)
    return redirectBack({ gmail: 'error', reason: 'exchange' })
  }
})
