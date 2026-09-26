# The trip hierarchy

Wayvo groups the journeys you are taking into **trips**. A trip is the parent;
each journey inside it is a **booking**.

```
profiles
  └── trips                    the trip you are taking  ("Goa Vacation")
        ├── journey_documents  the tickets you uploaded
        └── journey_segments   one row per booking
```

```
Goa Vacation
├── Mumbai → Pune      train
├── Pune → Goa         bus
├── Goa → Delhi        flight
└── Delhi → Mumbai     flight
```

You never create or order those four yourself. You add the bookings — by
uploading the tickets you already have, or by typing one in — and Wayvo works out
the sequence.

## Where things live

| Concern | Table | Notes |
| --- | --- | --- |
| The trip | `public.trips` | `title` is the name, plus the derived route and dates |
| A booking | `public.journey_segments` | `trip_id` is the parent, `seq` is the order |
| A ticket | `public.journey_documents` | `trip_id` links it to the trip, `segments.document_id` back to the booking |
| Disruptions | `public.disruptions` | still references `trips.id` |

`trips` *is* the itinerary rather than a separate `itineraries` table. It already
carried exactly the fields an itinerary needs (`title`, `starts_on`, `ends_on`,
`origin`, `destination`, `status`), and `disruptions` and `recovery_plans` already
point at it. A second parent table would have duplicated all of that.

## Running it

```bash
# Supabase Dashboard → SQL Editor, in order:
supabase/migrations/0001_profiles.sql
supabase/migrations/0002_travel.sql
supabase/migrations/0003_journey_import.sql
supabase/migrations/0004_trip_hierarchy.sql
```

`0004` is additive: new columns on `journey_segments` and `trips`. No existing
rows are touched and no data is rewritten.
It is also safe to re-run. If a previous attempt failed partway, the statements
that already succeeded are `if not exists` and will simply be skipped.

> **Ordering matters in SQL.** Every column is added before the constraint that
> references it. Getting that backwards fails with
> `42703: column "status" does not exist` and leaves the migration half applied.
> `npm run test:migrations` checks this statically, across every migration, so
> it cannot ship again.

Until `0004` has been run, `/journeys` says so plainly rather than showing an
empty list that would look like data loss.

## How the order is worked out

`src/lib/itineraryBuilder.ts`. It is pattern matching over what was actually read
off the tickets — not a model, and nothing is invented.

1. **Chain by location.** The next booking is the one that leaves where the
   previous one arrived.
2. **A place that is only ever a starting point is the beginning.** A round trip
   has none, so the earliest departure is used.
3. **Fall back to departure time** when the chain cannot be formed.
4. **Connection time** is the gap between arriving on one booking and leaving on
   the next.

Place names are compared after stripping decoration, so `Mumbai (BOM)`,
`MUMBAI`, `Mumbai Airport` and `Pune Junction` / `PUNE` all chain correctly. The
value stored is left exactly as the ticket printed it.

### Asking instead of guessing

Ambiguity is never hidden. The booking is still ordered — so the list is usable —
but it is flagged and the traveller is asked to confirm:

| Flag | Meaning |
| --- | --- |
| `no_location` | One end of the journey could not be read |
| `branch` | More than one booking leaves from the same place |
| `gap` | This booking does not continue from the one before it |
| `overlap` | It leaves before the previous booking arrives |
| `no_time` | A time was missing, so the connection cannot be checked |

Once confirmed, the booking is pinned: a later import will not rearrange it.

> "Automatic when confidence is high → ask only when ambiguity exists."

## What is kept per booking

Everything that was read, and how it was read:

`transport_mode`, `operator_name`, `service_number`, `origin`, `destination`,
`departure_at`, `arrival_at`, `booking_reference`, `pnr`, `passenger_name`,
`seat`, `coach`, `terminal`, `fare_amount`, `booking_status`, `source`,
`confidence`, `field_provenance`, `document_id`.

`confidence` is 0–1 from the extractor. `field_provenance` marks each field
`confirmed` / `estimated` / `missing`, so a value Wayvo inferred is never shown
as though the ticket stated it.

## Row Level Security

No new policies were needed. `journey_segments` reaches ownership through its
parent trip, and `journey_documents` carries its own `profile_id`:

- You can only read a booking if you own the trip it belongs to.
- You cannot attach a booking to somebody else's trip — the insert policy
  requires `trips.profile_id = auth.uid()`, so the write is rejected with `42501`.

Verified in the browser suite: a booking posted against a trip you do not own
comes back `403 new row violates row-level security policy`.

## Duplicate protection

Before a booking is saved, the trip is checked for the same PNR, then the same
booking reference or ticket number, then the same route and date. A match is
reported by name with the reason, and the traveller chooses whether to add it
anyway.

## Tests

```bash
npm run test:itinerary   # ordering, connection maths, every ambiguity flag
npm run test:parser      # the extractor that feeds it
```

`test:itinerary` includes the four-booking example from the specification,
supplied deliberately out of order, and asserts the route comes back in the right
sequence.
