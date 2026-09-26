# Wayvo data model — roadmap

This release ships **authentication + `profiles` only**. The tables below are
the agreed target shape so later features can hang off `profiles.id` without a
schema migration later.

```
auth.users
    │
    ▼
profiles                      ← implemented (0001_profiles.sql)
    │
    ├── traveler_preferences   ─┐
    │                          ├─ one-to-one, keyed on profiles.id
    ├── travel_preferences    ─┘
    │
    ├── trips
    │      ├── trip_segments
    │      ├── bookings
    │      └── disruptions
    │
    └── recovery_plans
```

## Conventions every new table must follow

1. **Owner column.** `profile_id uuid not null references public.profiles(id) on delete cascade`.
   Cascade from `profiles` means deleting the auth user removes every trace.
2. **RLS on, always.** Enable RLS and write owner-scoped policies using the
   Supabase performance form `(select auth.uid())`-equivalent, i.e. compare
   against the caller's own profile id. No table ships without policies.
3. **No `delete` grant to clients.** Rows are removed by cascading from
   `auth.users`, never by the browser.
4. **`created_at` / `updated_at`.** `timestamptz not null default now()`, with
   the same `updated_at` trigger used by `profiles`.
5. **Auth data stays in `auth.users`.** No copies of passwords, email
   confirmation state or tokens.
6. **Type parity.** After a table is added, regenerate `src/types/database.ts`:
   ```bash
   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
   ```

## Draft shapes (not yet created)

```sql
-- one-to-one with profiles
create table public.traveler_preferences (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  preferred_cabin     text,
  seat_preference     text,
  dietary_notes       text,
  accessibility_notes text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- one-to-many with profiles
create table public.travel_preferences (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  pace            text,           -- slow / balanced / packed
  budget_band     text,
  sustainability  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.trips (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  status       text not null default 'planning',  -- planning / booked / active / completed
  starts_on    date,
  ends_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.trip_segments (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  seq         integer not null,
  from_place  text not null,
  to_place    text not null,
  departs_at  timestamptz,
  arrives_at  timestamptz,
  mode        text,               -- rail / air / road / ferry
  ref         text,               -- booking reference
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  segment_id    uuid references public.trip_segments (id) on delete cascade,
  trip_id       uuid not null references public.trips (id) on delete cascade,
  provider      text not null,
  confirmation  text,
  total_amount  numeric(12, 2),
  currency      char(3) not null default 'USD',
  status        text not null default 'held',   -- held / confirmed / cancelled
  booked_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.disruptions (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  segment_id    uuid references public.trip_segments (id) on delete cascade,
  kind          text not null,    -- delay / cancellation / missed-connection
  severity      text not null,    -- info / warn / critical
  summary       text not null,
  reported_at   timestamptz not null default now(),
  resolved_at   timestamptz
);

create table public.recovery_plans (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips (id) on delete cascade,
  disruption_id  uuid references public.disruptions (id) on delete set null,
  option_rank    smallint not null default 1,
  summary        text not null,
  total_cost     numeric(12, 2),
  currency       char(3) not null default 'USD',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

Each of these needs the owner policy pattern, adapted per table. For a
one-to-many child of `trips` the policy looks like:

```sql
alter table public.trips enable row level security;

create policy "trips_select_own" on public.trips
  for select to authenticated
  using ((select auth.uid()) = profile_id);

create policy "trips_insert_own" on public.trips
  for insert to authenticated
  with check ((select auth.uid()) = profile_id);

create policy "trips_update_own" on public.trips
  for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

revoke all on table public.trips from anon;
grant select, insert, update on table public.trips to authenticated;
```

and for a grandchild such as `trip_segments`, which is owned *indirectly*:

```sql
create policy "trip_segments_select_own" on public.trip_segments
  for select to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_segments.trip_id
        and t.profile_id = (select auth.uid())
    )
  );
```

> Do **not** add `force row level security` to tables that have a `security
> definer` trigger. `0001_profiles.sql` explains why: it would make the trigger
> itself fail RLS. See the comment in that migration.

Until these tables exist, the dashboard's "Coming next" panel says so
explicitly rather than rendering placeholder rows.
