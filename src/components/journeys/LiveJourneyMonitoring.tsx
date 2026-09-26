import { AlertTriangle, CheckCircle2, Clock3, MapPin, TrainFront } from 'lucide-react'
import { useState } from 'react'
import type { JourneyNotification, JourneySegment, RailRadarMonitoringState } from '../../types/database'
import type { JourneyTrainCandidate } from '../../services/railradarMonitoringService'

type Props = {
  segments: JourneySegment[]
  states: RailRadarMonitoringState[]
  notifications: JourneyNotification[]
  onTrainSelected: (segmentId: string, trainNumber: string) => Promise<void>
}

export function LiveJourneyMonitoring({ segments, states, notifications, onTrainSelected }: Props) {
  const trains = segments.filter((segment) => segment.transport_mode === 'train')
  if (trains.length === 0) return null

  const stateBySegment = new Map(states.map((state) => [state.segment_id, state]))
  const notificationBySegment = new Map<string, JourneyNotification>()
  for (const notification of notifications) {
    if (!notificationBySegment.has(notification.segment_id)) notificationBySegment.set(notification.segment_id, notification)
  }

  return (
    <section className="mb-7 border-y border-app-border py-5" aria-labelledby="live-monitoring-title">
      <div className="flex items-center gap-2">
        <TrainFront size={17} className="text-app-accent" aria-hidden="true" />
        <h2 id="live-monitoring-title" className="wva-eyebrow">Live journey monitoring</h2>
      </div>
      <div className="mt-4 divide-y divide-app-border">
        {trains.map((segment) => (
          <TrainMonitoringRow
            key={segment.id}
            segment={segment}
            state={stateBySegment.get(segment.id) ?? null}
            notification={notificationBySegment.get(segment.id) ?? null}
            onTrainSelected={onTrainSelected}
          />
        ))}
      </div>
    </section>
  )
}

