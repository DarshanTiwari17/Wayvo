# Wayvo

Wayvo is a travel-disruption recovery app. This repository currently ships
**real Supabase authentication and the `profiles` table**, plus the auth UI
built to the supplied `/login` reference design.

There is no mock auth, no seeded user and no localStorage session store. Every
identity on screen comes from Supabase `auth.users` and `public.profiles`.

---

## Quick start

```bash
npm install

# 1. run the schema, in order (Supabase Dashboard -> SQL Editor)
#    supabase/migrations/0001_profiles.sql
#    supabase/migrations/0002_travel.sql
#    supabase/migrations/0003_journey_import.sql
#    supabase/migrations/0004_trip_hierarchy.sql
#    supabase/migrations/0005_refund_policy_foundation.sql
#    supabase/migrations/0006_public_policy_library.sql
#    supabase/migrations/0007_disruption_impact.sql
#    supabase/migrations/0008_refund_evaluation_current.sql
#    supabase/migrations/0009_railradar_monitoring.sql
#    supabase/migrations/0010_railradar_train_identification.sql

# 2. add credentials
cp .env.example .env             # then paste your project URL + anon key

# 3. go
npm run dev
```

Put them in `.env`, not `.env.local`: Vite loads `.env.local` **in
preference** to `.env`, so a stray `.env.local` silently overrides the values
below and the app will talk to the wrong project.

Without any credentials the app renders a **Supabase is not configured** screen
rather than a login form that cannot work.

Full setup, Google OAuth configuration and the live verification checklist:
**[`supabase/README.md`](supabase/README.md)**.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Types only |
| `npm run test` | All three suites below |
| `npm run test:parser` | 67 assertions against the booking extractor |
| `npm run test:itinerary` | 68 assertions on ordering, connections and ambiguity |
| `npm run test:railradar` | Provider normalization, freshness, deduplication, impact and policy integration |
| `npm run test:migrations` | Every migration adds a column before using it, and is safe to re-run |
| `npm run test:gmail` | Signed OAuth `state`, open-redirect guard, candidate hints |
| `npm run test:functions` | Every Edge Function parses and handles its failure modes |

---

## Routes

| Path | Guard | Notes |
| --- | --- | --- |
| `/` | — | Redirects to `/dashboard` or `/login` based on the live session |
| `/login` | public only | Reference design. Email + password, or Google |
| `/signup` | public only | Creates the user; the DB trigger creates the profile |
| `/forgot-password` | public only | Emails a real Supabase recovery link |
| `/reset-password` | public only | Arrives from the email link; sets the new password |
| `/dashboard` | **protected** | Redirects to `/login` when signed out |
| `/setup` | — | Rendered automatically when credentials are missing |

---

## Architecture

```
src/
├── lib/
│   ├── supabaseConfig.ts      env validation, redirect-url helpers
│   ├── supabase.ts            THE single Supabase client (never created elsewhere)
│   ├── authErrors.ts          Supabase/PostgREST error -> human message
│   ├── authUrlState.ts        reads the error fragment on a callback redirect
│   └── bookingParser.ts       ticket text -> structured journey + provenance
├── contexts/
│   ├── authContext.ts         context object + types (no components, so HMR works)
│   └── AuthProvider.tsx       the one place auth state lives
├── services/
│   ├── profileService.ts      every `profiles` query in the app
│   ├── travelService.ts       journeys, disruptions, recovery plans
│   ├── documentReader.ts      PDF text (pdf.js) + photo OCR (Tesseract)
│   ├── documentService.ts     Supabase Storage upload + metadata rows
│   ├── importService.ts       dedup, save journey + segments
│   └── gmailService.ts        browser side of the Gmail flow (Edge Functions only)
├── hooks/
│   ├── useAuth.ts             typed accessor for the context
│   └── useTravelData.ts       real queries with loading / empty / error / missing
├── components/
│   ├── auth/                  the reference login design system (glass)
│   ├── app/                   the product design system (light, minimal)
│   ├── journeys/              import panel, review screen, itinerary view,
│   │                           trip card, manual booking form
│   └── routing/               ProtectedRoute / PublicOnlyRoute / RouteLoader
├── pages/                     one file per route
└── types/database.ts          Supabase-generated schema types

supabase/
├── migrations/
│   ├── 0001_profiles.sql          profiles + RLS + signup trigger
│   ├── 0002_travel.sql            trips, disruptions, recovery_plans + RLS
│   ├── 0003_journey_import.sql    import columns, segments, documents,
│   │                               gmail_connections, Storage bucket + RLS
│   └── 0004_trip_hierarchy.sql   segments as bookings of a trip: provenance,
│                                   confidence, computed order, review flags
└── functions/                 Deno Edge Functions (hold the Google secret)
    ├── config.toml            per-function verify_jwt; deploy with
    │                          `supabase functions deploy <name>`
    ├── _shared/                NOT deployed — CLI skips `_` dirs
    │   ├── gmail.ts            scopes, token exchange, MIME parsing
    │   └── state.ts            signed + expiring OAuth `state`
    ├── gmail-connect/          POST   → Google consent URL
    ├── gmail-callback/         GET    ← Google redirect (verify_jwt = false)
    ├── gmail-search/           POST   → booking candidates from Gmail
    └── gmail-extract/          POST   → one chosen email, parsed
```

Deploy and secrets: [`supabase/JOURNEY-IMPORT.md`](supabase/JOURNEY-IMPORT.md).
RailRadar setup and scheduling: [`supabase/RAILRADAR-MONITORING.md`](supabase/RAILRADAR-MONITORING.md).

### Two design languages, on purpose

