/**
 * What to actually do about the scenario, and what is currently going wrong.
 *
 * The action list is the single source of the operational response: the
 * "recovery plan" sentence at the top is generated from the same list, so the
 * two can never describe different plans.
 */
import { CircleAlert, Clock, ListChecks, TriangleAlert } from 'lucide-react'
import { Pill } from '../../components/app/Primitives'
import { HAZARD_LABELS, type ActionUrgency, type DigitalTwinSimulation } from './digitalTwin'

const URGENCY_COPY: Record<ActionUrgency, { label: string; tone: 'danger' | 'warn' | 'neutral' }> = {
  now: { label: 'Do now', tone: 'danger' },
  soon: { label: 'Do soon', tone: 'warn' },
  monitor: { label: 'Monitor', tone: 'neutral' },
}

export function ResponsePanel({ simulation }: { simulation: DigitalTwinSimulation }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- the response ---------------------------------------------- */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="wva-eyebrow">Recovery plan</p>
            <h2 className="wva-h2 mt-1">Operational response</h2>
          </div>
          <span className="wva-meta text-app-text-muted">
            {simulation.actions.length} step{simulation.actions.length === 1 ? '' : 's'}
          </span>
        </div>

        <p className="wva-body mb-4">{simulation.recoveryPlan}</p>

        <ol className="space-y-2.5">
          {simulation.actions.map((action, index) => {
            const urgency = URGENCY_COPY[action.urgency]
            return (
              <li key={action.id} className="wva-digital-action">
                <span className="wva-digital-action__step" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-app-text">{action.label}</p>
                    <Pill tone={urgency.tone}>{urgency.label}</Pill>
                  </div>
                  <p className="wva-body mt-1">{action.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>

        {simulation.recommendedBufferMinutes > 0 && (
          <div className="wva-digital-plan mt-4">
            <Clock size={16} strokeWidth={2.1} aria-hidden="true" />
            <p className="wva-body">
              If you adopt this scenario, leave <strong className="font-semibold text-app-text">{simulation.recommendedBufferMinutes} min</strong>{' '}
              earlier than planned. That absorbs {Math.min(100, Math.round((simulation.recommendedBufferMinutes / Math.max(1, simulation.delayMinutes)) * 100))}% of the
              modelled {simulation.delayMinutes} min delay.
            </p>
          </div>
        )}
      </div>

      {/* ---- what is going wrong --------------------------------------- */}
      <div>
        <div className="mb-4">
          <p className="wva-eyebrow">Disruption centre</p>
          <h2 className="wva-h2 mt-1">Affected corridors</h2>
        </div>

        {simulation.disruptions.length === 0 ? (
          <div className="wva-digital-empty">
            <ListChecks size={18} strokeWidth={2} aria-hidden="true" />
            <div>
              <p className="text-[14px] font-semibold text-app-text">Nothing is disrupted in this scenario</p>
              <p className="wva-body mt-1">
                Every corridor stays normal and the arrival time is unchanged. Raise the intensity or the exposure
                duration to stress the network further.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {simulation.disruptions.map((disruption) => (
              <li key={disruption.id} className="wva-digital-disruption">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <p className="min-w-0 flex-1 text-[14px] font-semibold text-app-text">{disruption.label}</p>
                  <Pill tone={disruption.severity === 'critical' ? 'danger' : disruption.severity === 'warn' ? 'warn' : 'info'}>
                    {disruption.severity === 'critical' ? 'Critical' : disruption.severity === 'warn' ? 'Delayed' : 'Minor'} ·{' '}
                    {HAZARD_LABELS[disruption.hazard]}
                  </Pill>
                </div>
                <p className="wva-body mt-1.5">
                  <span className="text-app-text-subtle">{disruption.segment}</span> — {disruption.impact}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-app-text-muted">
                  <CircleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
                  Adds +{disruption.delayMinutes} min to this corridor
                </p>
              </li>
            ))}
          </ul>
        )}

        {simulation.disruptions.length > 0 && (
          <p className="mt-4 inline-flex items-start gap-1.5 text-[12px] text-app-text-subtle">
            <TriangleAlert size={12} strokeWidth={2.1} className="mt-px shrink-0" aria-hidden="true" />
            Each delay above is a share of that corridor&rsquo;s own modelled delay
            {simulation.disruptions.length < simulation.corridors.length ? '' : ', so the list adds up to the headline figure'}
            . {simulation.disruptions.length < simulation.corridors.length
              ? `Only the ${simulation.disruptions.length} worst of ${simulation.corridors.length} disrupted corridors are listed here — the full breakdown is above.`
              : ''}
          </p>
        )}
      </div>
    </div>
  )
}
