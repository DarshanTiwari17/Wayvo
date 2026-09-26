import fs from 'node:fs'
import path from 'node:path'
import { evaluateRefundEligibility, type RefundPolicy, type RefundSegment } from '../src/services/refundPolicyService'

const results: { name: string; passed: boolean }[] = []
const check = (name: string, passed: boolean) => {
  results.push({ name, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`)
}

const policy: RefundPolicy = {
  id: 'policy-rail-1',
  transportMode: 'train',
  provider: 'RailCo',
  name: 'Rail delay policy',
  version: '2026.1',
  effectiveFrom: '2026-01-01',
  source: 'RailCo published terms',
  status: 'active',
  rules: [
    { type: 'transport_mode', values: ['train'] },
    { type: 'provider', values: ['RailCo'] },
    { type: 'disruption_kind', values: ['delay'] },
    { type: 'min_delay_minutes', value: 120 },
    { type: 'passenger_travel_status', values: ['not_travelled', 'unknown'] },
    { type: 'fare_required' },
    { type: 'required_evidence', values: ['ticket'] },
  ],
  amount: { type: 'full_fare' },
  claimDeadlineDays: 30,
  requiredEvidence: [],
  summary: 'A supported rail delay policy.',
  applicableDisruptionTypes: ['delay'],
  eligibilityConditions: ['At least 120 minutes delayed.'],
  exclusions: [],
  claimMethod: 'Provider portal',
}

const segment: RefundSegment = {
  transport_mode: 'train',
  operator_name: 'RailCo',
  booking_status: 'confirmed',
  fare_amount: 100,
  fare_currency: 'INR',
  passenger_travel_status: 'not_travelled',
}
const disruption = {
  kind: 'delay',
  reported_at: '2026-09-26T10:00:00Z',
  resolved_at: null,
  delay_minutes: 180,
}

check('eligible result', evaluateRefundEligibility({ segment, disruption, policy }).status === 'eligible')
check('full fare reuses existing fare', evaluateRefundEligibility({ segment, disruption, policy }).amount === 100)
check('required evidence is retained', evaluateRefundEligibility({ segment, disruption, policy }).requiredEvidence.includes('ticket'))
check(
  'potentially eligible with unknown travel status',
  evaluateRefundEligibility({ segment: { ...segment, passenger_travel_status: 'unknown' }, disruption, policy }).status ===
    'potentially_eligible',
)
check(
  'not eligible for wrong transport mode',
  evaluateRefundEligibility({ segment: { ...segment, transport_mode: 'flight' }, disruption, policy }).status === 'not_eligible',
)
check(
  'not eligible for wrong provider',
  evaluateRefundEligibility({ segment: { ...segment, operator_name: 'AirCo' }, disruption, policy }).status === 'not_eligible',
)
check(
  'insufficient information for missing disruption',
  evaluateRefundEligibility({ segment, disruption: null, policy }).status === 'insufficient_information',
)
check(
  'insufficient information for missing fare',
  evaluateRefundEligibility({ segment: { ...segment, fare_amount: null }, disruption, policy }).status ===
    'insufficient_information',
)
check(
  'insufficient information for missing transport mode',
  evaluateRefundEligibility({ segment: { ...segment, transport_mode: null }, disruption, policy }).status ===
    'insufficient_information',
)
check(
  'unknown amount is not invented',
  evaluateRefundEligibility({ segment, disruption, policy: { ...policy, amount: { type: 'unknown' } } }).amount === null,
)
check(
  'minimum fare rule is deterministic',
  evaluateRefundEligibility({
    segment: { ...segment, fare_amount: 20 },
    disruption,
    policy: { ...policy, rules: [...policy.rules, { type: 'minimum_fare', value: 50 }] },
  }).status === 'not_eligible',
)
check(
  'claim deadline rule is deterministic',
  evaluateRefundEligibility({
    segment,
    disruption,
    evaluatedAt: '2026-11-01T00:00:00Z',
    policy: { ...policy, rules: [...policy.rules, { type: 'claim_deadline', days: 30 }] },
  }).status === 'not_eligible',
)

const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/0005_refund_policy_foundation.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
const libraryMigration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0006_public_policy_library.sql'), 'utf8')
check('eligibility results have owner-scoped select RLS', /auth\.uid\(\)\) = profile_id/.test(migration))
check('eligibility inserts require an owned trip', /t\.profile_id = \(select auth\.uid\(\)\)/.test(migration))
check('eligibility results are not granted to anon', /revoke all on table public\.refund_eligibility_results from anon/.test(migration))
check('active policy metadata is readable without a session', /create policy "refund_policies_read_active"[\s\S]*to anon, authenticated/.test(libraryMigration))
check('public policy migration contains no passenger-specific fields', !/passenger_name|\bpnr\b|ticket_number|fare_amount|trip_id|eligibility_results/i.test(libraryMigration))

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)