import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Check, Play, RotateCcw, Sparkles } from 'lucide-react'
import type { Trip, JourneySegment } from '../../types/database'
import { useTripSegments } from '../../features/digital-twin/useDigitalTwin'
import { streamRecoverySimulation } from '../../features/travel-chat/travelChatService'
import { formatDateRange, formatRoute } from '../../services/travelService'
import { Banner, Button, Card, EmptyState, Pill, SkeletonLines } from '../app/Primitives'

type JourneyQuery = {
  rows: Trip[]
  status: 'loading' | 'ready' | 'error' | 'missing'
  error: string | null
  reload: () => void
}

type DisruptionKind = 'delay' | 'cancellation' | 'missed connection'
type SimulationStatus = 'running' | 'disrupted' | 'analyzing' | 'complete' | 'error'

type SimulationRun = {
  id: string
  tripId: string
  segments: JourneySegment[]
  disruptedIndex: number
  disruptionKind: DisruptionKind
  delayMinutes: number | null
  stepIndex: number
  status: SimulationStatus
  startedAt: string
  recommendation: string
  error: string | null
}

type Props = {
  journeys: JourneyQuery
}

const DISRUPTION_LABEL: Record<DisruptionKind, string> = {
  delay: 'Departure delay',
  cancellation: 'Service cancellation',
  'missed connection': 'Missed connection',
}

function randomIndex(length: number): number {
  if (length <= 1) return 0
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    return values[0] % length
  }
  return Math.floor(Math.random() * length)
}

