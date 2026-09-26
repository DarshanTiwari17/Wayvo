import type { Disruption, JourneySegment, TransportMode } from '../types/database.ts'
import type { Json, RefundPolicy as RefundPolicyRow, RefundPolicyRule as RefundPolicyRuleRow } from '../types/database.ts'

export type PassengerTravelStatus = 'travelled' | 'not_travelled' | 'unknown'
export type EligibilityStatus =
  | 'eligible'
  | 'potentially_eligible'
  | 'not_eligible'
  | 'insufficient_information'
export type RefundAmountType = 'full_fare' | 'partial_fare' | 'fixed' | 'calculated' | 'unknown'

export type PolicyRule =
  | { type: 'transport_mode'; values: TransportMode[] }
  | { type: 'provider'; values: string[] }
  | { type: 'booking_status'; values: string[] }
  | { type: 'disruption_kind'; values: string[] }
  | { type: 'min_delay_minutes'; value: number }
  | { type: 'passenger_travel_status'; values: PassengerTravelStatus[] }
  | { type: 'cancellation_status'; values: string[] }
  | { type: 'fare_required' }
  | { type: 'minimum_fare'; value: number }
  | { type: 'claim_deadline'; days: number }
  | { type: 'required_evidence'; values: string[] }

export interface RefundPolicy {
  id: string
  transportMode: TransportMode
  provider: string
  name: string
  version: string
  effectiveFrom: string
  effectiveUntil?: string | null
  source: string
  status: 'draft' | 'active' | 'retired'
  rules: PolicyRule[]
  amount: {
    type: RefundAmountType
    value?: number | null
    percentage?: number | null
    currency?: string | null
  }
  claimDeadlineDays?: number | null
  requiredEvidence: string[]
  summary: string
  applicableDisruptionTypes: string[]
  eligibilityConditions: string[]
  exclusions: string[]
  claimMethod: string | null
}

export type RefundSegment = Pick<
  JourneySegment,
  | 'transport_mode'
  | 'operator_name'
  | 'booking_status'
  | 'fare_amount'
  | 'fare_currency'
  | 'passenger_travel_status'
>

export type RefundDisruption = Pick<Disruption, 'kind' | 'reported_at' | 'resolved_at' | 'delay_minutes'>

export interface RefundEvaluationInput {
  segment: RefundSegment
  disruption: RefundDisruption | null
  policy: RefundPolicy
  availableEvidence?: string[]
  evaluatedAt?: string
}

export interface RefundEligibilityResult {
  status: EligibilityStatus
  reason: string
  amount: number | null
  currency: string | null
  missingInformation: string[]
  requiredEvidence: string[]
  policyId: string | null
  policyVersion: string | null
  policyName: string | null
  provider: string | null
  source: string | null
  effectiveFrom: string | null
  availableEvidence: string[]
  missingEvidence: string[]
  evaluatedAt: string
  evaluationInputs: {
    transportMode: TransportMode | null
    provider: string | null
    bookingStatus: string | null
    disruptionKind: string | null
    delayMinutes: number | null
    passengerTravelStatus: PassengerTravelStatus
    fareAmount: number | null
    fareCurrency: string | null
  }
}

