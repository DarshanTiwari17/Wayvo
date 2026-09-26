# Supabase setup for Wayvo

Two things must be true before the Wayvo login page can do anything real:

1. The **schema** exists (`profiles` + RLS policies + the signup trigger).
2. The **project credentials** are in `.env.local`.

---

## 1. Run the schema

Open **Supabase Dashboard → SQL Editor** and run:

```
supabase/migrations/0001_profiles.sql
```

It is idempotent — safe to run more than once. It creates:

| Object | Purpose |
| --- | --- |
| `public.profiles` | One row per traveller, `id` references `auth.users(id)` `on delete cascade` |
| `profiles_set_updated_at` trigger | Keeps `updated_at` truthful |
| `handle_new_user()` + `on_auth_user_created` trigger | Creates the profile row on sign-up / OAuth |
| RLS policies | `select` / `insert` / `update` restricted to `auth.uid() = id` |
| Grants | `authenticated` gets select/insert/update only; `anon` gets nothing |

Or with the CLI:

```bash
npx supabase init          # once
npx supabase link --project-ref <your-ref>
npx supabase db push
```

---

## 2. Point the app at the project

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API → Project API keys → **anon** / public |
| `VITE_SUPABASE_EMAIL_REDIRECT_URL` | Your own origin + `/reset-password` |

> Never put the `service_role` key in a `VITE_` variable. It bypasses RLS and Vite would bundle it into the page for the world to read.

---

## 3. Allow the redirect URLs

**Authentication → URL Configuration → Redirect URLs** must contain:

- `http://localhost:5173/reset-password` (password recovery)
- `http://localhost:5173/dashboard` (Google OAuth)
- `https://your-production-domain/reset-password`
- `https://your-production-domain/dashboard`

Supabase silently refuses to redirect to anything not on this list, which shows up as "Invalid redirect URL" or an expired-link error.

---

## 4. Enable the Google provider

**Authentication → Providers → Google**

1. Toggle it on.
2. Create OAuth credentials in the [Google Cloud console](https://console.cloud.google.com/apis/credentials):
   - OAuth consent screen → add `https://<your-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI.
   - Create a **Web application** OAuth client.
3. Paste the **Client ID** and **Client Secret** into Supabase.
4. Save.

You do not need to set a callback URL in the Google client itself — Google redirects to Supabase, and Supabase redirects to you.

Without this, `signInWithGoogle()` returns a real error, which the login page shows inline. Nothing falls back to a mock.

---

## 5. Email confirmation

**Authentication → Email → Confirm email** controls the sign-up behaviour:

| Setting | What Wayvo does |
| --- | --- |
| **On** (recommended) | `signUp` returns no session, so `/signup` shows "Verify your email" and offers a resend. Signing in before confirming produces a specific, actionable message. |
| **Off** | `signUp` returns a session immediately and the traveller lands on `/dashboard`. |

For local testing without an inbox, enable **Email → SMTP** or leave the built-in
rate-limited test mailer on (it only delivers to project team members).

---

## 6. Verification checklist

Everything below is a **human** check against your real project. The app cannot
prove these on its own.

### A. Sign up creates a user *and* a profile

1. `npm run dev`, open `http://localhost:5173/signup`.
2. Submit a fresh email.
3. **Auth → Users** shows the new row.
4. **SQL Editor:**
   ```sql
   select id, full_name, email from public.profiles order by created_at desc limit 5;
   ```
   One row, with the same UUID and the name you typed.
5. Click the confirmation link from your inbox, then sign in.

### B. Sign in works and the session survives a refresh

1. Sign in on `/login`.
2. You land on `/dashboard`.
3. Press **F5**. Still on `/dashboard` — the session is restored from storage, not re-authenticated.
4. Close the tab, reopen `http://localhost:5173/dashboard` in the same browser: still signed in (because "Remember me?" is ticked).
5. Unticking "Remember me?" stores the session in `sessionStorage` instead, so it dies with the tab.

### C. Sign out

1. Click **Sign out** → redirected to `/login`.
2. `localStorage`/`sessionStorage` no longer contain the Supabase auth token
   (`sb-<ref>-auth-token`).
3. Going straight to `/dashboard` bounces you back to `/login`.

### D. Password reset

1. `/forgot-password` → enter the email → "Check your inbox".
2. Open the link. It lands on `/reset-password` with a valid recovery session.
3. Set a new password → redirected to `/dashboard`.
4. Sign in with the **old** password: it must fail. With the **new** one: it must work.
5. Reuse the same link: it must show "Reset link expired".

### E. Google sign-in

1. Click **Continue with Google** on `/login`.
2. Complete the consent screen → you land on `/dashboard` and a row appears in `public.profiles` (the trigger reads Google's `name` / `picture` metadata).
3. Decline the consent screen → you are returned to `/login` with a real message, not a blank page.

### F. RLS isolation — the important one

Create two accounts, `a@example.com` and `b@example.com`.

**In the browser (as user A, signed in), open the console:**

```js
const sb = (await import('/src/lib/supabase.ts')).getSupabase()
const victim = '<paste user B's UUID>'

// 1. Direct read of B's row -> must return 0 rows
await sb.from('profiles').select('*').eq('id', victim)
// -> { data: [], error: null }   (RLS filters it out, no error is raised)

// 2. Unfiltered read -> must only ever return A's own row
await sb.from('profiles').select('id, email')
// -> exactly one row, A's

// 3. Write to B's row -> must be rejected
await sb.from('profiles').update({ full_name: 'hijacked' }).eq('id', victim)
// -> error: 42501 / "row-level security policy"

// 4. Insert a row owned by B -> must be rejected
await sb.from('profiles').insert({ id: victim, email: 'x@y.z' })
// -> error: 42501 / "new row violates row-level security policy"

// 5. Update A's own row -> must succeed
await sb.from('profiles').update({ phone: '+1 555 0199' }).eq('id', (await sb.auth.getUser()).data.user.id)
// -> one row back
```

**While signed out** (or with a fresh private window), every `profiles` query
must fail with `401` / `42501`:

```js
await sb.from('profiles').select('*')  // -> 401
```

**From SQL Editor** (runs as the table owner, so RLS is bypassed) the full table
is visible — that is expected and is *why* the anon key is safe to ship but the
`service_role` key is not:

```sql
select count(*) from public.profiles;   -- should now be >= 2
```

### G. No mock data

1. `grep -rn "supabase.co" src/` → no hardcoded project URL.
2. `grep -rniE "service_role" src/` → no service-role key.
3. `grep -rniE "fakeUser|mockUser|demoUser|hardcoded|Jane Doe" src/` → nothing.
4. Delete `.env.local` and reload → the app shows the **Supabase is not
   configured** screen instead of a login form that pretends to work.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Invalid API key` | `VITE_SUPABASE_ANON_KEY` is wrong, or you pasted the `service_role` key |
| `Email not confirmed` | Sign up with this address again, or click **Resend verification email** |
| `Invalid redirect URL` | The redirect URL is missing from URL Configuration (section 3) |
| `This link is invalid or has expired` | Recovery links are single-use and short-lived; request a new one |
| `Email sign-in is not enabled` | The Email provider is switched off in Authentication → Providers |
| `row-level security policy` on insert | The `handle_new_user` trigger is missing — re-run the migration |
| Dashboard shows "Could not load your profile" | The table does not exist, or the anon role lacks grants. Re-run the migration and check `anon` has **no** grants on `profiles` |
