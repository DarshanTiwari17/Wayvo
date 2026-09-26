/**
 * GET /functions/v1/gmail-callback?code=...&state=...
 *
 * Step 2. Google redirects here after the traveller approves access.
 *
 * This is the only function that must be deployed with `--no-verify-jwt`:
 * the browser arrives from Google, not from supabase-js, so there is no
 * Supabase JWT to verify. It is authenticated by the signed, expiring `state`
 * instead, which carries the Wayvo profile id and nothing sensitive.
 *
 * The Google client secret is exchanged for tokens here and never leaves the
 * server. The refresh token is written with the service role into
 * `gmail_connections`, a table the browser is not granted access to.
 */
import {
  corsHeaders,
  exchangeCodeForTokens,
  getGmailAddress,
  json,
  type Env,
} from '../_shared/gmail.ts'
import { safeReturnTo, verifyState } from '../_shared/state.ts'

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

  const fallback = `${env.SUPABASE_URL}`
  const back = (params: Record<string, string>) => {
    const target = safeReturnTo(fallback, env.ALLOWED_REDIRECT_ORIGINS)
    return `${target}/journeys?${new URLSearchParams(params).toString()}`
  }
  const redirectBack = (params: Record<string, string>) => Response.redirect(back(params), 302)

  // The traveller pressed "Decline" on Google's screen.
  if (url.searchParams.get('error')) {
    return redirectBack({ gmail: 'denied', reason: url.searchParams.get('error')! })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

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

  // The signed state is the only thing trusted here. It is verified before the
  // authorisation code is spent, and it expires on its own.
  const verified = await verifyState(state, env.SUPABASE_SERVICE_ROLE_KEY)

  if (!verified.ok) {
    const reason = verified.reason === 'expired' ? 'expired' : 'invalid_state'
    return redirectBack({ gmail: 'error', reason })
  }

  const profileId = verified.payload.p
  const returnTo = safeReturnTo(verified.payload.r, env.ALLOWED_REDIRECT_ORIGINS)

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
        profile_id: profileId,
        gmail_address: gmailAddress,
        scopes: tokens.scope,
        status: 'connected',
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        last_synced_at: new Date().toISOString(),
      }),
    })

    if (!store.ok) {
      console.error('Could not store the Gmail connection:', store.status, (await store.text()).slice(0, 300))
      return Response.redirect(
        `${returnTo}?${new URLSearchParams({ gmail: 'error', reason: 'storage' }).toString()}`,
        302,
      )
    }

    return Response.redirect(
      `${returnTo}?${new URLSearchParams({ gmail: 'connected' }).toString()}`,
      302,
    )
  } catch (cause) {
    console.error('Gmail connection failed:', cause)
    return Response.redirect(
      `${returnTo}?${new URLSearchParams({ gmail: 'error', reason: 'exchange' }).toString()}`,
      302,
    )
  }
})