function normalise(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function matches(values: string[], actual: string | null | undefined): boolean {
  return values.map(normalise).includes(normalise(actual))
}

function amountFor(policy: RefundPolicy, segment: RefundSegment): { amount: number | null; currency: string | null } {
  const currency = policy.amount.currency ?? segment.fare_currency
  if (policy.amount.type === 'full_fare') return { amount: segment.fare_amount, currency }
  if (policy.amount.type === 'partial_fare') {
    if (segment.fare_amount === null || policy.amount.percentage == null) return { amount: null, currency }
    return { amount: (segment.fare_amount * policy.amount.percentage) / 100, currency }
  }
  if (policy.amount.type === 'fixed') return { amount: policy.amount.value ?? null, currency }
  return { amount: null, currency }
}

function createResult(input: RefundEvaluationInput, evaluatedAt: string): RefundEligibilityResult {
  return {
    status: 'insufficient_information',
    reason: '',
    amount: null,
    currency: null,
    missingInformation: [],
    requiredEvidence: [...input.policy.requiredEvidence],
    availableEvidence: [...(input.availableEvidence ?? [])],
    missingEvidence: [],
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    policyName: input.policy.name,
    provider: input.policy.provider,
    source: input.policy.source,
    effectiveFrom: input.policy.effectiveFrom,
    evaluatedAt,
    evaluationInputs: {
      transportMode: input.segment.transport_mode,
      provider: input.segment.operator_name,
      bookingStatus: input.segment.booking_status,
      disruptionKind: input.disruption?.kind ?? null,
      delayMinutes: input.disruption?.delay_minutes ?? null,
      passengerTravelStatus: input.segment.passenger_travel_status,
      fareAmount: input.segment.fare_amount,
      fareCurrency: input.segment.fare_currency,
    },
  }
}

/**
 * Evaluates explicit policy data only. This function has no network, database,
 * LLM, provider, booking, or payment side effects.
 */
export function evaluateRefundEligibility(input: RefundEvaluationInput): RefundEligibilityResult {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString()
  const result = createResult(input, evaluatedAt)
  const { segment, disruption, policy } = input

  if (policy.status !== 'active') {
    result.reason = 'The supplied policy is not active.'
    result.missingInformation.push('active policy')
    return result
  }

  if (segment.transport_mode === null) result.missingInformation.push('transport mode')
  if (segment.operator_name === null) result.missingInformation.push('provider')
  if (!disruption) result.missingInformation.push('disruption')

  for (const rule of policy.rules) {
    if (rule.type === 'transport_mode' && segment.transport_mode !== null && !rule.values.includes(segment.transport_mode)) {
      result.status = 'not_eligible'
      result.reason = 'The booking transport mode does not match this policy.'
      return result
    }
    if (rule.type === 'provider' && segment.operator_name !== null && !matches(rule.values, segment.operator_name)) {
      result.status = 'not_eligible'
      result.reason = 'The booking provider does not match this policy.'
      return result
    }
    if (rule.type === 'booking_status' && segment.booking_status !== null && !matches(rule.values, segment.booking_status)) {
      result.status = 'not_eligible'
      result.reason = 'The booking status does not match this policy.'
      return result
    }
    if (rule.type === 'disruption_kind' && disruption && !matches(rule.values, disruption.kind)) {
      result.status = 'not_eligible'
      result.reason = 'The disruption type does not match this policy.'
      return result
    }
    if (
      rule.type === 'min_delay_minutes' &&
      disruption?.delay_minutes !== null &&
      disruption?.delay_minutes !== undefined &&
      disruption.delay_minutes < rule.value
    ) {
      result.status = 'not_eligible'
      result.reason = 'The recorded delay is below this policy threshold.'
      return result
    }
    if (rule.type === 'passenger_travel_status' && !rule.values.includes(segment.passenger_travel_status)) {
      result.status = 'not_eligible'
      result.reason = 'The passenger travel status does not match this policy.'
      return result
    }
    if (rule.type === 'cancellation_status' && segment.booking_status !== null && !matches(rule.values, segment.booking_status)) {
      result.status = 'not_eligible'
      result.reason = 'The cancellation status does not match this policy.'
      return result
    }
    if (rule.type === 'fare_required' && segment.fare_amount === null) result.missingInformation.push('fare amount')
    if (rule.type === 'minimum_fare' && segment.fare_amount !== null && segment.fare_amount < rule.value) {
      result.status = 'not_eligible'
      result.reason = 'The fare is below this policy threshold.'
      return result
    }
    if (rule.type === 'claim_deadline' && disruption) {
      const reportedAt = Date.parse(disruption.reported_at)
      const deadlineAt = Date.parse(evaluatedAt)
      if (Number.isNaN(reportedAt) || Number.isNaN(deadlineAt)) {
        result.missingInformation.push('valid claim dates')
      } else if (deadlineAt > reportedAt + rule.days * 24 * 60 * 60 * 1000) {
        result.status = 'not_eligible'
        result.reason = 'The claim deadline in this policy has passed.'
        return result
      }
    }
    if (rule.type === 'required_evidence') {
      result.requiredEvidence = [...new Set([...result.requiredEvidence, ...rule.values])]
    }
  }

  if (input.availableEvidence) {
    const available = new Set(input.availableEvidence.map(normalise))
    result.missingEvidence = result.requiredEvidence.filter((evidence) => !available.has(normalise(evidence)))
    result.missingInformation.push(...result.missingEvidence.map((evidence) => `evidence: ${evidence}`))
  }

  if (segment.transport_mode === null || segment.operator_name === null || !disruption) {
    result.reason = 'The journey or disruption facts are incomplete.'
    return result
  }

  if (result.missingInformation.length > 0) {
    result.reason = `More information is required: ${result.missingInformation.join(', ')}.`
    result.status = segment.passenger_travel_status === 'unknown' ? 'potentially_eligible' : 'insufficient_information'
    return result
  }

  if (segment.passenger_travel_status === 'unknown') {
    result.status = 'potentially_eligible'
    result.reason = 'The available facts match the policy, but passenger travel status is unknown.'
    return result
  }

  const amount = amountFor(policy, segment)
  if (policy.amount.type !== 'unknown' && policy.amount.type !== 'calculated' && amount.amount === null) {
    result.missingInformation.push('fare amount or policy amount')
    result.reason = 'The policy matches, but the eligible amount cannot be calculated from the available facts.'
    result.status = 'insufficient_information'
    return result
  }

  result.status = 'eligible'
  result.reason = 'The journey and disruption facts satisfy the active policy rules.'
  result.amount = amount.amount
  result.currency = amount.currency
  return result
}

export function createNoPolicyEligibilityResult(
  segment: RefundSegment,
  disruption: RefundDisruption | null,
  reason: string,
  availableEvidence: string[] = [],
  evaluatedAt = new Date().toISOString(),
): RefundEligibilityResult {
  return {
    status: 'insufficient_information',
    reason,
    amount: null,
    currency: segment.fare_currency,
    missingInformation: ['supported policy'],
    requiredEvidence: [],
    availableEvidence,
    missingEvidence: [],
    policyId: null,
    policyVersion: null,
    policyName: null,
    provider: null,
    source: null,
    effectiveFrom: null,
    evaluatedAt,
    evaluationInputs: {
      transportMode: segment.transport_mode,
      provider: segment.operator_name,
      bookingStatus: segment.booking_status,
      disruptionKind: disruption?.kind ?? null,
      delayMinutes: disruption?.delay_minutes ?? null,
      passengerTravelStatus: segment.passenger_travel_status,
      fareAmount: segment.fare_amount,
      fareCurrency: segment.fare_currency,
    },
  }
}

function stringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function ruleValues(rule: RefundPolicyRuleRow): string[] {
  const values = stringArray(rule.value_json)
  return values.length > 0 ? values : rule.value_text ? [rule.value_text] : []
}

function mapPolicyRule(rule: RefundPolicyRuleRow): PolicyRule | null {
  const values = ruleValues(rule)
  switch (rule.condition_type) {
    case 'transport_mode':
      return { type: 'transport_mode', values: values as TransportMode[] }
    case 'provider':
      return { type: 'provider', values }
    case 'booking_status':
      return { type: 'booking_status', values }
    case 'disruption_kind':
      return { type: 'disruption_kind', values }
    case 'delay_minutes':
      return rule.operator === 'gte' && rule.value_number !== null
        ? { type: 'min_delay_minutes', value: rule.value_number }
        : null
    case 'passenger_travel_status':
      return { type: 'passenger_travel_status', values: values as PassengerTravelStatus[] }
    case 'cancellation_status':
      return { type: 'cancellation_status', values }
    case 'fare_amount':
      return rule.operator === 'gte' && rule.value_number !== null
        ? { type: 'minimum_fare', value: rule.value_number }
        : null
    case 'claim_deadline':
      return rule.value_number !== null ? { type: 'claim_deadline', days: rule.value_number } : null
    case 'required_evidence':
      return { type: 'required_evidence', values }
    default:
      return null
  }
}

export function mapRefundPolicyRecord(row: RefundPolicyRow, rules: RefundPolicyRuleRow[]): RefundPolicy {
  return {
    id: row.id,
    transportMode: row.transport_mode,
    provider: row.provider,
    name: row.policy_name,
    version: row.policy_version,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    source: row.policy_source,
    status: row.policy_status,
    rules: rules.map(mapPolicyRule).filter((rule): rule is PolicyRule => rule !== null),
    amount: {
      type: row.amount_type,
      value: row.amount_value,
      percentage: row.amount_percentage,
      currency: row.amount_currency,
    },
    claimDeadlineDays: row.claim_deadline_days,
    requiredEvidence: stringArray(row.required_evidence),
    summary: row.policy_summary,
    applicableDisruptionTypes: stringArray(row.applicable_disruption_types),
    eligibilityConditions: stringArray(row.eligibility_conditions),
    exclusions: stringArray(row.exclusions),
    claimMethod: row.claim_method,
  }
}

const POLICY_COLUMNS =
  'id, transport_mode, provider, policy_name, policy_version, effective_from, effective_until, policy_source, policy_status, amount_type, amount_value, amount_percentage, amount_currency, claim_deadline_days, required_evidence, policy_summary, applicable_disruption_types, eligibility_conditions, exclusions, claim_method, created_at, updated_at'

/** Loads only active, non-sensitive policy records for the public library. */
export async function fetchPublicRefundPolicies(): Promise<RefundPolicy[]> {
  const { getSupabase } = await import('../lib/supabase')
  const supabase = getSupabase()
  const { data: rows, error } = await supabase
    .from('refund_policies')
    .select(POLICY_COLUMNS)
    .eq('policy_status', 'active')
    .order('transport_mode')
    .order('provider')
    .order('policy_name')

  if (error) throw error
  if (!rows || rows.length === 0) return []

  const policyIds = rows.map((row) => row.id)
  const { data: ruleRows, error: ruleError } = await supabase
    .from('refund_policy_rules')
    .select('id, policy_id, rule_order, condition_type, operator, value_text, value_number, value_json, created_at')
    .in('policy_id', policyIds)
    .order('rule_order')

  if (ruleError) throw ruleError
  const rulesByPolicy = new Map<string, RefundPolicyRuleRow[]>()
  for (const rule of ruleRows ?? []) {
    const current = rulesByPolicy.get(rule.policy_id) ?? []
    current.push(rule)
    rulesByPolicy.set(rule.policy_id, current)
  }

  return rows.map((row) => mapRefundPolicyRecord(row, rulesByPolicy.get(row.id) ?? []))
}

export async function fetchPublicRefundPolicy(policyId: string): Promise<RefundPolicy | null> {
  const policies = await fetchPublicRefundPolicies()
  return policies.find((policy) => policy.id === policyId) ?? null
}