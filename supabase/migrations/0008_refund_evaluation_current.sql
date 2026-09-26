-- ===========================================================================
-- Wayvo - 0008_refund_evaluation_current.sql
--
-- Allows a private evaluation to explain that no supported policy exists and
-- records the evidence facts used by the deterministic evaluation.
-- ===========================================================================

alter table public.refund_eligibility_results
  alter column policy_id drop not null;
alter table public.refund_eligibility_results
  alter column policy_name drop not null;
alter table public.refund_eligibility_results
  alter column policy_provider drop not null;
alter table public.refund_eligibility_results
  alter column policy_version drop not null;
alter table public.refund_eligibility_results
  alter column policy_source drop not null;
alter table public.refund_eligibility_results
  alter column policy_effective_from drop not null;

alter table public.refund_eligibility_results
  add column if not exists available_evidence jsonb not null default '[]'::jsonb;
alter table public.refund_eligibility_results
  add column if not exists missing_evidence jsonb not null default '[]'::jsonb;

create unique index if not exists refund_eligibility_current_segment_disruption_idx
  on public.refund_eligibility_results (segment_id, disruption_id)
  where disruption_id is not null;

grant update (
  policy_id, policy_name, policy_provider, policy_version, policy_source,
  policy_effective_from, available_evidence, missing_evidence
) on public.refund_eligibility_results to authenticated;

-- The existing owner-scoped policies remain the boundary. No public grant is
-- added for eligibility results.