function randomDelayMinutes(): number {
  return 15 + randomIndex(46)
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Time not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function locationText(segment: JourneySegment): string {
  if (segment.origin && segment.destination) return `${segment.origin} → ${segment.destination}`
  if (segment.origin) return `From ${segment.origin}`
  if (segment.destination) return `To ${segment.destination}`
  return 'Location not provided'
}

function chooseDisruption(segment: JourneySegment, nextSegment: JourneySegment | undefined): { kind: DisruptionKind; delayMinutes: number | null } {
  const options: Array<{ kind: DisruptionKind; delayMinutes: number | null }> = [
    { kind: 'delay', delayMinutes: randomDelayMinutes() },
    { kind: 'cancellation', delayMinutes: null },
  ]
  if (nextSegment && segment.transport_mode !== 'hotel' && nextSegment.connection_minutes !== null) {
    options.push({
      kind: 'missed connection',
      delayMinutes: Math.max(randomDelayMinutes(), nextSegment.connection_minutes + 5),
    })
  }
  return options[randomIndex(options.length)]
}

export function JourneySimulation({ journeys }: Props) {
  const [simulation, setSimulation] = useState<SimulationRun | null>(null)
  const busy = simulation !== null && ['running', 'disrupted', 'analyzing'].includes(simulation.status)

  useEffect(() => {
    if (!simulation || simulation.status !== 'running') return
    const timer = window.setTimeout(() => {
      setSimulation((current) => {
        if (!current || current.status !== 'running') return current
        const nextIndex = current.stepIndex + 1
        return {
          ...current,
          stepIndex: nextIndex,
          status: nextIndex === current.disruptedIndex ? 'disrupted' : 'running',
        }
      })
    }, 850)
    return () => window.clearTimeout(timer)
  }, [simulation])

  useEffect(() => {
    if (!simulation || simulation.status !== 'disrupted') return
    const activeRun = simulation
    const tripExists = journeys.rows.some((row) => row.id === activeRun.tripId)
    if (!tripExists) {
      setSimulation((current) => current?.id === activeRun.id ? { ...current, status: 'error', error: 'The selected trip is no longer available.' } : current)
      return
    }

    setSimulation((current) => current?.id === activeRun.id ? { ...current, status: 'analyzing' } : current)
    const disruptedSegment = activeRun.segments[activeRun.disruptedIndex]
    void streamRecoverySimulation({
      tripId: activeRun.tripId,
      segmentId: disruptedSegment.id,
      kind: activeRun.disruptionKind,
      delayMinutes: activeRun.delayMinutes,
    },
      (token) => setSimulation((current) => current?.id === activeRun.id
        ? { ...current, recommendation: current.recommendation + token }
        : current),
    ).then(() => {
      setSimulation((current) => current?.id === activeRun.id ? { ...current, status: 'complete' } : current)
    }).catch((cause: unknown) => {
      setSimulation((current) => current?.id === activeRun.id
        ? { ...current, status: 'error', error: cause instanceof Error ? cause.message : 'The AI monitor could not produce a recommendation.' }
        : current)
    })
  }, [simulation, journeys.rows])

  function startSimulation(trip: Trip, segments: JourneySegment[]) {
    if (segments.length === 0 || busy) return
    const disruptedIndex = randomIndex(segments.length)
    const disruption = chooseDisruption(segments[disruptedIndex], segments[disruptedIndex + 1])
    setSimulation({
      id: `${trip.id}-${Date.now()}-${randomIndex(1_000_000)}`,
      tripId: trip.id,
      segments,
      disruptedIndex,
      disruptionKind: disruption.kind,
      delayMinutes: disruption.delayMinutes,
      stepIndex: -1,
      status: 'running',
      startedAt: new Date().toISOString(),
      recommendation: '',
      error: null,
    })
  }

  function retryAiAnalysis(runId: string) {
    setSimulation((current) => current?.id === runId
      ? { ...current, status: 'disrupted', recommendation: '', error: null }
      : current)
  }

  return (
    <section className="mb-7" aria-labelledby="journey-simulation-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Live simulation</p>
          <h2 id="journey-simulation-title" className="wva-h2 mt-1">Your itineraries</h2>
          <p className="wva-body mt-1">Play a saved journey and let the AI assess one simulated disruption against its exact itinerary.</p>
        </div>
        {busy && <Pill tone="warn"><Activity size={12} aria-hidden="true" /> Simulation in progress</Pill>}
      </div>

      {journeys.status === 'loading' && <Card><SkeletonLines rows={4} /></Card>}
      {(journeys.status === 'error' || journeys.status === 'missing') && (
        <Banner tone={journeys.status === 'missing' ? 'warn' : 'danger'}>
          {journeys.status === 'missing' ? 'Journey tables are not set up yet.' : `Journeys could not be loaded. ${journeys.error ?? ''}`}
          {journeys.status === 'error' && <Button className="ml-3" size="sm" variant="secondary" onClick={journeys.reload}>Retry</Button>}
        </Banner>
      )}
      {journeys.status === 'ready' && journeys.rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<Activity size={22} strokeWidth={1.9} />}
            title="No journeys to simulate"
            description="Add a trip and its tickets first. The simulation will use those saved steps, locations, and schedule details."
          />
        </Card>
      )}
      {journeys.status === 'ready' && journeys.rows.length > 0 && (
        <div className="flex flex-col gap-4">
          {journeys.rows.map((trip) => (
            <JourneySimulationCard
              key={trip.id}
              trip={trip}
              simulation={simulation?.tripId === trip.id ? simulation : null}
              disabled={busy}
              onStart={startSimulation}
              onRetryAI={retryAiAnalysis}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function JourneySimulationCard({
  trip,
  simulation,
  disabled,
  onStart,
  onRetryAI,
}: {
  trip: Trip
  simulation: SimulationRun | null
  disabled: boolean
  onStart: (trip: Trip, segments: JourneySegment[]) => void
  onRetryAI: (runId: string) => void
}) {
  const segments = useTripSegments(trip.id)
  const affected = simulation?.segments[simulation.disruptedIndex]

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="wva-h3">{trip.title}</h3>
          <p className="wva-body mt-1">{formatRoute(trip)} · {formatDateRange(trip.starts_on, trip.ends_on)}</p>
        </div>
        <Button
          size="sm"
          variant={simulation ? 'secondary' : 'primary'}
          disabled={disabled || segments.status !== 'ready' || segments.rows.length === 0}
          pending={segments.status === 'loading'}
          pendingLabel="Loading steps…"
          onClick={() => onStart(trip, segments.rows)}
        >
          {simulation ? <RotateCcw size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          {simulation ? 'Run again' : 'Start simulation'}
        </Button>
      </div>

      {segments.status === 'error' && <p className="wva-meta mt-3 text-app-danger">Itinerary could not be loaded: {segments.error}</p>}
      {segments.status === 'ready' && segments.rows.length === 0 && <p className="wva-meta mt-3">No saved itinerary steps yet.</p>}
      {segments.status === 'ready' && segments.rows.length > 0 && (
        <ol className="recovery-sim-itinerary mt-4">
          {segments.rows.map((segment, index) => {
            const isDisrupted = simulation !== null && index === simulation.disruptedIndex && simulation.stepIndex >= index
            const isReached = simulation !== null && index <= simulation.stepIndex
            return (
              <li className={`recovery-sim-step${isDisrupted ? ' recovery-sim-step--disrupted' : isReached ? ' recovery-sim-step--reached' : ''}`} key={segment.id}>
                <span className="recovery-sim-step__number">{isDisrupted ? <AlertTriangle size={15} /> : isReached ? <Check size={15} /> : index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong>{locationText(segment)}</strong>
                    {segment.transport_mode && <span className="wva-meta">{segment.transport_mode}</span>}
                    {segment.operator_name && <span className="wva-meta">· {segment.operator_name}</span>}
                    {segment.service_number && <span className="wva-meta">· {segment.service_number}</span>}
                    {isDisrupted && <Pill tone="danger">{DISRUPTION_LABEL[simulation.disruptionKind]}</Pill>}
                  </div>
                  <p className="wva-meta mt-1">
                    {formatTimestamp(segment.departure_at)}
                    {segment.arrival_at ? ` → ${formatTimestamp(segment.arrival_at)}` : ''}
                    {segment.connection_minutes !== null ? ` · ${segment.connection_minutes} min connection` : ''}
                  </p>
                  {(segment.booking_status || segment.needs_review) && (
                    <p className="wva-meta mt-1">
                      {segment.booking_status ? `Booking: ${segment.booking_status}` : ''}
                      {segment.needs_review ? ` · Review: ${segment.review_note || 'sequence unconfirmed'}` : ''}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {simulation && affected && (
        <div className="recovery-sim-monitor mt-4" aria-live="polite">
          <div className="flex items-center gap-2">
            {simulation.status === 'analyzing' ? <Sparkles size={16} aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}
            <p className="text-[14px] font-semibold">
              {simulation.status === 'running' && 'Journey in progress'}
              {simulation.status === 'disrupted' && 'Disruption detected'}
              {simulation.status === 'analyzing' && 'AI monitoring itinerary'}
              {simulation.status === 'complete' && 'Recovery recommendation'}
              {simulation.status === 'error' && 'AI monitor unavailable'}
            </p>
          </div>
          {simulation.stepIndex >= simulation.disruptedIndex && (
            <p className="wva-body mt-2">
              Simulated {DISRUPTION_LABEL[simulation.disruptionKind].toLowerCase()} on step {simulation.disruptedIndex + 1}: {locationText(affected)}
              {simulation.delayMinutes !== null ? ` · ${simulation.delayMinutes} minutes` : ''}
              {affected.departure_at ? ` · ${formatTimestamp(affected.departure_at)}` : ''}.
            </p>
          )}
          {simulation.recommendation && <p className="wva-body mt-3 whitespace-pre-wrap">{simulation.recommendation}</p>}
          {simulation.status === 'error' && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="wva-meta text-app-danger">{simulation.error}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRetryAI(simulation.id)}
              >
                Retry AI analysis
              </Button>
            </div>
          )}
          {simulation.status === 'complete' && (
            <p className="wva-meta mt-3">AI advice is based on your saved itinerary and plans. Service availability and fares have not been verified; confirm with the operator before changing bookings.</p>
          )}
        </div>
      )}
    </Card>
  )
}