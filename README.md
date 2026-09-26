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

# 1. run the schema (Supabase Dashboard -> SQL Editor)
#    supabase/migrations/0001_profiles.sql

# 2. add credentials
cp .env.example .env.local       # then paste your project URL + anon key

# 3. go
npm run dev
```

Without `.env.local` the app renders a **Supabase is not configured** screen
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
│   ├── supabaseConfig.ts   env validation, redirect-url helpers
│   ├── supabase.ts         THE single Supabase client (never created elsewhere)
│   ├── authErrors.ts       Supabase/PostgREST error -> human message + validation
│   └── authUrlState.ts     reads the error fragment on a callback redirect
├── contexts/
│   ├── authContext.ts     context object + types (no components, so HMR works)
│   └── AuthProvider.tsx   the one place auth state lives
├── services/
│   └── profileService.ts   every `profiles` query in the app
├── hooks/
│   ├── useAuth.ts          typed accessor for the context
│   └── useProfile.ts       on-demand profile read
├── components/
│   ├── auth/               the reference login design system
│   ├── dashboard/          signed-in chrome
│   └── routing/            ProtectedRoute / PublicOnlyRoute / RouteLoader
├── pages/                  one file per route
└── types/database.ts       Supabase-generated schema types
```

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

`trips`, `trip_segments`, `bookings`, `disruptions`, `recovery_plans`,
`travel_preferences` and `traveler_preferences` are designed but not created.
The dashboard's "Coming next" panel lists them as unavailable rather than
rendering fake rows. Shapes, RLS patterns and the conventions new tables must
follow are in [`supabase/ROADMAP.md`](supabase/ROADMAP.md).

---

## Security notes

- `VITE_SUPABASE_ANON_KEY` only. The `service_role` key bypasses RLS and must
  never reach a `VITE_` variable — Vite inlines those into the bundle.
- `.env*` is git-ignored except `.env.example`.
- Passwords are sent only to Supabase over TLS; nothing is logged or stored by
  Wayvo.
