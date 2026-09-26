# Journey import — setup

Importing a booking has two paths. One works as soon as you run a migration.
The other needs a server-side function you deploy once.

| Path | Needs | Status |
| --- | --- | --- |
| **Upload a PDF or photo** | `0003_journey_import.sql` | Works after the migration |
| **Import from Gmail** | migration **+ Edge Functions + Google credentials** | Needs the steps below |

Nothing here is faked. If Gmail is not set up, the button says so plainly and
points the traveller back to uploading a ticket.

---

## 1. Run the migration

Supabase Dashboard → **SQL Editor** → run:

```
supabase/migrations/0003_journey_import.sql
```

This is additive; your existing data and auth are untouched. It creates:

- `journey_documents` — metadata for uploaded tickets
- `journey_segments` — multi-leg journeys (Mumbai → Pune → Goa → Delhi)
- `gmail_connections` — the Gmail connection; **token columns are not readable by the browser**
- new columns on `trips` — booking reference, PNR, transport, seat, fare, `source`, and per-field provenance
- a private Storage bucket `travel-documents` (10 MB cap, PDFs and images only)
- Storage RLS keyed on the first path segment, which is the caller's UUID

Until it is applied, the Journeys page says *"Journey importing isn't set up on
this project yet"* instead of showing an empty list.

### Redirect / bucket notes

The Storage bucket is **private**. Documents are addressed as
`travel-documents/<your uuid>/<uuid>.pdf` and are served through short-lived
signed URLs. There is no public URL and no way to guess another user's path.

---

## 2. Gmail import — deploy the functions

Gmail access needs a Google **client secret**. A secret cannot live in browser
code, so Wayvo does this in four Edge Functions that hold the secret server
side and store the refresh token in a table the browser cannot read.

### 2a. Create Google credentials

