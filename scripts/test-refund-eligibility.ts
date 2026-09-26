import fs from 'node:fs'
import path from 'node:path'
import { createNoPolicyEligibilityResult, evaluateRefundEligibility, type RefundPolicy } from '../src/services/refundPolicyService'
import { selectApplicablePolicy } from '../src/services/refundEligibilityService'
import type { JourneySegment } from '../src/types/database'

const results: { name: string; passed: boolean }[] = []
const check = (name: string, passed: boolean) => {
  results.push({ name, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`)
}

const policy: RefundPolicy = {
  id: 'policy-1', transportMode: 'train', provider: 'RailCo', name: 'Rail delay policy', version: '2026.1',
  effectiveFrom: '2026-01-01', source: 'RailCo official terms', status: 'active', effectiveUntil: null,
  rules: [
    { type: 'transport_mode', values: ['train'] },
    { type: 'provider', values: ['RailCo'] },
    { type: 'disruption_kind', values: ['delay'] },
    { type: 'min_delay_minutes', value: 120 },
    { type: 'passenger_travel_status', values: ['not_travelled', 'unknown'] },
    { type: 'fare_required' },
    { type: 'required_evidence', values: ['ticket'] },
  ],
  amount: { type: 'full_fare' }, claimDeadlineDays: 30, requiredEvidence: ['ticket'],
  summary: 'Delay policy', applicableDisruptionTypes: ['delay'], eligibilityConditions: ['120 minute delay'], exclusions: [], claimMethod: 'Provider portal',
}

const segment = {
  id: 'segment-1', trip_id: 'trip-1', seq: 0, origin: 'Mumbai', destination: 'Delhi', departure_at: '2026-09-26T08:00:00Z', arrival_at: '2026-09-26T10:00:00Z',
  transport_mode: 'train', operator_name: 'RailCo', booking_status: 'confirmed', fare_amount: 100, fare_currency: 'INR', passenger_travel_status: 'not_travelled',
} as JourneySegment
const disruption = { kind: 'delay' as const, reported_at: '2026-09-26T10:00:00Z', resolved_at: null, delay_minutes: 210 }

check('eligible journey', evaluateRefundEligibility({ segment, disruption, policy, availableEvidence: ['ticket'] }).status === 'eligible')
check('not eligible after travelled status', evaluateRefundEligibility({ segment: { ...segment, passenger_travel_status: 'travelled' }, disruption, policy, availableEvidence: ['ticket'] }).status === 'not_eligible')
check('potentially eligible with unknown status', evaluateRefundEligibility({ segment: { ...segment, passenger_travel_status: 'unknown' }, disruption, policy, availableEvidence: ['ticket'] }).status === 'potentially_eligible')
check('insufficient information for missing disruption', evaluateRefundEligibility({ segment, disruption: null, policy, availableEvidence: ['ticket'] }).status === 'insufficient_information')
check('no matching provider policy', selectApplicablePolicy([policy], { ...segment, operator_name: 'OtherRail' }, disruption) === null)
check('wrong provider is not eligible', evaluateRefundEligibility({ segment: { ...segment, operator_name: 'OtherRail' }, disruption, policy, availableEvidence: ['ticket'] }).status === 'not_eligible')
check('wrong transport mode is not eligible', evaluateRefundEligibility({ segment: { ...segment, transport_mode: 'flight' }, disruption, policy, availableEvidence: ['ticket'] }).status === 'not_eligible')
check('not travelled status is accepted', evaluateRefundEligibility({ segment, disruption, policy, availableEvidence: ['ticket'] }).status === 'eligible')
check('missing fare is insufficient', evaluateRefundEligibility({ segment: { ...segment, fare_amount: null }, disruption, policy, availableEvidence: ['ticket'] }).status === 'insufficient_information')
check('missing evidence is insufficient', evaluateRefundEligibility({ segment, disruption, policy, availableEvidence: [] }).status === 'insufficient_information')
check('delay satisfies policy', evaluateRefundEligibility({ segment, disruption, policy, availableEvidence: ['ticket'] }).status === 'eligible')
check('delay below policy is not eligible', evaluateRefundEligibility({ segment, disruption: { ...disruption, delay_minutes: 30 }, policy, availableEvidence: ['ticket'] }).status === 'not_eligible')
check('no policy never claims eligibility', createNoPolicyEligibilityResult(segment, disruption, 'No supported policy is currently configured for this provider.').status === 'insufficient_information')

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0005_refund_policy_foundation.sql'), 'utf8')
const ui = fs.readFileSync(path.resolve(process.cwd(), 'src/components/journeys/RefundEligibilityView.tsx'), 'utf8')
check('eligibility results are owner-scoped', /create policy "refund_eligibility_select_own"[\s\S]*auth\.uid\(\)\) = profile_id/.test(migration))
check('eligibility results are not public', /revoke all on table public\.refund_eligibility_results from anon/.test(migration))
check('UI displays evaluated policy version and links by policy id', /policy\.version/.test(ui) && /policy\.id/.test(ui))

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)