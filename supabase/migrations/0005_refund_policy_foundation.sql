-- ===========================================================================
-- Wayvo - 0005_refund_policy_foundation.sql
--
-- Deterministic refund-policy metadata and private eligibility evaluations.
-- Policies contain data, not executable code. The application policy engine
-- interprets the allow-listed rule types in a controlled service.
-- ===========================================================================

create table if not exists public.refund_policies (
  id                 uuid primary key default gen_random_uuid(),
  transport_mode     text not null,
  provider           text not null,
  policy_name        text not null,
  policy_version     text not null,
  effective_from     date not null,
  effective_until    date,
  policy_source      text not null,
  policy_status      text not null default 'draft',
  amount_type        text not null default 'unknown',
  amount_value       numeric(12, 2),
  amount_percentage  numeric(5, 2),
  amount_currency    char(3),
  claim_deadline_days integer,
  required_evidence  jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint refund_policies_transport_mode_check check (
    transport_mode in ('train', 'flight', 'bus', 'car', 'ferry', 'hotel', 'other')
  ),
  constraint refund_policies_status_check check (policy_status in ('draft', 'active', 'retired')),
  constraint refund_policies_amount_type_check check (
    amount_type in ('full_fare', 'partial_fare', 'fixed', 'calculated', 'unknown')
  ),
  constraint refund_policies_dates_check check (effective_until is null or effective_until >= effective_from),
  constraint refund_policies_deadline_check check (claim_deadline_days is null or claim_deadline_days >= 0),
  constraint refund_policies_amount_value_check check (amount_value is null or amount_value >= 0),
  constraint refund_policies_amount_percentage_check check (
    amount_percentage is null or (amount_percentage >= 0 and amount_percentage <= 100)
  )
);

create index if not exists refund_policies_lookup_idx
  on public.refund_policies (transport_mode, provider, policy_status, effective_from);

create table if not exists public.refund_policy_rules (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references public.refund_policies (id) on delete cascade,
  rule_order     integer not null,
  condition_type text not null,
  operator       text not null,
  value_text     text,
  value_number   numeric(12, 2),
  value_json     jsonb,
  created_at     timestamptz not null default now(),
  constraint refund_policy_rules_order_check check (rule_order >= 0),
  constraint refund_policy_rules_condition_check check (
    condition_type in (
      'transport_mode', 'provider', 'booking_status', 'disruption_kind',
      'delay_minutes', 'passenger_travel_status', 'cancellation_status',
      'fare_amount', 'claim_deadline', 'required_evidence'
    )
  ),
  constraint refund_policy_rules_operator_check check (
    operator in ('equals', 'in', 'gte', 'lte', 'exists', 'missing')
  )
);

create index if not exists refund_policy_rules_policy_order_idx
  on public.refund_policy_rules (policy_id, rule_order);

alter table public.journey_segments
  add column if not exists passenger_travel_status text not null default 'unknown';
alter table public.journey_segments
  drop constraint if exists journey_segments_passenger_travel_status_check;
alter table public.journey_segments
  add constraint journey_segments_passenger_travel_status_check
  check (passenger_travel_status in ('travelled', 'not_travelled', 'unknown'));

alter table public.disruptions add column if not exists delay_minutes integer;
alter table public.disruptions drop constraint if exists disruptions_delay_minutes_check;
alter table public.disruptions add constraint disruptions_delay_minutes_check
  check (delay_minutes is null or delay_minutes >= 0);

create table if not exists public.refund_eligibility_results (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  trip_id               uuid not null references public.trips (id) on delete cascade,
  segment_id            uuid not null references public.journey_segments (id) on delete cascade,
  disruption_id         uuid references public.disruptions (id) on delete set null,
  policy_id             uuid not null references public.refund_policies (id),
  policy_name           text not null,
  policy_provider       text not null,
  policy_version        text not null,
  policy_source         text not null,
  policy_effective_from date not null,
  eligibility_status    text not null,
  reason                text not null,
  eligible_amount       numeric(12, 2),
  currency              char(3),
  missing_information   jsonb not null default '[]'::jsonb,
  required_evidence     jsonb not null default '[]'::jsonb,
  evaluation_inputs     jsonb not null default '{}'::jsonb,
  evaluated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint refund_eligibility_status_check check (
    eligibility_status in ('eligible', 'potentially_eligible', 'not_eligible', 'insufficient_information')
  ),
  constraint refund_eligibility_amount_check check (eligible_amount is null or eligible_amount >= 0)
);

