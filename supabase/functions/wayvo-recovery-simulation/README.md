# Wayvo Recovery Simulation Edge Function

A separate authenticated Edge Function for the Recovery page's disruption simulation. It accepts only a trip ID, segment ID, and simulated event. It verifies the caller, then reads the trip, ordered itinerary segments, and saved recovery plans using that caller's JWT so existing row-level security remains the ownership boundary. It does not write disruptions or recovery plans and does not book or claim live availability.

## Configure and deploy

Set the Nugen key as a Supabase function secret (never in browser `.env` or source), then deploy this function:

```sh
supabase secrets set NUGEN_API_KEY=your-nugen-key
supabase functions deploy wayvo-recovery-simulation --no-verify-jwt
```

`verify_jwt = false` allows CORS preflight requests through; the function validates the Supabase access token itself on every POST. The existing `nugen-travel-chat` function and regular travel assistant are separate and unchanged.

## Request

```json
{
  "tripId": "<owned-trip-uuid>",
  "segmentId": "<segment-uuid-from-that-trip>",
  "kind": "delay",
  "delayMinutes": 35,
  "stream": true
}
```

Supported kinds are `delay`, `cancellation`, and `missed connection`. A missed connection is accepted only when the selected step has a following itinerary segment with a saved connection buffer. Responses stream server-sent events shaped as `data: {"token":"..."}`; provider errors are sent as `data: {"error":"..."}`.
