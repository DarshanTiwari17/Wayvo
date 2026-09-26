# Wayvo Travel Assistant

The chat widget is mounted only in the authenticated product shell. It sends
the current conversation to the `wayvo-travel-chat` Supabase Edge Function;
the college AI Gateway key is never sent to or bundled in the browser.

## Configure the AI Gateway

For local Edge Function development, copy `.env.edge.example` to `.env.edge`
and set the personal key issued by the TCET Centre of Excellence:

```sh
cp .env.edge.example .env.edge
```

Then serve the function with that local environment file:

```sh
supabase functions serve wayvo-travel-chat --env-file .env.edge
```

For a deployed Supabase project, add the same variable as an Edge Function
secret:

```sh
supabase secrets set AI_GATEWAY_API_KEY=sk-your-personal-key
```

Do not put this key in `.env`, a `VITE_*` variable, source code, or Git. Deploy
the function after setting it:

```sh
supabase functions deploy wayvo-travel-chat --no-verify-jwt
```

`--no-verify-jwt` lets browser `OPTIONS` preflight requests reach the function.
The function validates the Supabase user JWT itself on every `POST` before it
reads user data or contacts the AI Gateway.

Optionally restrict browser origins with the comma-separated
`WAYVO_ALLOWED_ORIGINS` Edge Function secret. When omitted, CORS echoes the
request origin; the function still requires a valid signed-in Supabase session.

The function uses the caller's JWT for profile, journey, disruption, and
recovery-plan queries, so Supabase Row Level Security remains the data boundary.
It sends only a bounded set of itinerary/status fields to the gateway. Gmail
tokens, uploaded documents, booking references, and raw import payloads are
excluded from the AI context.