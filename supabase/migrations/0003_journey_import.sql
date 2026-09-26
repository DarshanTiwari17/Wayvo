-- ===========================================================================
-- Wayvo — 0003_journey_import.sql
--
-- Everything needed for real journey import:
--   * extends `trips` with booking + import metadata
--   * `journey_segments`  → multi-leg journeys (Mumbai → Pune → Goa → Delhi)
--   * `journey_documents` → the uploaded ticket / PDF, stored in Supabase Storage
--   * `gmail_connections`  → Gmail OAuth state; tokens are NOT client-readable
--   * a private `travel-documents` Storage bucket with owner-only RLS
--
-- Additive. Does not touch auth.users, public.profiles or 0002's tables.
-- Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Storage bucket for travel documents
-- ---------------------------------------------------------------------------
-- Private bucket: files are never publicly addressable. Access is decided by
-- the RLS policies below, which are scoped to the first path segment (the
-- owner's UUID). Nothing large is stored in PostgreSQL; only metadata is.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'travel-documents',
  'travel-documents',
  false,
  10485760, -- 10 MB is plenty for a ticket
  array[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- Object policies: the first folder in the key must be the caller's own UUID,
-- which the client controls when it builds the upload path.
drop policy if exists "travel_documents_read_own" on storage.objects;
create policy "travel_documents_read_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'travel-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "travel_documents_insert_own" on storage.objects;
create policy "travel_documents_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'travel-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "travel_documents_delete_own" on storage.objects;
create policy "travel_documents_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'travel-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Deliberately no UPDATE policy: an uploaded ticket is immutable evidence.


-- ---------------------------------------------------------------------------
-- 2. Extend `trips` with booking + import metadata
-- ---------------------------------------------------------------------------
-- `origin` / `destination` / `starts_on` / `ends_on` already exist and stay the
-- canonical summary used by the list views. The columns below carry what was
-- actually read off the booking, plus where it came from and how much of it is
-- confirmed rather than inferred.
-- ---------------------------------------------------------------------------

alter table public.trips add column if not exists transport_mode   text;
alter table public.trips add column if not exists operator_name    text;
alter table public.trips add column if not exists service_number   text;
alter table public.trips add column if not exists departure_at     timestamptz;
alter table public.trips add column if not exists arrival_at       timestamptz;
alter table public.trips add column if not exists booking_reference text;
alter table public.trips add column if not exists pnr               text;
alter table public.trips add column if not exists ticket_number     text;
alter table public.trips add column if not exists passenger_name    text;
alter table public.trips add column if not exists seat              text;
alter table public.trips add column if not exists coach             text;
alter table public.trips add column if not exists terminal          text;
alter table public.trips add column if not exists fare_amount       numeric(12, 2);
alter table public.trips add column if not exists fare_currency     char(3);
alter table public.trips add column if not exists booking_status    text;

-- Where this journey came from: 'manual' | 'upload' | 'gmail'
alter table public.trips add column if not exists source            text not null default 'manual';

-- Per-field provenance so the UI can say "confirmed from ticket" vs
-- "estimated". Shape:
--   { "pnr": "confirmed", "arrivalTime": "estimated", "fare": "missing" }
alter table public.trips add column if not exists field_provenance   jsonb;

-- The full extraction output, kept for auditing and for re-parsing later.
alter table public.trips add column if not exists import_payload     jsonb;

comment on column public.trips.source is
  'manual | upload | gmail. Recorded for provenance and future verification.';
comment on column public.trips.field_provenance is
  'Per field: confirmed (read from the document) | estimated (inferred) | missing.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_source_check'
  ) then
    alter table public.trips
      add constraint trips_source_check
      check (source in ('manual', 'upload', 'gmail'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'trips_transport_mode_check'
  ) then
    alter table public.trips
      add constraint trips_transport_mode_check
      check (
        transport_mode is null
        or transport_mode in ('train', 'flight', 'bus', 'car', 'ferry', 'hotel', 'other')
      );
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- 3. journey_segments — multi-leg support
-- ---------------------------------------------------------------------------
create table if not exists public.journey_segments (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id) on delete cascade,
  seq               integer not null,
  origin            text,
  destination       text,
  departure_at      timestamptz,
  arrival_at        timestamptz,
  transport_mode    text,
  operator_name     text,
  service_number    text,
  booking_reference text,
  pnr               text,
  seat              text,
  coach             text,
  terminal          text,
  ticket_number     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint journey_segments_seq_check check (seq >= 0),
  constraint journey_segments_mode_check
    check (
      transport_mode is null
      or transport_mode in ('train', 'flight', 'bus', 'car', 'ferry', 'hotel', 'other')
    )
);

create index if not exists journey_segments_trip_seq_idx
  on public.journey_segments (trip_id, seq);

drop trigger if exists journey_segments_set_updated_at on public.journey_segments;
create trigger journey_segments_set_updated_at
  before update on public.journey_segments
  for each row
  execute function public.set_profiles_updated_at();

-- Segments have no profile_id of their own; ownership is inherited from the
-- parent trip, so the policy has to reach through it.
alter table public.journey_segments enable row level security;

drop policy if exists "journey_segments_select_own" on public.journey_segments;
create policy "journey_segments_select_own"
  on public.journey_segments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = journey_segments.trip_id
        and t.profile_id = (select auth.uid())
    )
  );

