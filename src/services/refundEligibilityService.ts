import { calculateImpact, type ImpactResult } from './impactService.ts'
import { fetchPublicRefundPolicies, createNoPolicyEligibilityResult, evaluateRefundEligibility, type RefundEligibilityResult, type RefundPolicy } from './refundPolicyService.ts'
import type { JourneySegment, PassengerTravelStatus } from '../types/database.ts'

export interface EligibilityEvaluation {
  result: RefundEligibilityResult
  policy: RefundPolicy | null
  impact: ImpactResult
  availableEvidence: string[]
  missingEvidence: string[]
}

function normalise(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function selectApplicablePolicy(
  policies: RefundPolicy[],
  segment: JourneySegment,
  disruption: { kind: string; reported_at: string },
  evaluatedAt = new Date().toISOString(),
): RefundPolicy | null {
  if (!segment.transport_mode || !segment.operator_name) return null
  const eventDate = Date.parse(disruption.reported_at)
  const evaluationDate = Date.parse(evaluatedAt)
  const candidates = policies.filter((policy) => {
    if (policy.status !== 'active') return false
    if (policy.transportMode !== segment.transport_mode) return false
    if (normalise(policy.provider) !== normalise(segment.operator_name)) return false
    const starts = Date.parse(`${policy.effectiveFrom}T00:00:00`)
    const ends = policy.effectiveUntil ? Date.parse(`${policy.effectiveUntil}T23:59:59`) : Number.POSITIVE_INFINITY
    const referenceDate = Number.isNaN(eventDate) ? evaluationDate : eventDate
    if (Number.isNaN(starts) || referenceDate < starts || referenceDate > ends) return false
    if (policy.applicableDisruptionTypes.length > 0 && !policy.applicableDisruptionTypes.map(normalise).includes(normalise(disruption.kind))) return false
    const ruleKinds = policy.rules.filter((rule) => rule.type === 'disruption_kind').flatMap((rule) => rule.values)
    if (ruleKinds.length > 0 && !ruleKinds.map(normalise).includes(normalise(disruption.kind))) return false
    return true
  })

  return candidates.sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.version.localeCompare(left.version))[0] ?? null
}

async function availableEvidence(tripId: string, segment: JourneySegment): Promise<string[]> {
  const { getSupabase } = await import('../lib/supabase.ts')
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('journey_documents')
    .select('id, mime_type, extraction_status, origin, trip_id')
    .eq('trip_id', tripId)

  if (error) throw error
  const evidence: string[] = []
  if ((data ?? []).some((document) => document.extraction_status === 'processed')) evidence.push('ticket')
  if (segment.booking_reference || segment.pnr) evidence.push('booking details')
  return evidence
}

