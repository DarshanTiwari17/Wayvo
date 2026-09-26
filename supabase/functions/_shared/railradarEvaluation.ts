import { calculateImpact } from '../../../src/services/impactService.ts'
import { evaluateRefundEligibility, createNoPolicyEligibilityResult, mapRefundPolicyRecord, type RefundPolicy } from '../../../src/services/refundPolicyService.ts'
import { selectApplicablePolicy } from '../../../src/services/refundEligibilityService.ts'
import type { Disruption, JourneySegment, RefundEligibilityResult, RefundPolicy as RefundPolicyRow, RefundPolicyRule as RefundPolicyRuleRow } from '../../../src/types/database.ts'

interface EvaluationEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

async function rows<T>(env: EvaluationEnv, path: string): Promise<T[]> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!response.ok) throw new Error(`Evaluation data read failed (${response.status}).`)
  return await response.json() as T[]
}

function policiesFromRows(policyRows: RefundPolicyRow[], ruleRows: RefundPolicyRuleRow[]): RefundPolicy[] {
  const rulesByPolicy = new Map<string, RefundPolicyRuleRow[]>()
  for (const rule of ruleRows) {
    const current = rulesByPolicy.get(rule.policy_id) ?? []
    current.push(rule)
    rulesByPolicy.set(rule.policy_id, current)
  }
  return policyRows.map((row) => mapRefundPolicyRecord(row, rulesByPolicy.get(row.id) ?? []))
}

export async function evaluateRailRadarDisruption(
  env: EvaluationEnv,
  profileId: string,
  tripId: string,
  segmentId: string,
  disruptionId: string,
): Promise<RefundEligibilityResult> {
  const [segments, disruptions, policyRows] = await Promise.all([
    rows<JourneySegment>(env, `journey_segments?trip_id=eq.${tripId}&select=*&order=seq.asc`),
    rows<Disruption>(env, `disruptions?id=eq.${disruptionId}&trip_id=eq.${tripId}&segment_id=eq.${segmentId}&select=*&limit=1`),
    rows<RefundPolicyRow>(env, 'refund_policies?policy_status=eq.active&select=*'),
  ])
  const segment = segments.find((candidate) => candidate.id === segmentId)
  const disruption = disruptions[0]
  if (!segment || !disruption) throw new Error('Provider disruption facts are not available for evaluation.')

  const policyIds = policyRows.map((policy) => policy.id)
  const ruleRows = policyIds.length > 0
    ? await rows<RefundPolicyRuleRow>(env, `refund_policy_rules?policy_id=in.(${policyIds.join(',')})&select=*&order=rule_order.asc`)
    : []
  const policies = policiesFromRows(policyRows, ruleRows)
  const policy = selectApplicablePolicy(policies, segment, disruption)
  const [documents] = await Promise.all([
    rows<{ extraction_status: string }>(env, `journey_documents?trip_id=eq.${tripId}&select=extraction_status`),
  ])
  const evidence: string[] = []
  if (documents.some((document) => document.extraction_status === 'processed')) evidence.push('ticket')
  if (segment.booking_reference || segment.pnr) evidence.push('booking details')

  const segmentInput = {
    transport_mode: segment.transport_mode,
    operator_name: segment.operator_name,
    booking_status: segment.booking_status,
    fare_amount: segment.fare_amount,
    fare_currency: segment.fare_currency,
    passenger_travel_status: segment.passenger_travel_status,
  }
  const result = policy
    ? evaluateRefundEligibility({ segment: segmentInput, disruption, policy, availableEvidence: evidence })
    : createNoPolicyEligibilityResult(segmentInput, disruption, 'No supported policy is currently configured for this provider.', evidence)
  const impact = calculateImpact(segments, disruption)
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
        status: impact.status,
        connectionStatus: impact.connectionAfterDisruption.status,
        downstreamAffectedSegmentIds: impact.downstreamAffectedSegmentIds,
        originalFinalArrivalAt: impact.originalFinalArrivalAt,
        projectedFinalArrivalAt: impact.projectedFinalArrivalAt,
      },
    },
    evaluated_at: result.evaluatedAt,
  }
  const existing = await rows<{ id: string }>(env,
    `refund_eligibility_results?segment_id=eq.${segmentId}&disruption_id=eq.${disruptionId}&select=id&limit=1`)
  if (existing[0]) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/refund_eligibility_results?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(evaluationFields),
    })
    if (!response.ok) throw new Error(`Eligibility result update failed (${response.status}).`)
  } else {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/refund_eligibility_results`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ profile_id: profileId, trip_id: tripId, segment_id: segmentId, disruption_id: disruptionId, ...evaluationFields }),
    })
    if (!response.ok) throw new Error(`Eligibility result insert failed (${response.status}).`)
  }
  return result
}