function TrainMonitoringRow({
  segment,
  state,
  notification,
  onTrainSelected,
}: {
  segment: JourneySegment
  state: RailRadarMonitoringState | null
  notification: JourneyNotification | null
  onTrainSelected: (segmentId: string, trainNumber: string) => Promise<void>
}) {
  const [selectionPending, setSelectionPending] = useState<string | null>(null)
  const status = state?.operational_status && typeof state.operational_status === 'object' && !Array.isArray(state.operational_status)
    ? state.operational_status as Record<string, unknown>
    : null
  const stale = state?.monitoring_status === 'stale' || state?.monitoring_status === 'provider_unavailable'
  const providerTimestamp = text(status?.lastUpdatedAt) ?? state?.provider_timestamp ?? null
  const checkedText = state ? `Last checked ${relativeTime(state.checked_at)}.` : null
  const currentLocation = text(status?.currentLocation) ?? text(status?.currentStation)
  const knownTrainNumber = text(status?.trainNumber)
  const candidates = state?.identification_status === 'ambiguous' && !segment.service_number?.trim() && Array.isArray(state.identification_candidates)
    ? state.identification_candidates as unknown as JourneyTrainCandidate[]
    : []
  const identificationMessage = state?.identification_status === 'ambiguous' && !segment.service_number?.trim()
    ? 'Wayvo found multiple trains matching this journey.'
    : state?.identification_status === 'not_found'
      ? "Wayvo couldn't identify a train for this journey from the available booking and schedule information."
      : state?.identification_status === 'unavailable'
        ? state.last_error ?? 'Train identification is temporarily unavailable. Wayvo will retry.'
        : state?.identification_status === 'identifying' || (!state && !segment.service_number?.trim())
          ? 'Wayvo is identifying your train...'
          : null

  async function selectCandidate(candidate: JourneyTrainCandidate) {
    setSelectionPending(candidate.trainNumber)
    try {
      await onTrainSelected(segment.id, candidate.trainNumber)
    } catch {
      // The Journey page surfaces the error banner.
    } finally {
      setSelectionPending(null)
    }
  }

  return (
    <article className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[14px] font-semibold text-app-text">
            {segment.service_number ? `Train ${segment.service_number}` : knownTrainNumber ? `Train ${knownTrainNumber}` : 'Train identification'}
            {text(status?.trainName) ? ` · ${text(status?.trainName)}` : segment.operator_name ? ` · ${segment.operator_name}` : ''}
          </p>
          <p className="wva-meta mt-1">{segment.origin ?? 'Origin unavailable'} → {segment.destination ?? 'Destination unavailable'}</p>
        </div>
        {segment.service_number?.trim() && state?.identification_status === 'ambiguous' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-success"><CheckCircle2 size={14} aria-hidden="true" /> Train selected · monitoring starts on next scheduled check</span>
        ) : state?.identification_status === 'identified' && state.monitoring_status !== 'monitoring' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-success"><CheckCircle2 size={14} aria-hidden="true" /> Train identified</span>
        ) : state?.monitoring_status === 'monitoring' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-success"><CheckCircle2 size={14} aria-hidden="true" />{state.identification_status === 'identified' ? 'Train identified · Wayvo is monitoring this journey' : 'Wayvo is monitoring this journey'}</span>
        ) : state?.identification_status === 'ambiguous' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-warn"><AlertTriangle size={14} aria-hidden="true" /> Train choice needed</span>
        ) : state?.identification_status === 'not_found' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-warn"><AlertTriangle size={14} aria-hidden="true" /> Train not identified</span>
        ) : state?.identification_status === 'unavailable' || state?.monitoring_status === 'monitoring_unavailable' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-warn"><AlertTriangle size={14} aria-hidden="true" /> Monitoring unavailable</span>
        ) : state?.monitoring_status === 'stale' || state?.monitoring_status === 'provider_unavailable' ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-app-warn"><AlertTriangle size={14} aria-hidden="true" /> Live status unavailable</span>
        ) : (
          <span className="text-[12px] text-app-text-muted">Waiting for the scheduled job&rsquo;s first check</span>
        )}
      </div>

      {identificationMessage && <p className="mt-3 text-[13px] text-app-warn">{identificationMessage}</p>}
      {state?.last_error && state.identification_status !== 'unavailable' && <p className="mt-2 text-[13px] text-app-text-muted">{state.last_error}</p>}

      {state?.identification_status === 'ambiguous' && candidates.length > 0 && (
        <ul className="mt-4 divide-y divide-app-border border-y border-app-border" aria-label="Matching trains">
          {candidates.map((candidate) => (
            <li key={`${candidate.trainNumber}-${candidate.originCode}-${candidate.destinationCode}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-[13px] font-semibold text-app-text">{candidate.trainNumber} · {candidate.trainName}</p>
                <p className="mt-1 text-[12px] text-app-text-muted">
                  {candidate.originName} {candidate.departure ?? 'time unavailable'} → {candidate.destinationName} {candidate.arrival ?? 'time unavailable'}
                </p>
              </div>
              <button
                type="button"
                className="wva-btn wva-btn--secondary wva-btn--sm"
                disabled={selectionPending !== null}
                onClick={() => void selectCandidate(candidate)}
              >
                {selectionPending === candidate.trainNumber ? 'Selecting...' : 'Choose train'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(state?.monitoring_status === 'monitoring' || stale) && status && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Fact label={stale ? 'Last reported status' : 'Status'} value={statusText(status.status)} />
            <Fact label="Delay" value={numberText(status.delayMinutes, ' min')} />
            <Fact label="Expected arrival" value={timeText(status.expectedArrival)} />
            <Fact label="Next station" value={text(status.nextHalt) ?? 'Unavailable'} />
            <Fact label="Last updated" value={providerTimestamp ? absoluteTime(providerTimestamp) : 'Timestamp unavailable'} />
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-app-text-muted">
            <MapPin size={13} aria-hidden="true" />
            {stale
              ? 'Live train position is currently unavailable.'
              : currentLocation
                ? `Last reported near ${currentLocation}.`
                : 'Live train position is currently unavailable.'}
            {providerTimestamp && <span title={absoluteTime(providerTimestamp)}>Last updated {relativeTime(providerTimestamp)}.</span>}
          </p>
          {(status.cancelled === true || status.diverted === true || status.rescheduled === true) && (
            <p className="mt-2 text-[13px] font-medium text-app-warn">
              {status.cancelled === true ? 'RailRadar reports this train as cancelled.' : status.diverted === true ? 'RailRadar reports this train as diverted.' : 'RailRadar reports this train as rescheduled.'}
            </p>
          )}
          {Array.isArray(status.exceptions) && status.exceptions.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-app-text">
              {(status.exceptions as { detail?: unknown }[]).map((exception, index) => (
                <li key={`${String(exception.detail)}-${index}`}>{text(exception.detail) ?? 'Provider operational exception'}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {checkedText && <p className="mt-3 flex items-center gap-1.5 text-[11px] text-app-text-muted"><Clock3 size={12} aria-hidden="true" />{checkedText}</p>}

      {notification && (
        <div className="mt-4 border-l-2 border-app-warn pl-3" role="status">
          <p className="text-[13px] font-semibold text-app-text">Disruption detected</p>
          <p className="mt-1 text-[13px] text-app-text">{notification.headline}</p>
          <p className="mt-1 text-[12px] text-app-text-muted">{notification.detail}</p>
          <p className="mt-1 text-[12px] text-app-text-muted">Wayvo checked your journey and found a disruption. Review its impact and applicable policy below.</p>
        </div>
      )}
    </article>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="wva-meta">{label}</dt><dd className="mt-1 text-[13px] text-app-text">{value}</dd></div>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberText(value: unknown, suffix: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Unavailable'
}

function statusText(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Unavailable'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function timeText(value: unknown): string {
  if (typeof value !== 'string') return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : absoluteTime(value)
}

function absoluteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function relativeTime(value: string): string {
  const date = new Date(value).getTime()
  if (Number.isNaN(date)) return 'time unavailable'
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.floor(hours / 24)} days ago`
}