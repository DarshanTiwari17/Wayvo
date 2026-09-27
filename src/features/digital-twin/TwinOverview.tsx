/**
 * The twin's "now" panel: the network as the scenario says it will be.
 *
 * The schematic is built from the simulated corridors rather than drawn as a
 * generic A→B bar, so what the traveller sees is literally the breakdown the
 * model produced — one node and one link per corridor, each carrying its own
 * status.
 */
import { Activity, Clock, ShieldAlert, TimerReset, TriangleAlert, Waves } from 'lucide-react'
import { Pill } from '../../components/app/Primitives'
import {
  HAZARD_LABELS,
  connectionStatusLabel,
  formatMinutes,
  riskLevelLabel,
  routeStatusLabel,
  type DigitalTwinSimulation,
} from './digitalTwin'

export type TwinOverviewProps = {
  simulation: DigitalTwinSimulation
  scopeLabel: string
  originLabel: string
  destinationLabel: string
}

const RESILIENCE_BANDS: Array<{ min: number; tone: 'danger' | 'warn' | 'success' | 'neutral'; label: string }> = [
  { min: 70, tone: 'success', label: 'Network is holding' },
  { min: 45, tone: 'warn', label: 'Limited slack' },
  { min: 20, tone: 'danger', label: 'Severely degraded' },
  { min: 0, tone: 'danger', label: 'Not viable' },
]

function resilienceBand(score: number) {
  return RESILIENCE_BANDS.find((band) => score >= band.min) ?? RESILIENCE_BANDS[RESILIENCE_BANDS.length - 1]
}