create index if not exists refund_eligibility_profile_idx
  on public.refund_eligibility_results (profile_id, evaluated_at desc);
create index if not exists refund_eligibility_segment_idx
  on public.refund_eligibility_results (segment_id, evaluated_at desc);

alter table public.refund_policies enable row level security;
alter table public.refund_policy_rules enable row level security;
alter table public.refund_eligibility_results enable row level security;

drop policy if exists "refund_policies_read_active" on public.refund_policies;
create policy "refund_policies_read_active" on public.refund_policies
  for select to authenticated using (policy_status = 'active');

drop policy if exists "refund_policy_rules_read_active" on public.refund_policy_rules;
create policy "refund_policy_rules_read_active" on public.refund_policy_rules
  for select to authenticated using (
    exists (
      select 1 from public.refund_policies p
      where p.id = refund_policy_rules.policy_id and p.policy_status = 'active'
    )
  );

drop policy if exists "refund_eligibility_select_own" on public.refund_eligibility_results;
create policy "refund_eligibility_select_own" on public.refund_eligibility_results
  for select to authenticated using ((select auth.uid()) = profile_id);

drop policy if exists "refund_eligibility_insert_own" on public.refund_eligibility_results;
create policy "refund_eligibility_insert_own" on public.refund_eligibility_results
  for insert to authenticated with check (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.trips t
      where t.id = refund_eligibility_results.trip_id and t.profile_id = (select auth.uid())
    )
    and exists (
      select 1 from public.journey_segments s
      where s.id = refund_eligibility_results.segment_id
        and s.trip_id = refund_eligibility_results.trip_id
    )
    and (
      disruption_id is null or exists (
        select 1 from public.disruptions d
        where d.id = refund_eligibility_results.disruption_id
          and d.profile_id = (select auth.uid())
          and (d.trip_id is null or d.trip_id = refund_eligibility_results.trip_id)
      )
    )
  );

drop policy if exists "refund_eligibility_update_own" on public.refund_eligibility_results;
create policy "refund_eligibility_update_own" on public.refund_eligibility_results
  for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check (
    (select auth.uid()) = profile_id
    and exists (
      select 1 from public.trips t
      where t.id = refund_eligibility_results.trip_id and t.profile_id = (select auth.uid())
    )
    and exists (
      select 1 from public.journey_segments s
      where s.id = refund_eligibility_results.segment_id
        and s.trip_id = refund_eligibility_results.trip_id
    )
    and (
      disruption_id is null or exists (
        select 1 from public.disruptions d
        where d.id = refund_eligibility_results.disruption_id
          and d.profile_id = (select auth.uid())
          and (d.trip_id is null or d.trip_id = refund_eligibility_results.trip_id)
      )
    )
  );

revoke all on table public.refund_policies from anon;
revoke all on table public.refund_policy_rules from anon;
revoke all on table public.refund_eligibility_results from anon;
revoke all on table public.refund_policies from authenticated;
revoke all on table public.refund_policy_rules from authenticated;
revoke all on table public.refund_eligibility_results from authenticated;
grant select on public.refund_policies to authenticated;
grant select on public.refund_policy_rules to authenticated;
grant select on public.refund_eligibility_results to authenticated;
grant insert on public.refund_eligibility_results to authenticated;
grant update (
  eligibility_status, reason, eligible_amount, currency, missing_information,
  required_evidence, evaluation_inputs, evaluated_at, updated_at
) on public.refund_eligibility_results to authenticated;

-- This milestone stops at a private eligibility result. No claim or external
-- financial action is created here.