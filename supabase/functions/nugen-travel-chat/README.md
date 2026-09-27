# Nugen Travel Chat Edge Function

A separate, authenticated Supabase Edge Function that sends a travel chat request to Nugen. It loads only the signed-in user's profile, trips, disruptions, and recovery plans using the caller's JWT, so existing Row Level Security policies remain in force.

## Add it to a Supabase project

Copy the `nugen-travel-chat` folder into `supabase/functions/` and add this entry to `supabase/config.toml`:

```toml
[functions.nugen-travel-chat]
verify_jwt = false
```

The function validates the Supabase access token itself. Setting `verify_jwt = false` allows browser `OPTIONS` preflight requests to reach that validation code.

Configure the secret in the linked Supabase project; do not place it in frontend code or commit it:

```sh
supabase secrets set NUGEN_API_KEY=your-rotated-nugen-key
supabase functions deploy nugen-travel-chat --no-verify-jwt
```

For local development, put `NUGEN_API_KEY=...` in an untracked `.env.edge` file and run:

```sh
supabase functions serve nugen-travel-chat --env-file .env.edge
```

The function accepts the same `{ messages: [{ role, content }] }` request shape as Wayvo's existing travel chat function. Add `stream: true` to the body to receive server-sent events shaped as `data: {"token":"..."}`; without it, the function returns `{ "reply": "..." }`. To use it in the browser, invoke `nugen-travel-chat` after deployment.