| Surface | Language |
| --- | --- |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Cinematic glass over the nature photograph, per the reference image |
| Everything behind `/dashboard` | Light, solid surfaces, hairline borders, small radii, restrained shadows, colour only for meaning |

They never mix. The `.wayvo-*` classes belong to the auth screens; the
`.wva-*` classes to the product. No glass or photography appears in the
signed-in app.


### The Supabase client

`src/lib/supabase.ts` is the only place `createClient` is called. Components
import `useAuth()` or a service; they never construct a connection.

```ts
const supabase = getSupabase()   // one client, one token store
```

Configured with `persistSession` (this is what survives a refresh),
`autoRefreshToken` (long sessions don't silently expire) and
`detectSessionInUrl` (picks up the token on email links).

Only the **anon** key is ever used. It is designed to be public *provided RLS
is on* — which is why §4 of the migration is not optional.

### Authentication state

`AuthProvider` exposes exactly what the app needs, in one place:

```ts
user  session  loading  status  isEmailConfirmed
signIn()  signInWithGoogle()  signUp()  signOut()
resetPassword()  updatePassword()  resendVerificationEmail()
profile  profileStatus  profileError  refreshProfile()  updateProfile()
rememberSession  isRecoverySession  urlAuthError  configError
```

It subscribes to `supabase.auth.onAuthStateChange`, so the UI reacts to
`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED` and
`PASSWORD_RECOVERY`. `loading` is `true` only while the persisted session is
being restored — route guards render a loader in that window rather than
bouncing a signed-in user to `/login` on refresh.

### Profiles

- `auth.users` — credentials, email confirmation, tokens. Never duplicated.
- `public.profiles` — application-specific traveller data, one row per user,
  created by the `on_auth_user_created` trigger.
- The app never fabricates a profile. If a row is missing it is created once
  via an idempotent upsert; if the query fails, the dashboard shows the real
  error and a retry button.

### Remember me?

Not decorative. supabase-js normally persists to `localStorage`. When the box is
unticked, `src/lib/supabase.ts` routes the token to `sessionStorage` instead, so
the session lasts for the tab but not for a new browser session.

### Row Level Security

`profiles` has RLS on, with `select` / `insert` / `update` policies all scoped
to `(select auth.uid()) = id`, no `delete` policy, no grants to `anon`, and
`select`/`insert`/`update` only for `authenticated`. Isolation is enforced by
Postgres, not by the UI — the client-side `.eq('id', userId)` filters are a
convenience, not the control. See `supabase/README.md` §6F for the tests.

> `force row level security` is deliberately **not** used: it would also apply
> to the table owner, and `handle_new_user()` runs as that owner with no JWT
> claim, which would break sign-up entirely. The comment in the migration
> explains it.

### Design system

`src/index.css` holds the tokens extracted from the reference: Montserrat for
display, Inter for text, the deep-forest ink, the frosted-glass card, the
translucent inputs, the white uppercase button, the uppercase headline, the
white rule and the four social discs.

Layout is a two-column grid at ≥768px with the reference's asymmetric margins
(card ~13% in from the left, headline running to ~5.5% from the right), and
stacks card-then-headline below 768px so the visual hierarchy is preserved
rather than scaled. The background photograph is published once as
`--wayvo-hero-image` on `<html>` and overridable with
`VITE_WAYVO_HERO_IMAGE`.

### Login image credit

`public/images/wayvo-waterfall.jpg` is an Unsplash photograph used as the hero
backdrop. Replace it with Wayvo's own photography by dropping a file in
`public/images/` or pointing `VITE_WAYVO_HERO_IMAGE` at a URL.

---

## Not implemented yet

`bookings`, `trip_segments`, `travel_preferences` and `traveler_preferences` are
designed but not created. The Alerts and Recovery pages query their real tables
and show honest empty states. Shapes, RLS patterns and the conventions new
tables must follow are in [`supabase/ROADMAP.md`](supabase/ROADMAP.md).

---

## Journey import

Journeys can be brought in from a booking rather than typed by hand:

- **Upload a ticket or PDF** — a real file picker, the file is stored in
  Supabase Storage, read with pdf.js (PDF) or Tesseract OCR (photo), and parsed.
- **Import from Gmail** — a real Google consent flow, executed server-side by
  Edge Functions so the client secret and the Gmail refresh token never reach the
  browser.

Both paths land on the same review screen. Extraction is pattern matching, so
**nothing is written to Supabase until the traveller confirms**, every field is
editable, and each one is labelled as read from the document (✓) or inferred by
Wayvo (⚠). A value that was not found stays empty rather than being invented,
and a supermarket receipt is rejected rather than turned into a journey.

Set-up for the migration, the Storage bucket and the Gmail functions:
**[`supabase/JOURNEY-IMPORT.md`](supabase/JOURNEY-IMPORT.md)**.

---

## Security notes

- `VITE_SUPABASE_ANON_KEY` only. The `service_role` key bypasses RLS and must
  never reach a `VITE_` variable — Vite inlines those into the bundle.
- `.env*` is git-ignored except `.env.example`; `.env.edge` (the two Google
  OAuth secrets) is ignored too. `SUPABASE_SERVICE_ROLE_KEY` is never set by
  hand: Supabase injects it into every Edge Function and rejects any
  `SUPABASE_`-prefixed secret.
- Passwords are sent only to Supabase over TLS; nothing is logged or stored by
  Wayvo.
- Uploaded documents live in a **private** bucket addressed by the caller's own
  UUID, enforced by Storage RLS. They are served only through short-lived
  signed URLs.
- `gmail_connections` grants the browser six non-sensitive columns. The refresh
  and access tokens are readable only by the service role inside the Edge
  Functions, so `select refresh_token from gmail_connections` is denied from the
  client.
