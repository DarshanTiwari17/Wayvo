-- RailRadar observations attach to existing journey segments. Provider payloads
-- are reduced to Wayvo's normalized operational status before persistence.

alter table public.disruptions drop constraint if exists disruptions_kind_check;
alter table public.disruptions add constraint disruptions_kind_check
  check (kind in ('delay', 'cancellation', 'weather', 'closure', 'diversion', 'rescheduling', 'operational_exception'));

create unique index if not exists disruptions_one_open_provider_event_per_segment_idx
  on public.disruptions (segment_id)
  where source = 'provider' and resolved_at is null and segment_id is not null;

create table if not exists public.railradar_monitoring_state (
  segment_id uuid primary key references public.journey_segments (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  train_number text,
  provider text not null default 'railradar',
  monitoring_status text not null,
  checked_at timestamptz not null default now(),
  provider_timestamp timestamptz,
  previous_status jsonb,
  operational_status jsonb,
  operational_fingerprint text,
  current_disruption_id uuid references public.disruptions (id) on delete set null,
  last_error text,
  constraint railradar_monitoring_status_check check (
    monitoring_status in ('monitoring', 'monitoring_unavailable', 'provider_unavailable', 'stale')
  )
);

create index if not exists railradar_monitoring_profile_checked_idx
  on public.railradar_monitoring_state (profile_id, checked_at desc);

create table if not exists public.journey_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  segment_id uuid not null references public.journey_segments (id) on delete cascade,
  disruption_id uuid not null references public.disruptions (id) on delete cascade,
  notification_type text not null,
  headline text not null,
  detail text not null,
  operational_fingerprint text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint journey_notifications_event_unique unique (segment_id, disruption_id, operational_fingerprint)
);

create index if not exists journey_notifications_profile_created_idx
  on public.journey_notifications (profile_id, created_at desc);

alter table public.railradar_monitoring_state enable row level security;
alter table public.journey_notifications enable row level security;

drop policy if exists "railradar_state_select_own" on public.railradar_monitoring_state;
create policy "railradar_state_select_own" on public.railradar_monitoring_state
  for select to authenticated using (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.trips t
      where t.id = railradar_monitoring_state.trip_id and t.profile_id = (select auth.uid())
    )
  );

drop policy if exists "journey_notifications_select_own" on public.journey_notifications;
create policy "journey_notifications_select_own" on public.journey_notifications
  for select to authenticated using (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.trips t
      where t.id = journey_notifications.trip_id and t.profile_id = (select auth.uid())
    )
  );

drop policy if exists "journey_notifications_update_own" on public.journey_notifications;
create policy "journey_notifications_update_own" on public.journey_notifications
  for update to authenticated using (
    (select auth.uid()) = profile_id
  ) with check (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.trips t
      where t.id = journey_notifications.trip_id and t.profile_id = (select auth.uid())
    )
  );

revoke all on public.railradar_monitoring_state from anon, authenticated;
revoke all on public.journey_notifications from anon, authenticated;
grant select on public.railradar_monitoring_state to authenticated;
grant select on public.journey_notifications to authenticated;
grant update (read_at) on public.journey_notifications to authenticated;
grant all on public.railradar_monitoring_state to service_role;
grant all on public.journey_notifications to service_role;