drop policy if exists "journey_segments_insert_own" on public.journey_segments;
create policy "journey_segments_insert_own"
  on public.journey_segments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.trips t
      where t.id = journey_segments.trip_id
        and t.profile_id = (select auth.uid())
    )
  );

drop policy if exists "journey_segments_update_own" on public.journey_segments;
create policy "journey_segments_update_own"
  on public.journey_segments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = journey_segments.trip_id
        and t.profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.trips t
      where t.id = journey_segments.trip_id
        and t.profile_id = (select auth.uid())
    )
  );

revoke all on table public.journey_segments from anon;
revoke all on table public.journey_segments from authenticated;
grant select, insert, update on table public.journey_segments to authenticated;


-- ---------------------------------------------------------------------------
-- 4. journey_documents — the uploaded ticket / PDF
-- ---------------------------------------------------------------------------
-- The file itself lives in Supabase Storage under
--   travel-documents/<profile uuid>/<uuid>.<ext>
-- Only metadata plus the extraction result is kept in Postgres.
create table if not exists public.journey_documents (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles (id) on delete cascade,
  -- nullable until the traveller confirms the journey
  trip_id              uuid references public.trips (id) on delete set null,
  storage_path         text not null,
  file_name            text not null,
  mime_type            text not null,
  byte_size            bigint,
  origin               text not null default 'upload',
  -- Gmail provenance, when the document arrived as an attachment
  gmail_message_id     text,
  gmail_attachment_id  text,
  extraction_status    text not null default 'pending',
  extracted            jsonb,
  created_at           timestamptz not null default now(),

  constraint journey_documents_origin_check check (origin in ('upload', 'gmail')),
  constraint journey_documents_status_check
    check (extraction_status in ('pending', 'processed', 'unreadable', 'no_travel_data'))
);

create index if not exists journey_documents_profile_idx
  on public.journey_documents (profile_id, created_at desc);

comment on table public.journey_documents is
  'Metadata for travel documents in Supabase Storage. The file bytes are not stored here.';

alter table public.journey_documents enable row level security;

drop policy if exists "journey_documents_select_own" on public.journey_documents;
create policy "journey_documents_select_own"
  on public.journey_documents
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "journey_documents_insert_own" on public.journey_documents;
create policy "journey_documents_insert_own"
  on public.journey_documents
  for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

drop policy if exists "journey_documents_update_own" on public.journey_documents;
create policy "journey_documents_update_own"
  on public.journey_documents
  for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- No delete policy: documents are removed when the auth user is deleted.

revoke all on table public.journey_documents from anon;
revoke all on table public.journey_documents from authenticated;
grant select, insert, update on table public.journey_documents to authenticated;


-- ---------------------------------------------------------------------------
-- 5. gmail_connections
-- ---------------------------------------------------------------------------
-- The refresh token is written and read ONLY by the Edge Function using the
-- service role. The browser is granted read access to a few harmless columns
-- and nothing else, so the credential can never reach the client.
-- ---------------------------------------------------------------------------

create table if not exists public.gmail_connections (
  profile_id         uuid primary key references public.profiles (id) on delete cascade,
  gmail_address      text,
  scopes             text,
  status             text not null default 'connected',
  refresh_token      text,
  access_token       text,
  token_expires_at   timestamptz,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint gmail_connections_status_check check (status in ('connected', 'error', 'revoked'))
);

comment on table public.gmail_connections is
  'Gmail OAuth connection. Token columns are readable only by the service role.';

alter table public.gmail_connections enable row level security;

-- RLS: own row only. Column grants below decide *which* columns a client sees.
drop policy if exists "gmail_connections_select_own" on public.gmail_connections;
create policy "gmail_connections_select_own"
  on public.gmail_connections
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists "gmail_connections_delete_own" on public.gmail_connections;
create policy "gmail_connections_delete_own"
  on public.gmail_connections
  for delete
  to authenticated
  using ((select auth.uid()) = profile_id);

revoke all on table public.gmail_connections from anon;
revoke all on table public.gmail_connections from authenticated;

-- Deliberately NOT `grant select on gmail_connections`. Only these columns:
grant select (profile_id, gmail_address, scopes, status, last_synced_at, created_at, updated_at)
  on table public.gmail_connections to authenticated;
grant delete on table public.gmail_connections to authenticated;
grant update (status) on table public.gmail_connections to authenticated;

drop trigger if exists gmail_connections_set_updated_at on public.gmail_connections;
create trigger gmail_connections_set_updated_at
  before update on public.gmail_connections
  for each row
  execute function public.set_profiles_updated_at();


-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------
--   -- A client must never be able to read the tokens:
--   select refresh_token from public.gmail_connections;
--   -- -> permission denied for table gmail_connections (column not granted)
--
--   -- Documents are private to their owner:
--   select * from storage.objects where bucket_id = 'travel-documents';
--
--   -- Two users cannot see each other's journeys or their segments.
-- ---------------------------------------------------------------------------
