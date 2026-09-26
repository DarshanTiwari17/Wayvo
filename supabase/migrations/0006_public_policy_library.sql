-- ===========================================================================
-- Wayvo - 0006_public_policy_library.sql
--
-- Adds non-sensitive, user-facing policy description fields. No passenger,
-- booking, fare, trip, document, or eligibility data belongs here.
-- ===========================================================================

alter table public.refund_policies add column if not exists policy_summary text not null default '';
alter table public.refund_policies add column if not exists applicable_disruption_types jsonb not null default '[]'::jsonb;
alter table public.refund_policies add column if not exists eligibility_conditions jsonb not null default '[]'::jsonb;
alter table public.refund_policies add column if not exists exclusions jsonb not null default '[]'::jsonb;
alter table public.refund_policies add column if not exists claim_method text;

drop policy if exists "refund_policies_read_active" on public.refund_policies;
create policy "refund_policies_read_active" on public.refund_policies
  for select to anon, authenticated using (policy_status = 'active');

drop policy if exists "refund_policy_rules_read_active" on public.refund_policy_rules;
create policy "refund_policy_rules_read_active" on public.refund_policy_rules
  for select to anon, authenticated using (
    exists (
      select 1 from public.refund_policies p
      where p.id = refund_policy_rules.policy_id and p.policy_status = 'active'
    )
  );

grant select on public.refund_policies to anon, authenticated;
grant select on public.refund_policy_rules to anon, authenticated;

-- Policy records remain informational. Passenger-specific eligibility results
-- continue to use the private policies in 0005 and are never exposed here.