import { useState } from 'react'
import { AlertTriangle, Check, ExternalLink, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { JourneySegment, PassengerTravelStatus } from '../../types/database'
import type { EligibilityEvaluation } from '../../services/refundEligibilityService'
import { formatFare } from './JourneyReview'
import { Banner, Button, Card, Pill } from '../app/Primitives'

const STATUS_LABELS = {
  eligible: 'Eligible',
  potentially_eligible: 'Potentially eligible',
  not_eligible: 'Not eligible',
  insufficient_information: 'More information required',
} as const

export function RefundEligibilityView({
  evaluation,
  segment,
  onTravelStatusChange,
  statusPending,
}: {
  evaluation: EligibilityEvaluation | null
  segment: JourneySegment | null
  onTravelStatusChange: (status: PassengerTravelStatus) => void
  statusPending: boolean
}) {
  const [claimReviewOpen, setClaimReviewOpen] = useState(false)
  if (!evaluation || !segment) return null

  const { result, policy } = evaluation
  const available = new Set(result.availableEvidence.map((item) => item.toLowerCase()))
  const tone = result.status === 'eligible' ? 'success' : result.status === 'not_eligible' ? 'danger' : 'warn'

  return (
    <Card className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Private to you</p>
          <h2 className="wva-h2 mt-1 flex items-center gap-2"><ShieldCheck size={20} aria-hidden="true" /> Refund protection</h2>
        </div>
        <Pill tone={tone}>{STATUS_LABELS[result.status]}</Pill>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h3 className="wva-h3">Result</h3>
          <p className="wva-body mt-2">{result.reason}</p>
          <div className="mt-4 rounded-lg bg-app-surface-alt px-4 py-3">
            <p className="wva-meta">{result.status === 'eligible' ? 'Eligible amount' : 'Estimated amount'}</p>
            <p className="mt-1 text-[20px] font-semibold text-app-text">
              {result.amount === null ? 'Amount cannot currently be determined.' : formatFare(result.amount, result.currency)}
            </p>
          </div>

          <div className="mt-5">
            <h3 className="wva-h3">Passenger travel status</h3>
            <p className="wva-meta mt-1">Wayvo does not infer this from the disruption.</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[13px] text-app-text">
                <input type="radio" name={`travel-status-${segment.id}`} checked={segment.passenger_travel_status === 'travelled'} onChange={() => onTravelStatusChange('travelled')} disabled={statusPending} />
                Travelled
              </label>
              <label className="flex items-center gap-2 text-[13px] text-app-text">
                <input type="radio" name={`travel-status-${segment.id}`} checked={segment.passenger_travel_status === 'not_travelled'} onChange={() => onTravelStatusChange('not_travelled')} disabled={statusPending} />
                Did not travel
              </label>
              <label className="flex items-center gap-2 text-[13px] text-app-text">
                <input type="radio" name={`travel-status-${segment.id}`} checked={segment.passenger_travel_status === 'unknown'} onChange={() => onTravelStatusChange('unknown')} disabled={statusPending} />
                Unknown
              </label>
            </div>
          </div>
        </section>

        <section>
          <h3 className="wva-h3">Evidence</h3>
          {result.requiredEvidence.length === 0 ? (
            <p className="wva-body mt-2">No evidence requirements were returned by this policy.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {result.requiredEvidence.map((evidence) => {
                const present = available.has(evidence.toLowerCase())
                return <li key={evidence} className="flex items-center gap-2 text-[13px] text-app-text">{present ? <Check size={15} className="text-app-success" aria-hidden="true" /> : <AlertTriangle size={15} className="text-app-warn" aria-hidden="true" />}{evidence}{present ? '' : ' (missing)'}</li>
              })}
            </ul>
          )}
          {result.missingInformation.length > 0 && (
            <div className="mt-4 rounded-lg bg-app-warn-soft px-3 py-2 text-[12px] text-app-warn">
              <p className="font-semibold">Missing information</p>
              <ul className="mt-1 list-disc pl-4">{result.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          <h3 className="wva-h3 mt-6">Policy used</h3>
          {policy ? (
            <div className="mt-2 text-[13px] text-app-text">
              <p className="font-semibold">{policy.name}</p>
              <p className="wva-meta mt-1">Version: {policy.version}</p>
              <p className="wva-meta">Source: {policy.source}</p>
              <Link to={`/policies/${policy.id}`} className="wva-btn wva-btn--ghost wva-btn--sm mt-3">
                View policy <ExternalLink size={14} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="wva-body mt-2">Refund policy not configured for this provider.</p>
          )}
        </section>
      </div>

      {result.status === 'eligible' && (
        <div className="mt-6 border-t border-app-border pt-4">
          {!claimReviewOpen ? (
            <Button variant="secondary" onClick={() => setClaimReviewOpen(true)}>Review refund</Button>
          ) : (
            <Banner tone="info">Claim review is a placeholder. Nothing has been submitted and no provider has been contacted.</Banner>
          )}
        </div>
      )}
    </Card>
  )
}