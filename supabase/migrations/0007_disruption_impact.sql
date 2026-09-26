-- ===========================================================================
-- Wayvo - 0007_disruption_impact.sql
--
-- Extends the existing disruption model with segment-level schedule facts.
-- The simulator writes ordinary disruption rows with source = 'simulator'.
-- ===========================================================================

alter table public.disruptions
  add column if not exists segment_id uuid references public.journey_segments (id) on delete cascade;
alter table public.disruptions add column if not exists original_departure_at timestamptz;
alter table public.disruptions add column if not exists original_arrival_at timestamptz;
alter table public.disruptions add column if not exists revised_departure_at timestamptz;
alter table public.disruptions add column if not exists revised_arrival_at timestamptz;
alter table public.disruptions add column if not exists cancellation_at timestamptz;
alter table public.disruptions add column if not exists provider_event_reference text;
alter table public.disruptions add column if not exists source text not null default 'manual';
alter table public.disruptions add column if not exists created_at timestamptz not null default now();
alter table public.disruptions add column if not exists updated_at timestamptz not null default now();

alter table public.disruptions drop constraint if exists disruptions_kind_check;
alter table public.disruptions add constraint disruptions_kind_check
  check (kind in ('delay', 'cancellation', 'weather', 'closure'));
alter table public.disruptions drop constraint if exists disruptions_source_check;
alter table public.disruptions add constraint disruptions_source_check
  check (source in ('manual', 'simulator', 'provider', 'gmail'));
alter table public.disruptions drop constraint if exists disruptions_segment_trip_check;
alter table public.disruptions add constraint disruptions_segment_trip_check
  check (segment_id is null or trip_id is not null);

create index if not exists disruptions_segment_reported_idx
  on public.disruptions (segment_id, reported_at desc)
  where segment_id is not null;

create or replace function public.validate_disruption_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  segment_trip_id uuid;
  segment_profile_id uuid;
  trip_profile_id uuid;
begin
  if new.trip_id is not null then
    select t.profile_id into trip_profile_id
      from public.trips t where t.id = new.trip_id;
    if trip_profile_id is null then
      raise exception 'Disruption trip does not exist';
    end if;
    if trip_profile_id <> new.profile_id then
      raise exception 'Disruption trip belongs to another profile';
    end if;
  end if;

  if new.segment_id is not null then
    select s.trip_id, t.profile_id into segment_trip_id, segment_profile_id
      from public.journey_segments s
      join public.trips t on t.id = s.trip_id
      where s.id = new.segment_id;
    if segment_trip_id is null then
      raise exception 'Disruption segment does not exist';
    end if;
    if segment_profile_id <> new.profile_id then
      raise exception 'Disruption segment belongs to another profile';
    end if;
    if new.trip_id <> segment_trip_id then
      raise exception 'Disruption segment does not belong to the disruption trip';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists disruptions_validate_ownership on public.disruptions;
create trigger disruptions_validate_ownership
  before insert or update on public.disruptions
  for each row execute function public.validate_disruption_ownership();

drop policy if exists "disruptions_select_own" on public.disruptions;
create policy "disruptions_select_own" on public.disruptions
  for select to authenticated using (
    (select auth.uid()) = profile_id
    and (trip_id is null or exists (
      select 1 from public.trips t where t.id = disruptions.trip_id and t.profile_id = (select auth.uid())
    ))
    and (segment_id is null or exists (
      select 1 from public.journey_segments s
      join public.trips t on t.id = s.trip_id
      where s.id = disruptions.segment_id and t.profile_id = (select auth.uid())
    ))
  );

drop policy if exists "disruptions_insert_own" on public.disruptions;
create policy "disruptions_insert_own" on public.disruptions
  for insert to authenticated with check (
    (select auth.uid()) = profile_id
    and (trip_id is null or exists (
      select 1 from public.trips t where t.id = disruptions.trip_id and t.profile_id = (select auth.uid())
    ))
    and (segment_id is null or exists (
      select 1 from public.journey_segments s
      join public.trips t on t.id = s.trip_id
      where s.id = disruptions.segment_id and t.profile_id = (select auth.uid())
    ))
  );

drop policy if exists "disruptions_update_own" on public.disruptions;
create policy "disruptions_update_own" on public.disruptions
  for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check (
    (select auth.uid()) = profile_id
    and (trip_id is null or exists (
      select 1 from public.trips t where t.id = disruptions.trip_id and t.profile_id = (select auth.uid())
    ))
    and (segment_id is null or exists (
      select 1 from public.journey_segments s
      join public.trips t on t.id = s.trip_id
      where s.id = disruptions.segment_id and t.profile_id = (select auth.uid())
    ))
  );

-- Simulator and future provider ingestion use the same authenticated write path.
grant insert, update on public.disruptions to authenticated;