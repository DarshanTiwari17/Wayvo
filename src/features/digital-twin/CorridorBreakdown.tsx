/**
 * Corridor-by-corridor breakdown.
 *
 * The point of this panel is falsifiability: every corridor shows its own
 * scheduled minutes, the delay the model gave it, and the delay as a share of
 * its own duration. The delay column is a distribution of the headline figure,
 * so the column total always equals the number at the top of the page.
 */
import { TramFront } from 'lucide-react'
import { Pill } from '../../components/app/Primitives'
import {
  HAZARD_LABELS,
  connectionStatusLabel,
  formatMinutes,
  type DigitalTwinSimulation,
  type RouteStatus,
} from './digitalTwin'

const STATUS_COPY: Record<RouteStatus, string> = {
  normal: 'Running to plan',
  affected: 'Delayed segment',
  critical: 'Severely disrupted',
}

export function CorridorBreakdown({ simulation }: { simulation: DigitalTwinSimulation }) {
  const total = simulation.corridors.reduce((sum, corridor) => sum + corridor.delayMinutes, 0)
  // Bars are scaled against the worst corridor's share of the delay, so they
  // are comparable whether or not a corridor has a saved duration.
  const peak = Math.max(1, ...simulation.corridors.map((corridor) => corridor.delayVsAverage))

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Corridor breakdown</p>
          <h2 className="wva-h2 mt-1">Where the delay lands</h2>
        </div>
        <p className="wva-meta text-app-text-muted">
          {formatMinutes(total)} distributed across {simulation.corridors.length} corridor
          {simulation.corridors.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="space-y-3">
        {simulation.corridors.map((corridor) => (
          <li key={corridor.id} className="wva-digital-corridor">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-app-text" title={corridor.label}>
                  {corridor.label}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-app-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <TramFront size={12} strokeWidth={2} aria-hidden="true" />
                    {corridor.detail}
                  </span>
                  {corridor.baseMinutes > 0 && (
                    <span>
                      · {formatMinutes(corridor.baseMinutes)} scheduled
                      {corridor.estimatedBase ? ' (modelled)' : ''}
                    </span>
                  )}
                  {corridor.hazards.length > 0 && (
                    <span>· {corridor.hazards.map((hazard) => HAZARD_LABELS[hazard]).join(', ')}</span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {corridor.connectionStatus !== 'none' && corridor.connectionStatus !== 'ok' && (
                  <Pill tone={corridor.connectionStatus === 'broken' ? 'danger' : 'warn'}>
                    {connectionStatusLabel(corridor.connectionStatus)}
                  </Pill>
                )}
                <Pill tone={corridor.status === 'critical' ? 'danger' : corridor.status === 'affected' ? 'warn' : 'success'}>
                  {STATUS_COPY[corridor.status]}
                </Pill>
                <span className="wva-digital-corridor__delay">
                  {corridor.delayMinutes > 0 ? `+${corridor.delayMinutes} min` : '0 min'}
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-3">
              <div className="wva-digital-bar" aria-hidden="true">
                <span
                  className={`wva-digital-bar__fill wva-digital-bar__fill--${corridor.status}`}
                  style={{ width: `${Math.min(100, (corridor.delayVsAverage / peak) * 100)}%` }}
                />
              </div>
              {/* Two different measures, so say which one is being shown rather
                  than printing an ambiguous "+44%". */}
              <span className="wva-meta wva-digital-corridor__pct">
                {corridor.delayMinutes === 0
                  ? '—'
                  : corridor.estimatedBase
                    ? `${corridor.delayVsAverage.toFixed(1)}× avg`
                    : `+${corridor.delayPercent}% of leg`}
              </span>
            </div>

            {corridor.connectionMinutes !== null && (
              <p className="mt-1.5 text-[12px] text-app-text-subtle">
                {corridor.connectionMinutes} min changeover before this leg — the model adds{' '}
                {corridor.delayMinutes} min of delay against it.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[12px] text-app-text-subtle">
        Bars show each corridor&rsquo;s share of the delay relative to the average corridor, so they stay comparable even
        when a leg has no saved duration. Where a real duration is known, the figure on the right is the percentage of
        that leg&rsquo;s own scheduled time.
      </p>
    </div>
  )
}
