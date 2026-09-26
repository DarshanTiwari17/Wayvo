# RailRadar train monitoring

RailRadar provides the operational train-status data. Wayvo does not invent train location, delay, cancellation, or expected arrival.

## Provider and security

The server-side Edge Function calls:

```text
GET https://api.railradar.in/v1/trains/{number}/live
Authorization: Bearer <RAILRADAR_API_KEY>
```

The browser never calls RailRadar. `RAILRADAR_API_KEY`, `RAILRADAR_MONITORING_SECRET`, and the Supabase service-role key are Edge Function secrets only. Do not put them in `.env`, a `VITE_` variable, frontend code, or a database row. The function discards the original provider response after normalizing the fields Wayvo uses.

Use [.env.edge.example](../.env.edge.example) as the template for the ignored local `.env.edge` file. Add the real API key and a separately generated random monitor secret to `.env.edge`, then configure and deploy:

```powershell
npx supabase secrets set --env-file .env.edge --project-ref <project-ref>
npx supabase functions deploy railradar --project-ref <project-ref>
```

Never commit `.env.edge`. Do not copy the RailRadar key into `.env`; Vite uses that file for the browser application.

## Data and lifecycle

The monitor reads existing `journey_segments` joined to `trips` in planning, booked, or active status. It uses an existing segment `service_number` first, then checks the booking import payload. If neither supplies a number, it calls `GET /v1/lookup/search/stations?q={origin}&limit=50` for both segment endpoints. Exact station names are preferred; an exact city match searches all provider-returned stations for that city. It then calls `GET /v1/trains/between/{from}/{to}?date={journeyDate}&live=true` for the resolved station-code pairs. The date is the segment departure date (or parent trip start date), filtered at the `from` station as RailRadar documents.

Wayvo matches provider candidates using the existing service number/import payload, a date-matching RailRadar PNR result where available, exact train name, and exact imported departure/arrival times. One safely matching candidate is written to the same `journey_segments.service_number`; `service_number_source` records `booking_import`, `railradar`, or `manual_clarification`. Multiple candidates are not auto-selected: they are saved as `ambiguous` and the traveller can choose one of the listed provider candidates. The browser cannot submit an arbitrary train number through this choice; it must select a candidate saved for that owned segment. The following scheduled poll uses the selected number for live status.

Identification states are `identified`, `ambiguous`, `not_found`, and `unavailable` (with transient `identifying`). Missing route/date information or provider errors remain unavailable; zero station/train results are not found. Wayvo does not infer a route, date, train, delay, or status. Apply migrations `0009_railradar_monitoring.sql` and `0010_railradar_train_identification.sql` after migrations 0001–0008.

The endpoint accepts no trip, segment, profile, or train number from its caller. It scans database-owned journey rows with the service role and is callable only with `x-monitor-secret`, compared in constant time. Browser reads of `railradar_monitoring_state` and `journey_notifications` are protected by owner-scoped RLS. Candidate selection reads the owner-scoped snapshot and updates only that user's existing segment under its existing RLS policy.

Normalized operational state includes train identity, status, provider timestamp, delay minutes, current location/station, previous/next halt, expected arrival/departure, platform, cancellation/diversion/rescheduling flags, and provider exceptions. Only this normalized state is persisted. The state row keeps the previous and current normalized observations, provider, check time, fingerprint, and open disruption reference.

Repeated identical operational state does not create another event. Material changes update the existing open provider disruption for that segment; a return to a fresh, normal report resolves it. Stale data is retained as a stale observation but never creates or updates a disruption. Provider failures retain the last known state, record an error and check time, and are retried by the next scheduled invocation. The UI never presents a stale position as live and displays the provider timestamp when available.

For a fresh disruption, the monitor writes the existing `disruptions` row, invokes Wayvo's existing impact and refund-policy engines, persists the current eligibility evaluation, and then creates an owner-scoped journey notification. Missing applicable policy remains an explicit no-policy result. Monitoring code applies no refund thresholds. No cancellation, TDR, claim, payment, or other external money action is performed.

## Scheduling

No schedule is enabled by this repository or by deploying the function. Configure one after deployment. Supabase supports scheduled invocation with `pg_cron`, `pg_net`, and Vault:

1. Enable the `pg_cron`, `pg_net`, and Vault extensions for the project.
2. Store the same value used for `RAILRADAR_MONITORING_SECRET` in Vault under `railradar_monitoring_secret`.
3. Replace `<project-ref>` below and create the schedule:

```sql
select cron.schedule(
  'wayvo-railradar-monitor',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/railradar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-monitor-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'railradar_monitoring_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
```

The default scan includes journeys departing within three days and segments whose scheduled arrival/departure is within the prior 24 hours. Provider data is stale after ten minutes by default. These are scheduling/freshness settings, not refund rules; override with `RAILRADAR_LOOKAHEAD_DAYS`, `RAILRADAR_LOOKBACK_HOURS`, and `RAILRADAR_STALE_AFTER_SECONDS` Edge Function secrets as appropriate.

The endpoint response reports scan counts, not raw provider payloads. Monitor Supabase Edge Function logs and Cron run history. If secrets, schema, provider, or network are unavailable, no synthetic status is written.

## Real and development-only behavior

Provider status is real only after the RailRadar key is installed as an Edge Function secret and the scheduled job is enabled. The Journey page reads persisted state; opening it does not poll RailRadar. The manual disruption simulator is rendered only in development and is labeled “Developer test tools.” It does not seed or affect production monitoring state.

Users may review the deterministic policy result in Wayvo. Wayvo never submits a refund, TDR, cancellation, or external claim automatically.