1. [Google Cloud console](https://console.cloud.google.com/apis/credentials) → create a project (or pick one).
2. **APIs & Services → OAuth consent screen**.
   - External, add your test email as a test user, and add
     `https://<your-ref>.supabase.co/auth/v1/callback` as an authorised
     redirect URI.
3. **Credentials → Create Credentials → OAuth client ID → Web application**.
   - Authorised redirect URI: `https://<your-ref>.supabase.co/functions/v1/gmail-callback`
   - Note the **Client ID** and **Client secret**.

### 2b. Set the function secrets

```bash
supabase login
supabase link --project-ref <your-ref>
```

Copy `.env.edge.example` to `.env.edge`, fill in the two Google values, then:

```bash
supabase secrets set --env-file .env.edge
supabase secrets list          # confirm all three arrived
```

You only ever set **three** secrets:

| Secret | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ends in `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | from the same OAuth client |
| `ALLOWED_REDIRECT_ORIGINS` | `http://localhost:5173` (add your real domain later) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
**injected automatically** into every Edge Function — you do not set them, and
Supabase rejects any secret whose name starts with `SUPABASE_`. The service role
key is what lets the functions store the Gmail refresh token somewhere the
browser cannot read it, and what signs the OAuth `state`; it is safe inside a
function and must never reach a browser.

Secrets are live immediately — no redeploy needed after setting them.

### 2c. Deploy

```bash
supabase functions deploy gmail-connect
supabase functions deploy gmail-search
supabase functions deploy gmail-extract
supabase functions deploy gmail-callback --no-verify-jwt
```

**Only `gmail-callback` is exempt from JWT verification.** The other three are
called by the signed-in app through `supabase-js`, which sends the traveller's
JWT, so they keep Supabase's verification on — that verified token is what
attributes the Gmail connection to the right person.

`gmail-callback` has to be exempt because Google redirects the browser straight
there and no Supabase JWT is present. It is authenticated by an HMAC-signed,
10-minute `state` value instead (see `_shared/state.ts`), which carries only the
profile id and the return path. No access token, refresh token or JWT ever
travels in a URL.

Recent Supabase CLI versions read `verify_jwt` from `supabase/config.toml`, and
that file already sets it correctly per function. If your CLI is old enough to
ignore it, pass `--no-verify-jwt` only for `gmail-callback` as shown above.

`_shared/` is not deployed — the CLI skips directories beginning with `_`, and
the functions import from it at build time.

### 2d. Add the function URLs to Supabase

**Authentication → URL Configuration → Redirect URLs** — add:

```
http://localhost:5173/journeys
https://your-domain/journeys
```

---

## What the Gmail flow asks for

Only two scopes:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/userinfo.email
```

Read-only mail, plus the address to show in the UI. No Drive, no Calendar, no
contacts, no send. The consent screen the traveller sees says:

> Connect Gmail to let Wayvo find travel booking confirmations and itineraries.

Note that this is **separate** from Supabase's Google *login*. The Supabase
Google identity is a Wayvo account; it does not carry Gmail permissions. The
traveller authorises Gmail explicitly, in their own browser, and can revoke it at
any time in their Google account.

---

## What is and isn't stored

| Kept | Not kept |
| --- | --- |
| Extracted journey fields | Full inbox |
| Sender, subject, date of a chosen booking | Message bodies |
| A short Gmail snippet to recognise a booking | Anything about unrelated mail |
| A ticket attachment, if the traveller imported one | Attachments from unopened emails |

The Gmail search runs **in Gmail** (`newer_than:180d` against booking-related
senders and subjects). No inbox is downloaded, and a message body is only
fetched after the traveller picks that specific email.

---

## How the traveller imports from Gmail

1. **Import from Gmail** → Google's consent screen.
2. Wayvo searches Gmail and lists matches: sender, subject, date, a short
   snippet. No message bodies.
3. **Import journey** on a match → Wayvo reads that one message, prefers an
   attached PDF or image over the email body, and extracts the fields.
4. The review screen shows exactly what was read, with a ✓ next to each value
   that came from the document and ⚠ next to anything inferred.
5. **Confirm & add journey** writes it to Supabase.

---

## Extraction, honestly

Parsing is pattern matching, not a model. For every field Wayvo records how it
arrived:

| Marker | Meaning |
| --- | --- |
| ✓ | Read directly from the document |
| ⚠ | Inferred by Wayvo — please check |
| (blank) | Not present; Wayvo left it empty |

An arrival date is only ever ✓ if the document stated it. If Wayvo assumed it
from the departure date, it is marked ⚠ and a warning is shown. **Wayvo never
shows a value it did not find, and never labels a guess as confirmed.**

A supermarket receipt is rejected outright rather than turned into a journey.

Run the parser tests with:

```bash
npm run test:parser      # 67 assertions on real ticket, email and receipt text
npm run test:gmail       # signed state, open-redirect guard, candidate hints
npm run test:functions   # every function parses and handles its failure modes
```

---

## Duplicates

Before saving, Wayvo looks for a journey you already have:

1. matching **PNR**
2. matching **booking reference** or ticket number
3. failing both, matching **date + route**

If it finds one you get *"This journey may already exist in Wayvo"*, naming what
matched. You can then import anyway or open the existing journey.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Gmail import is not set up on this project yet" | Functions not deployed, or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set. Check with `supabase secrets list` |
| "Gmail couldn't be connected" after a redirect | `GOOGLE_CLIENT_SECRET` is wrong, or the Google redirect URI does not match exactly |
| Connect returns straight to /journeys with no result | The signed `state` expired (>10 min) or was rejected. Just start again; if it persists, `SUPABASE_SERVICE_ROLE_KEY` is not set |
| "Gmail access wasn't granted" | The traveller declined, or the stored refresh token was revoked |
| "We couldn't find any recent travel bookings" | No matches in the last 180 days, or everything is filed outside Gmail's search filters |
| "Gmail couldn't be connected" (before any redirect) | The function isn't deployed yet, or the browser cached an old bundle |
| "That file type isn't supported" | Anything that is not a PDF or an image |
| "We couldn't read this document" | A scanned PDF with no text layer, or a very blurry photo |
| "We couldn't find enough travel information" | A receipt, or a document with no route/date/mode |
| "Journeys aren't set up on this project yet" | `0003_journey_import.sql` has not been run |
| OCR is slow or stalls on images | Tesseract downloads its language data on first use; the first scan is slower, later ones are cached |
