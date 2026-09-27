/**
 * Before / after, and the causal chain that connects them.
 *
 * The "now" column is the real world: the traveller's scheduled travel time and
 * the disruptions genuinely open on their account. It is never a hard-coded
 * zero, because a twin that claims a clean baseline while three alerts are
 * open is worse than no twin at all.
 */
import { CloudRain, MapPinned, Waves } from 'lucide-react'
import { Pill } from '../../components/app/Primitives'
import {
  HAZARD_LABELS,
  formatMinutes,
  riskLevelLabel,
  routeStatusLabel,
  type DigitalTwinSimulation,
} from './digitalTwin'

export type CurrentState = {
  disruptionCount: number
  routeStatus: 'normal' | 'affected' | 'critical'
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  /** True when the count came from a query that actually succeeded. */
  isKnown: boolean
}

export function ImpactPanel({
  simulation,
  current,
  currentNote,
}: {
  simulation: DigitalTwinSimulation
  current: CurrentState
  currentNote: string | null
}) {
  const rows: Array<{ label: string; now: string; then: string; changed: boolean }> = [
    {
      label: 'Travel time',
      now: formatMinutes(simulation.baselineTravelMinutes),
      then: formatMinutes(simulation.simulatedTravelMinutes),
      changed: simulation.delayMinutes > 0,
    },
    {
      label: 'Route status',
      now: current.isKnown ? routeStatusLabel(current.routeStatus) : 'Unknown',
      then: routeStatusLabel(simulation.routeStatus),
      changed: current.isKnown ? current.routeStatus !== simulation.routeStatus : simulation.routeStatus !== 'normal',
    },
    {
      label: 'Disruptions',
      now: current.isKnown ? String(current.disruptionCount) : 'Unknown',
      then: String(simulation.disruptionCount),
      changed: current.isKnown ? current.disruptionCount !== simulation.disruptionCount : simulation.disruptionCount > 0,
    },
    {
      label: 'Risk level',
      now: current.isKnown ? riskLevelLabel(current.riskLevel) : 'Unknown',
      then: riskLevelLabel(simulation.riskLevel),
      changed: current.isKnown ? current.riskLevel !== simulation.riskLevel : simulation.riskLevel !== 'low',
    },
  ]

  // Severity colour follows the modelled outcome: a scenario that changes
  // nothing must not be dressed up as a crisis.
  const impactTone =
    simulation.routeStatus === 'normal' ? 'neutral' : simulation.routeStatus === 'critical' ? 'danger' : 'warn'

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- before / after ------------------------------------------- */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="wva-eyebrow">Before / after</p>
            <h2 className="wva-h2 mt-1">System impact</h2>
          </div>
          <Pill tone="info">{simulation.weatherChange}</Pill>
        </div>

        <div className="wva-digital-metrics">
          <p className="wva-meta mb-2 text-app-text-muted">Now — from your real data</p>
          {rows.map((row) => (
            <div key={row.label} className="wva-digital-metrics__row">
              <span>{row.label}</span>
              <strong>{row.now}</strong>
            </div>
          ))}
          {currentNote && <p className="mt-2 text-[12px] text-app-text-subtle">{currentNote}</p>}
        </div>

        <div className="wva-digital-metrics wva-digital-metrics--simulated mt-3">
          <p className="wva-meta mb-2 text-app-text-muted">Simulated — under this scenario</p>
          {rows.map((row) => (
            <div key={row.label} className="wva-digital-metrics__row">
              <span>{row.label}</span>
              <strong>
                {row.then}
                {row.changed && <span className="wva-digital-metrics__delta">changed</span>}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {/* ---- cause → effect -------------------------------------------- */}
      <div>
        <div className="mb-4">
          <p className="wva-eyebrow">Simulation explanation</p>
          <h2 className="wva-h2 mt-1">Cause &rarr; effect</h2>
        </div>

        <div className="space-y-3">
          <Explanation icon={<CloudRain size={16} strokeWidth={2.1} aria-hidden="true" />} tone="info" title="Weather trigger">
            <p>{simulation.weatherChange}</p>
            {simulation.hazards.length > 0 && (
              <p className="mt-1.5 text-app-text-subtle">
                Hazards this produces: {simulation.hazards.map((hazard) => HAZARD_LABELS[hazard]).join(', ')}.
              </p>
            )}
          </Explanation>

          <Explanation
            icon={<Waves size={16} strokeWidth={2.1} aria-hidden="true" />}
            tone={impactTone}
            title="Impact"
          >
            <p>{simulation.impactSummary}</p>
          </Explanation>

          <Explanation
            icon={<MapPinned size={16} strokeWidth={2.1} aria-hidden="true" />}
            tone={impactTone}
            title="Route adaptation"
          >
            <p>{simulation.alternativeRoute}</p>
            {simulation.recommendedBufferMinutes > 0 && (
              <p className="mt-1.5 text-app-text-subtle">
                Recommended departure buffer: {simulation.recommendedBufferMinutes} min.
              </p>
            )}
          </Explanation>
        </div>
      </div>
    </div>
  )
}

function Explanation({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode
  tone: 'neutral' | 'info' | 'warn' | 'danger'
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={`wva-digital-explanation wva-digital-explanation--${tone}`}>
      <span className="wva-digital-explanation__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-app-text">{title}</p>
        <div className="wva-body mt-1">{children}</div>
      </div>
    </div>
  )
}