async function persistEvaluation(
  profileId: string,
  tripId: string,
  segmentId: string,
  disruptionId: string,
  evaluation: EligibilityEvaluation,
): Promise<EligibilityEvaluation> {
  const { getSupabase } = await import('../lib/supabase.ts')
  const supabase = getSupabase()
  const result = evaluation.result
  const evaluationFields = {
    policy_id: result.policyId,
    policy_name: result.policyName,
    policy_provider: result.provider,
    policy_version: result.policyVersion,
    policy_source: result.source,
    policy_effective_from: result.effectiveFrom,
    eligibility_status: result.status,
    reason: result.reason,
    eligible_amount: result.amount,
    currency: result.currency,
    missing_information: result.missingInformation,
    required_evidence: result.requiredEvidence,
    available_evidence: result.availableEvidence,
    missing_evidence: result.missingEvidence,
    evaluation_inputs: {
      ...result.evaluationInputs,
      impact: {
        status: evaluation.impact.status,
        connectionStatus: evaluation.impact.connectionAfterDisruption.status,
        downstreamAffectedSegmentIds: evaluation.impact.downstreamAffectedSegmentIds,
        originalFinalArrivalAt: evaluation.impact.originalFinalArrivalAt,
        projectedFinalArrivalAt: evaluation.impact.projectedFinalArrivalAt,
      },
    },
    evaluated_at: result.evaluatedAt,
  }
  const row = {
    profile_id: profileId,
    trip_id: tripId,
    segment_id: segmentId,
    disruption_id: disruptionId,
    ...evaluationFields,
  }

  const { data: current, error: currentError } = await supabase
    .from('refund_eligibility_results')
    .select('id')
    .eq('segment_id', segmentId)
    .eq('disruption_id', disruptionId)
    .maybeSingle()
  if (currentError) throw currentError

  if (current) {
    const { error } = await supabase.from('refund_eligibility_results').update(evaluationFields).eq('id', current.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('refund_eligibility_results').insert(row)
    if (error) throw error
  }
  return evaluation
}

/** Loads facts, calculates impact, selects one exact policy, evaluates, and persists the private current result. */
export async function evaluateRefundEligibilityForDisruption(
  profileId: string,
  tripId: string,
  segmentId: string,
  disruptionId: string,
): Promise<EligibilityEvaluation> {
  const [{ fetchSegments }, { fetchTripDisruptions }] = await Promise.all([
    import('./importService.ts'),
    import('./travelService.ts'),
  ])
  const [segments, disruptions, policies] = await Promise.all([
    fetchSegments(tripId),
    fetchTripDisruptions(tripId),
    fetchPublicRefundPolicies(),
  ])
  const segment = segments.find((candidate) => candidate.id === segmentId)
  const disruption = disruptions.find((candidate) => candidate.id === disruptionId)
  if (!segment || !disruption) throw new Error('The journey facts for this evaluation are no longer available.')

  const impact = calculateImpact(segments, disruption)
  const evidence = await availableEvidence(tripId, segment)
  const policy = selectApplicablePolicy(policies, segment, disruption)
  const policyInput = {
    transport_mode: segment.transport_mode,
    operator_name: segment.operator_name,
    booking_status: segment.booking_status,
    fare_amount: segment.fare_amount,
    fare_currency: segment.fare_currency,
    passenger_travel_status: segment.passenger_travel_status,
  }
  const result = policy
    ? evaluateRefundEligibility({ segment: policyInput, disruption, policy, availableEvidence: evidence })
    : createNoPolicyEligibilityResult(policyInput, disruption, 'No supported policy is currently configured for this provider.', evidence)

  const evaluation: EligibilityEvaluation = {
    result,
    policy,
    impact,
    availableEvidence: result.availableEvidence,
    missingEvidence: result.missingEvidence,
  }
  return persistEvaluation(profileId, tripId, segmentId, disruptionId, evaluation)
}

export async function updatePassengerTravelStatus(
  tripId: string,
  segmentId: string,
  status: PassengerTravelStatus,
): Promise<void> {
  const { getSupabase } = await import('../lib/supabase')
  const supabase = getSupabase()
  const { error } = await supabase
    .from('journey_segments')
    .update({ passenger_travel_status: status })
    .eq('id', segmentId)
    .eq('trip_id', tripId)
  if (error) throw error
}

export async function fetchCurrentEligibility(segmentId: string, disruptionId: string): Promise<RefundEligibilityResult | null> {
  const { getSupabase } = await import('../lib/supabase')
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('refund_eligibility_results')
    .select('id, profile_id, trip_id, segment_id, disruption_id, policy_id, policy_name, policy_provider, policy_version, policy_source, policy_effective_from, eligibility_status, reason, eligible_amount, currency, missing_information, required_evidence, available_evidence, missing_evidence, evaluation_inputs, evaluated_at, created_at, updated_at')
    .eq('segment_id', segmentId)
    .eq('disruption_id', disruptionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    status: data.eligibility_status,
    reason: data.reason,
    amount: data.eligible_amount,
    currency: data.currency,
    missingInformation: jsonStrings(data.missing_information),
    requiredEvidence: jsonStrings(data.required_evidence),
    availableEvidence: jsonStrings(data.available_evidence),
    missingEvidence: jsonStrings(data.missing_evidence),
    policyId: data.policy_id,
    policyVersion: data.policy_version,
    policyName: data.policy_name,
    provider: data.policy_provider,
    source: data.policy_source,
    effectiveFrom: data.policy_effective_from,
    evaluatedAt: data.evaluated_at,
    evaluationInputs: data.evaluation_inputs as unknown as RefundEligibilityResult['evaluationInputs'],
  }
}