# The trip hierarchy

Wayvo has **two separate ways in**, and they are deliberately not merged:

| | **Import a Booking** | **+ Add Trip** |
| --- | --- | --- |
| You want | one booking you already have | a whole itinerary |
| You give it | **one** PDF or **one** image | a name, then **any number** of PDFs and images |
| It creates | **one** journey | **one** trip containing many bookings |
| It orders | nothing — there is one leg | every booking, automatically |
| Where it lives | `/journeys` | `/journeys` → then into the trip |

Both write to the same real database. Neither is a shortcut for the other:

```
Import a Booking          + Add Trip
     │                         │
     │  one file               │  name first, then many files
     ▼                         ▼
 ONE journey              Extract every document
                              │
                              ▼
                         Normalise, match, order
                              │
                              ▼
                         ONE complete trip
```

A trip is the parent; each journey inside it is a **booking**.

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

## The single-booking path

"Import a Booking" writes the booking straight onto the `trips` row, because
there is nothing to order — a trip with one leg is just that journey. No
`journey_segments` are created. The uploaded document is linked to the same row,
so the evidence is still attached.

That is the same behaviour as before trips existed, and it is deliberately
unchanged: importing one ticket should not make you name a trip first.

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

## Adding several bookings at once

Inside a trip, "Upload tickets" accepts any number of files — PDFs, photos, or a
mix. Each one is read, extracted, stored and saved as its own booking, and only
then is the itinerary rebuilt **once for the whole set**. So the order reflects
every document together, not the order you happened to select them in.

One unreadable file does not abandon the rest: the result names every file and
says plainly which were not added and why.

## How the order is worked out

`src/lib/itineraryBuilder.ts`. It is pattern matching over what was actually read
off the tickets — not a model, and nothing is invented.

1. **Chain by location.** The next booking is the one that leaves where the
   previous one arrived.
2. **A place that is only ever a starting point is the beginning.** A round trip
   has none, so the earliest departure is used.
3. **Events are slotted in by time.** A hotel has a check-in and a check-out but
   no route, so it cannot be chained onto a leg. It goes into the gap it belongs
   in — after the bus that arrives before the check-in — which also makes the
   connection time between them come out right.
4. **Fall back to departure time** when the chain cannot be formed at all.
5. **Connection time** is the gap between arriving on one booking and leaving on
   the next.
6. **The result is checked against the clock.** A chain can break silently: if
   one ticket prints "ALIBAG" and another "Alibaug", the stops do not match, the
   walk starts from the wrong end, and every individual link still looks valid.
   An order that runs backwards in time is therefore reported rather than
   presented as the answer.

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
| `out_of_sequence` | Placed before a booking that leaves earlier, so the order may be wrong |

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
