-- ===========================================================================
-- Wayvo — 0002_travel.sql
--
-- Adds the first product tables on top of `public.profiles`:
--   trips           → the journeys a traveller is looking after
--   disruptions     → something that changed on a journey
--   recovery_plans  → what Wayvo proposes to do about it
--
-- These follow exactly the conventions set in 0001_profiles.sql:
--   * every row is owned by exactly one profile (cascade on user deletion)
--   * RLS on, owner-scoped select/insert/update, no client-side delete
--   * anon gets nothing; authenticated gets only what it needs
--
-- This migration is additive: it does not touch auth.users or public.profiles.
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Shared updated_at trigger (defined in 0001)
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  origin      text,
  destination text,
  status      text not null default 'planning',
  starts_on   date,
  ends_on     date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint trips_status_check
    check (status in ('planning', 'booked', 'active', 'completed', 'cancelled')),
  constraint trips_dates_ordered
    check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint trips_title_length
    check (char_length(btrim(title)) between 1 and 120)
);

comment on table public.trips is 'Journeys the traveller is looking after. One row per journey.';

create index if not exists trips_profile_created_idx
  on public.trips (profile_id, created_at desc);

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
  before update on public.trips
  for each row
  execute function public.set_profiles_updated_at();


-- ---------------------------------------------------------------------------
-- disruptions
-- ---------------------------------------------------------------------------
create table if not exists public.disruptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  trip_id      uuid references public.trips (id) on delete cascade,
  kind         text not null,
  severity     text not null default 'info',
  headline     text not null,
  detail       text,
  reported_at  timestamptz not null default now(),
  resolved_at  timestamptz,

  constraint disruptions_severity_check
    check (severity in ('info', 'warn', 'critical')),
  constraint disruptions_headline_length
    check (char_length(btrim(headline)) between 1 and 200)
);

comment on table public.disruptions is
  'Something that changed on a journey: a delay, a cancellation, a missed connection.';

create index if not exists disruptions_profile_reported_idx
  on public.disruptions (profile_id, reported_at desc);

drop trigger if exists disruptions_set_updated_at on public.disruptions;
create trigger disruptions_set_updated_at
  before update on public.disruptions
  for each row
  execute function public.set_profiles_updated_at();


-- ---------------------------------------------------------------------------
-- recovery_plans
-- ---------------------------------------------------------------------------
create table if not exists public.recovery_plans (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  trip_id        uuid not null references public.trips (id) on delete cascade,
  disruption_id  uuid references public.disruptions (id) on delete set null,
  title          text not null,
  summary        text,
  total_cost     numeric(12, 2),
  currency       char(3) not null default 'USD',
  status         text not null default 'proposed',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint recovery_plans_status_check
    check (status in ('proposed', 'accepted', 'dismissed')),
  constraint recovery_plans_cost_non_negative
    check (total_cost is null or total_cost >= 0)
);

comment on table public.recovery_plans is
  'What Wayvo proposes to do about a disruption, for the traveller to accept or dismiss.';

create index if not exists recovery_plans_profile_created_idx
  on public.recovery_plans (profile_id, created_at desc);

drop trigger if exists recovery_plans_set_updated_at on public.recovery_plans;
create trigger recovery_plans_set_updated_at
  before update on public.recovery_plans
  for each row
  execute function public.set_profiles_updated_at();


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Same shape as `profiles`: the caller may read, create and update only their
-- own rows. `auth.uid()` is compared to `profile_id`, which is by construction
-- the caller's own profiles.id.
-- ---------------------------------------------------------------------------

alter table public.trips enable row level security;
alter table public.disruptions enable row level security;
alter table public.recovery_plans enable row level security;

-- trips -----------------------------------------------------------------------
drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "trips_insert_own" on public.trips;
create policy "trips_insert_own"
  on public.trips
  for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

drop policy if exists "trips_update_own" on public.trips;
create policy "trips_update_own"
  on public.trips
  for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- disruptions ------------------------------------------------------------------
drop policy if exists "disruptions_select_own" on public.disruptions;
create policy "disruptions_select_own"
  on public.disruptions
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "disruptions_insert_own" on public.disruptions;
create policy "disruptions_insert_own"
  on public.disruptions
  for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

drop policy if exists "disruptions_update_own" on public.disruptions;
create policy "disruptions_update_own"
  on public.disruptions
  for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- recovery_plans ---------------------------------------------------------------
drop policy if exists "recovery_plans_select_own" on public.recovery_plans;
create policy "recovery_plans_select_own"
  on public.recovery_plans
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "recovery_plans_insert_own" on public.recovery_plans;
create policy "recovery_plans_insert_own"
  on public.recovery_plans
  for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

drop policy if exists "recovery_plans_update_own" on public.recovery_plans;
create policy "recovery_plans_update_own"
  on public.recovery_plans
  for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- No delete policies anywhere: rows disappear with the auth user, not on request.


-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on table public.trips from anon;
revoke all on table public.disruptions from anon;
revoke all on table public.recovery_plans from anon;

revoke all on table public.trips from authenticated;
revoke all on table public.disruptions from authenticated;
revoke all on table public.recovery_plans from authenticated;

grant select, insert, update on table public.trips to authenticated;
grant select, insert, update on table public.disruptions to authenticated;
grant select, insert, update on table public.recovery_plans to authenticated;


-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- As two different signed-in users, A should never see B's rows:
--   select count(*) from public.trips;                 -- only your own
--   insert into public.trips (profile_id, title)
--     values ('<someone-elses-uuid>', 'nope');         -- must raise 42501
--
-- Run as the table owner in the SQL Editor to see the real totals:
--   select count(*) from public.trips;
