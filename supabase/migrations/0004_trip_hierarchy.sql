-- ===========================================================================
-- Wayvo — 0004_trip_hierarchy.sql
--
-- Turns `trips` into the parent *itinerary* and `journey_segments` into the
-- bookings that hang off it. The app's hierarchy becomes:
--
--     profiles → trips (the trip) → journey_documents → journey_segments
--
-- Design note on naming: `trips` already carries exactly the fields an
-- itinerary needs (title, starts_on, ends_on, origin, destination, status,
-- profile_id, timestamps), and `disruptions` / `recovery_plans` already
-- reference `trips.id`. A separate `itineraries` table would duplicate the
-- parent and leave two competing concepts, so `trips` *is* the itinerary. The
-- `trip_id` on a segment is the itinerary reference; the segment's `seq` is its
-- `sequence`.
--
-- Additive. Does not touch auth.users, public.profiles, or 0002/0003 tables
-- beyond adding columns. Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Segments become first-class bookings
--
-- 0003 created journey_segments as "legs of a journey". Each leg already had
-- the route, times and booking reference, but not the provenance, confidence or
-- review state that a separately-imported booking needs. Those columns are
-- added here.
-- ---------------------------------------------------------------------------

alter table public.journey_segments
  add column if not exists document_id      uuid references public.journey_documents (id) on delete set null;

-- Which document this booking was read from. One document normally produces one
-- segment, but a multi-leg itinerary PDF can produce several.
create index if not exists journey_segments_document_idx
  on public.journey_segments (document_id)
  where document_id is not null;

alter table public.journey_segments add column if not exists passenger_name  text;
alter table public.journey_segments add column if not exists fare_amount     numeric(12, 2);
alter table public.journey_segments add column if not exists fare_currency   char(3);
alter table public.journey_segments add column if not exists booking_status  text;

-- Where the booking came from: 'manual' | 'upload' | 'gmail'
alter table public.journey_segments add column if not exists source          text not null default 'manual';

-- How much of the extraction was actually read, 0..1. Stored so the UI can say
-- "we were not sure about this one" after a reload, not just during import.
alter table public.journey_segments add column if not exists confidence      numeric(4, 3);

-- Per-field provenance, same shape as trips.field_provenance:
--   { "pnr": "confirmed", "arrivalAt": "estimated", "seat": "missing" }
alter table public.journey_segments add column if not exists field_provenance jsonb;

-- The full extraction output, kept for auditing and re-parsing.
alter table public.journey_segments add column if not exists import_payload  jsonb;

-- Reuses the trips vocabulary so the UI has one set of labels. This must be
-- added BEFORE the check constraint below, which references it.
alter table public.journey_segments add column if not exists status text not null default 'planning';

-- ---------------------------------------------------------------------------
-- 2. Automatic sequencing, and asking when it is not sure
--
-- `seq` is the order Wayvo worked out. `connection_minutes` is the wait between
-- arriving on the previous segment and leaving on this one.
--
-- `needs_review` is set when the ordering was ambiguous — two bookings leaving
-- the same place, a gap in the chain, times that overlap, or a booking with no
-- readable location. Wayvo still orders those by best effort, but it does not
-- claim to be sure, and the UI asks the traveller to confirm.
--
-- `sequence_confirmed` is set once the traveller has accepted the order. From
-- then on it is never recomputed, so a deliberate reorder is not undone.
-- ---------------------------------------------------------------------------

alter table public.journey_segments add column if not exists connection_minutes integer;
alter table public.journey_segments add column if not exists needs_review      boolean not null default false;
alter table public.journey_segments add column if not exists review_note       text;
alter table public.journey_segments add column if not exists sequence_confirmed boolean not null default false;

comment on column public.journey_segments.needs_review is
  'True when the computed order was ambiguous and the traveller has not confirmed it yet.';
comment on column public.journey_segments.sequence_confirmed is
  'True once the traveller has accepted the order. Rescaling is skipped for confirmed segments.';
comment on column public.journey_segments.connection_minutes is
  'Minutes between arriving on the previous segment and departing on this one. Null when either time is unknown.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'journey_segments_source_check'
  ) then
    alter table public.journey_segments
      add constraint journey_segments_source_check
      check (source in ('manual', 'upload', 'gmail'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'journey_segments_status_check'
  ) then
    alter table public.journey_segments
      add constraint journey_segments_status_check
      check (
        status is null
        or status in ('planning', 'booked', 'active', 'completed', 'cancelled')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'journey_segments_confidence_check'
  ) then
    alter table public.journey_segments
      add constraint journey_segments_confidence_check
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
end
$$;

-- Reading a trip's itinerary in order is the hot path.
create index if not exists journey_segments_trip_seq_idx_v2
  on public.journey_segments (trip_id, seq);

-- Duplicate detection looks up by PNR / reference within a trip.
create index if not exists journey_segments_trip_pnr_idx
  on public.journey_segments (trip_id, pnr)
  where pnr is not null;

create index if not exists journey_segments_trip_ref_idx
  on public.journey_segments (trip_id, booking_reference)
  where booking_reference is not null;


-- ---------------------------------------------------------------------------
-- 3. Itinerary summary on the parent
--
-- A trip's origin / destination / dates are derived from its segments so the
-- dashboard and the trip list keep working without joining. `itinerary_built_at`
-- records when Wayvo last computed the order, so the UI can tell the traveller
-- when the itinerary was last assembled.
-- ---------------------------------------------------------------------------

alter table public.trips add column if not exists itinerary_built_at timestamptz;
alter table public.trips add column if not exists segment_count      integer not null default 0;

comment on column public.trips.segment_count is
  'Denormalised count of journey_segments, maintained so the trip list does not need a join.';
comment on column public.trips.itinerary_built_at is
  'When Wayvo last computed this trip''s segment order.';


-- ---------------------------------------------------------------------------
-- 5. Documents belong to a trip
--
-- journey_documents already has trip_id from 0003. That is the link that ties an
-- uploaded ticket to the itinerary it was imported into.
-- ---------------------------------------------------------------------------

create index if not exists journey_documents_trip_idx
  on public.journey_documents (trip_id)
  where trip_id is not null;


-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--
-- journey_segments and journey_documents already carry owner-scoped policies
-- that reach through `trips` (0003 §3, §4). Those still hold: a segment is
-- owned by whoever owns the trip, and a document by its own profile_id. No
-- policy changes are needed here — this is stated explicitly so the invariants
-- are not re-checked on every deploy.
--
--   A caller can only read a segment if they own the trip it belongs to, so
--   adding segments to a trip cannot expose it to another user, and a segment
--   can never be attached to somebody else's trip: the insert policy requires
--   `trips.profile_id = auth.uid()`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 7. Verification
-- ---------------------------------------------------------------------------
--   -- A segment must belong to your own trip:
--   insert into public.journey_segments (trip_id, seq)
--   values ('<someone-elses-uuid>', 0);          -- must raise 42501
--
--   -- The order survives a reload:
--   select seq, origin, destination, connection_minutes, needs_review
--     from public.journey_segments
--    where trip_id = '<your-trip-uuid>'
--    order by seq;
-- ---------------------------------------------------------------------------