export function TwinOverview({ simulation, scopeLabel, originLabel, destinationLabel }: TwinOverviewProps) {
  const statusTone = simulation.routeStatus === 'critical' ? 'danger' : simulation.routeStatus === 'affected' ? 'warn' : 'success'
  const band = resilienceBand(simulation.resilienceScore)
  const connectionsTone =
    simulation.brokenConnections > 0 ? 'danger' : simulation.atRiskConnections > 0 ? 'warn' : simulation.corridors.length > 0 ? 'neutral' : 'neutral'

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="wva-eyebrow">Digital twin state</p>
          <h2 className="wva-h2 mt-1">Network under this scenario</h2>
          <p className="wva-meta mt-1 truncate">{scopeLabel}</p>
        </div>
        <Pill tone={statusTone}>{routeStatusLabel(simulation.routeStatus)}</Pill>
      </div>

      {/* ---- corridor schematic ---------------------------------------- */}
      <div
        className="wva-digital-track"
        role="img"
        aria-label={`Route schematic from ${originLabel} to ${destinationLabel}. ${routeStatusLabel(
          simulation.routeStatus,
        )} network, resilience ${simulation.resilienceScore} out of 100, ${simulation.delayMinutes} minutes of delay.`}
      >
        <div className="wva-digital-track__endpoints">
          <span className="wva-meta truncate" title={originLabel}>
            {originLabel}
          </span>
          <span className="wva-meta truncate" title={destinationLabel}>
            {destinationLabel}
          </span>
        </div>

        <div className="wva-digital-track__row">
          <span className="wva-digital-track__node wva-digital-track__node--start" aria-hidden="true">
            A
          </span>
          {simulation.corridors.map((corridor) => (
            <div
              key={corridor.id}
              className="wva-digital-track__leg"
              style={{ flexGrow: Math.max(1, corridor.baseMinutes || 1) }}
            >
              <span className={`wva-digital-track__link wva-digital-track__link--${corridor.status}`} aria-hidden="true" />
              <span className="wva-digital-track__caption">
                <span className="truncate">{corridor.label}</span>
                <span className="wva-digital-track__caption-meta">
                  +{corridor.delayMinutes} min
                  {corridor.connectionStatus !== 'none' && corridor.connectionStatus !== 'ok' && (
                    <span
                      className={`wva-digital-track__caption-warn${
                        corridor.connectionStatus === 'broken' ? ' wva-digital-track__caption-warn--critical' : ''
                      }`}
                    >
                      {connectionStatusLabel(corridor.connectionStatus)}
                    </span>
                  )}
                </span>
              </span>
            </div>
          ))}
          <span
            className={`wva-digital-track__node wva-digital-track__node--end wva-digital-track__node--${simulation.routeStatus}`}
            aria-hidden="true"
          >
            B
          </span>
        </div>
      </div>

      {/* ---- resilience ------------------------------------------------ */}
      <div className="wva-digital-gauge">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="wva-meta text-app-text-muted">Resilience score</p>
            <p className="wva-body mt-0.5">{band.label}</p>
          </div>
          <p className="text-[20px] font-semibold leading-none tracking-tight text-app-text">
            {simulation.resilienceScore}
            <span className="wva-meta ml-1 font-normal">/ 100</span>
          </p>
        </div>
        <div
          className="wva-digital-gauge__track"
          role="meter"
          aria-valuenow={simulation.resilienceScore}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Resilience score"
        >
          <span className={`wva-digital-gauge__fill wva-digital-gauge__fill--${band.tone}`} style={{ width: `${simulation.resilienceScore}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] text-app-text-subtle">100 minus the modelled risk score. Higher means more slack left in the plan.</p>
      </div>

      {/* ---- headline metrics ------------------------------------------ */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          icon={<TimerReset size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Simulated travel time"
          value={formatMinutes(simulation.simulatedTravelMinutes)}
          hint={`was ${formatMinutes(simulation.baselineTravelMinutes)}`}
          tone={simulation.delayMinutes > 0 ? 'warn' : 'neutral'}
        />
        <MetricCard
          icon={<Clock size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Delay added"
          value={simulation.delayMinutes > 0 ? `+${simulation.delayMinutes} min` : 'None'}
          hint={simulation.delayMinutes > 0 ? `${simulation.delayPercent}% longer` : 'unchanged'}
          tone={simulation.delayMinutes > 0 ? 'warn' : 'neutral'}
        />
        <MetricCard
          icon={<ShieldAlert size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Risk level"
          value={riskLevelLabel(simulation.riskLevel)}
          hint={`score ${simulation.riskScore}`}
          tone={simulation.riskLevel === 'critical' ? 'danger' : simulation.riskLevel === 'high' ? 'warn' : 'neutral'}
        />
        <MetricCard
          icon={<Waves size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Corridors disrupted"
          value={`${simulation.disruptionCount} of ${simulation.corridors.length}`}
          hint={
            simulation.disruptionCount === 0
              ? 'all corridors normal'
              : simulation.worstCorridor
                ? `worst: ${simulation.worstCorridor.label}`
                : ''
          }
          tone={statusTone === 'success' ? 'neutral' : 'warn'}
        />
        <MetricCard
          icon={<TriangleAlert size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Connections at risk"
          value={connectionMetricValue(simulation)}
          hint={connectionMetricHint(simulation)}
          tone={connectionsTone}
        />
        <MetricCard
          icon={<Activity size={16} strokeWidth={2.1} aria-hidden="true" />}
          label="Hazards modelled"
          value={simulation.hazards.length > 0 ? String(simulation.hazards.length) : 'None'}
          hint={simulation.hazards.length > 0 ? simulation.hazards.map((hazard) => HAZARD_LABELS[hazard]).join(', ') : 'clear'}
          tone={simulation.hazards.length > 0 ? 'warn' : 'neutral'}
        />
      </div>
    </div>
  )
}

function connectionMetricValue(simulation: DigitalTwinSimulation): string {
  if (simulation.brokenConnections > 0) return `${simulation.brokenConnections} lost`
  if (simulation.atRiskConnections > 0) return `${simulation.atRiskConnections} tight`
  const known = simulation.corridors.filter((corridor) => corridor.connectionStatus !== 'none').length
  return known > 0 ? 'All hold' : 'No changeovers'
}

function connectionMetricHint(simulation: DigitalTwinSimulation): string {
  if (simulation.brokenConnections > 0) return 'delay exceeds the changeover'
  if (simulation.atRiskConnections > 0) return 'over half the window gone'
  const known = simulation.corridors.filter((corridor) => corridor.connectionStatus !== 'none').length
  return known > 0 ? `${known} changeover${known === 1 ? '' : 's'} modelled` : 'no changeover data'
}

/* -------------------------------------------------------------------------- */

type MetricCardProps = {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  tone: 'neutral' | 'warn' | 'danger' | 'success'
}

function MetricCard({ icon, label, value, hint, tone }: MetricCardProps) {
  return (
    <div className="wva-digital-metric-card">
      <span
        className={`wva-digital-metric-card__icon${tone === 'neutral' ? '' : ` wva-digital-metric-card__icon--${tone}`}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="wva-meta text-app-text-muted">{label}</p>
        <p className="mt-1 text-[16px] font-semibold leading-tight text-app-text">{value}</p>
        <p className="mt-0.5 truncate text-[12px] text-app-text-subtle" title={hint}>
          {hint}
        </p>
      </div>
    </div>
  )
}
