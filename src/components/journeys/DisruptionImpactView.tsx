import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { JourneySegment } from '../../types/database'
import type { ImpactResult } from '../../services/impactService'
import { Card, Pill } from '../app/Primitives'

export function DisruptionImpactView({ impact, disruption, segments }: { impact: ImpactResult; disruption: { headline: string; kind: string } | null; segments: JourneySegment[] }) {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const affected = impact.affectedSegmentId ? byId.get(impact.affectedSegmentId) : null
  const connectionTone = impact.connectionAfterDisruption.status === 'connection_missed' ? 'danger' : impact.connectionAfterDisruption.status === 'connection_safe' ? 'success' : 'warn'
  const connectionLabel = impact.connectionAfterDisruption.status === 'connection_missed'
    ? 'Next connection missed'
    : impact.connectionAfterDisruption.status === 'connection_at_risk'
      ? 'Next connection is shorter than planned'
    : impact.connectionAfterDisruption.status === 'connection_safe'
      ? 'Next connection remains safe'
      : 'Connection impact unknown'

  return (
    <Card className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Journey event</p>
          <h2 className="wva-h2 mt-1">Disruption &amp; impact</h2>
        </div>
        {disruption && <Pill tone={disruption.kind === 'cancellation' ? 'danger' : 'warn'}>{disruption.kind}</Pill>}
      </div>

      {!disruption ? (
        <p className="wva-body mt-4">No disruptions have been recorded for this trip.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h3 className="wva-h3">Disruption</h3>
            <p className="wva-body mt-2">{disruption.headline}</p>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Original arrival" value={formatWhen(impact.originalArrivalAt)} />
              <Fact label="Projected arrival" value={formatWhen(impact.revisedArrivalAt)} />
              <Fact label="Delay" value={impact.delayMinutes === null ? 'Not determinable' : `${impact.delayMinutes} minutes`} />
              <Fact label="Affected segment" value={routeLabel(affected)} />
            </dl>
          </section>

          <section>
            <h3 className="wva-h3">Impact</h3>
            <div className="mt-3 flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[13px] text-app-text">
                {impact.affectedSegmentId ? <CheckCircle2 size={15} className="text-app-success" aria-hidden="true" /> : <AlertTriangle size={15} className="text-app-warn" aria-hidden="true" />}
                Journey segment affected
              </p>
              <p className="flex items-center gap-2 text-[13px] text-app-text">
                <AlertTriangle size={15} className={connectionTone === 'success' ? 'text-app-success' : 'text-app-warn'} aria-hidden="true" />
                {connectionLabel}
              </p>
              {impact.connectionAfterDisruption.projectedMinutes !== null && (
                <p className="flex items-center gap-2 text-[12px] text-app-text-muted">
                  <Clock size={14} aria-hidden="true" /> Projected connection: {impact.connectionAfterDisruption.projectedMinutes} minutes
                </p>
              )}
            </div>

            {impact.downstreamAffectedSegmentIds.length > 0 && (
              <div className="mt-5">
                <p className="wva-meta mb-2">Downstream affected</p>
                <ul className="flex flex-col gap-1.5">{impact.downstreamAffectedSegmentIds.map((id) => <li key={id} className="wva-body">{routeLabel(byId.get(id))}</li>)}</ul>
              </div>
            )}

            <p className="wva-meta mt-5">Original final arrival: {formatWhen(impact.originalFinalArrivalAt)}</p>
            <p className="wva-meta mt-1">Projected final arrival: {formatWhen(impact.projectedFinalArrivalAt)}</p>
            {impact.missingInformation.length > 0 && <p className="mt-3 rounded-lg bg-app-warn-soft px-3 py-2 text-[12px] text-app-warn">Missing or ambiguous: {impact.missingInformation.join(', ')}.</p>}
          </section>
        </div>
      )}
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="wva-meta">{label}</dt><dd className="mt-0.5 text-[13px] text-app-text">{value}</dd></div>
}

function routeLabel(segment: JourneySegment | null | undefined): string {
  if (!segment) return 'Unknown segment'
  return `${segment.origin ?? 'Origin not read'} → ${segment.destination ?? 'Destination not read'}`
}

function formatWhen(value: string | null): string {
  if (!value) return 'Not determinable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not determinable'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}