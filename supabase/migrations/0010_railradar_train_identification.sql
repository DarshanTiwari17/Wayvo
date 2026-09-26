alter table public.journey_segments
  add column if not exists service_number_source text;
alter table public.journey_segments
  drop constraint if exists journey_segments_service_number_source_check;
alter table public.journey_segments
  add constraint journey_segments_service_number_source_check
  check (service_number_source is null or service_number_source in ('booking_import', 'railradar', 'manual_clarification'));

alter table public.railradar_monitoring_state
  add column if not exists identification_status text not null default 'not_attempted';
alter table public.railradar_monitoring_state
  add column if not exists identification_candidates jsonb not null default '[]'::jsonb;
alter table public.railradar_monitoring_state
  drop constraint if exists railradar_identification_status_check;
alter table public.railradar_monitoring_state
  add constraint railradar_identification_status_check
  check (identification_status in ('not_attempted', 'identifying', 'identified', 'ambiguous', 'not_found', 'unavailable'));