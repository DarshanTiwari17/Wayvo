import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Check, Play, RotateCcw, Sparkles } from 'lucide-react'
import type { Trip, JourneySegment } from '../../types/database'
import { useTripSegments } from '../../features/digital-twin/useDigitalTwin'
import { streamRecoverySimulation } from '../../features/travel-chat/travelChatService'
import { formatDateRange, formatRoute } from '../../services/travelService'
import { Banner, Button, Card, EmptyState, Pill, SkeletonLines } from '../app/Primitives'
import {
  planRealisticDisruption,
  simulationDurationMs,
  type PlannedDisruption,
  type SimulatedDisruptionKind,
} from './simulationModel'

type JourneyQuery = {
  rows: Trip[]
  status: 'loading' | 'ready' | 'error' | 'missing'
  error: string | null
  reload: () => void
}

type AnalysisStatus = 'idle' | 'analyzing' | 'complete' | 'error'

type SimulationRun = {
  id: string
  tripId: string
  segments: JourneySegment[]
  disruption: PlannedDisruption | null
  stepIndex: number
  durationMs: number
  status: 'running' | 'complete'
  analysisStatus: AnalysisStatus
  recommendation: string
  error: string | null
}

type Props = {
  journeys: JourneyQuery
}

const DISRUPTION_LABEL: Record<SimulatedDisruptionKind, string> = {
  delay: 'Departure delay',
  cancellation: 'Service cancellation',
  'missed connection': 'Missed connection',
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

export function JourneySimulation({ journeys }: Props) {
  const [simulation, setSimulation] = useState<SimulationRun | null>(null)
  const busy = simulation?.status === 'running' || simulation?.analysisStatus === 'analyzing'
  const runStatus = simulation?.status
  const stepIndex = simulation?.stepIndex
  const segmentCount = simulation?.segments.length ?? 0
  const durationMs = simulation?.durationMs

  useEffect(() => {
    if (runStatus !== 'running' || stepIndex === undefined || segmentCount === 0 || durationMs === undefined) return
    const stepDurationMs = Math.ceil(durationMs / segmentCount)
    const timer = window.setTimeout(() => {
      setSimulation((current) => {
        if (!current || current.status !== 'running') return current
        const nextIndex = current.stepIndex + 1
        if (nextIndex >= current.segments.length - 1) {
          return { ...current, stepIndex: current.segments.length - 1, status: 'complete' }
        }
        return { ...current, stepIndex: nextIndex }
      })
    }, stepDurationMs)
    return () => window.clearTimeout(timer)
  }, [runStatus, stepIndex, segmentCount, durationMs])

  useEffect(() => {
    if (
      !simulation ||
      !simulation.disruption ||
      simulation.stepIndex < simulation.disruption.segmentIndex ||
      simulation.analysisStatus !== 'idle'
    ) return
    const activeRun = simulation
    if (!activeRun.disruption) return
    const disruption = activeRun.disruption
    const tripExists = journeys.rows.some((row) => row.id === activeRun.tripId)
    if (!tripExists) {
      setSimulation((current) => current?.id === activeRun.id
        ? { ...current, analysisStatus: 'error', error: 'The selected trip is no longer available.' }
        : current)
      return
    }

    setSimulation((current) => current?.id === activeRun.id ? { ...current, analysisStatus: 'analyzing' } : current)
    const disruptedSegment = activeRun.segments[disruption.segmentIndex]
    if (!disruptedSegment) {
      setSimulation((current) => current?.id === activeRun.id
        ? { ...current, analysisStatus: 'error', error: 'The disrupted itinerary step is no longer available.' }
        : current)
      return
    }
    void streamRecoverySimulation({
      tripId: activeRun.tripId,
      segmentId: disruptedSegment.id,
      kind: disruption.kind,
      delayMinutes: disruption.delayMinutes,
    },
      (token) => setSimulation((current) => current?.id === activeRun.id
        ? { ...current, recommendation: current.recommendation + token }
        : current),
    ).then(() => {
      setSimulation((current) => current?.id === activeRun.id ? { ...current, analysisStatus: 'complete' } : current)
    }).catch((cause: unknown) => {
      setSimulation((current) => current?.id === activeRun.id
        ? { ...current, analysisStatus: 'error', error: cause instanceof Error ? cause.message : 'The AI monitor could not produce a recommendation.' }
        : current)
    })
  }, [simulation, journeys.rows])

  function startSimulation(trip: Trip, segments: JourneySegment[]) {
    if (segments.length === 0 || busy) return
    setSimulation({
      id: `${trip.id}-${Date.now()}`,
      tripId: trip.id,
      segments,
      disruption: planRealisticDisruption(segments),
      stepIndex: -1,
      durationMs: simulationDurationMs(segments.length),
      status: 'running',
      analysisStatus: 'idle',
      recommendation: '',
      error: null,
    })
  }

  function retryAiAnalysis(runId: string) {
    setSimulation((current) => current?.id === runId
      ? { ...current, analysisStatus: 'idle', recommendation: '', error: null }
      : current)
  }

  return (
    <section className="mb-7" aria-labelledby="journey-simulation-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Journey simulation</p>
          <h2 id="journey-simulation-title" className="wva-h2 mt-1">Your itineraries</h2>
          <p className="wva-body mt-1">Watch a hypothetical service disruption progress through a saved itinerary. This is not a live alert.</p>
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
  const disruption = simulation?.disruption
  const affected = disruption ? simulation?.segments[disruption.segmentIndex] : null

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
            const isDisrupted = disruption !== undefined && disruption !== null && index === disruption.segmentIndex && (simulation?.stepIndex ?? -1) >= index
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
                    {isDisrupted && disruption && <Pill tone="danger">{DISRUPTION_LABEL[disruption.kind]}</Pill>}
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

      {simulation && (
        <div className="recovery-sim-monitor mt-4" aria-live="polite">
          <div className="flex items-center gap-2">
            {simulation.analysisStatus === 'analyzing' ? <Sparkles size={16} aria-hidden="true" /> : <Activity size={16} aria-hidden="true" />}
            <p className="text-[14px] font-semibold">
              {simulation.status === 'running' && 'Journey in progress'}
              {simulation.status === 'complete' && 'Journey completed'}
            </p>
          </div>
          {disruption && affected && simulation.stepIndex >= disruption.segmentIndex && (
            <p className="wva-body mt-2">
              Hypothetical {DISRUPTION_LABEL[disruption.kind].toLowerCase()} on step {disruption.segmentIndex + 1}: {locationText(affected)}
              {disruption.delayMinutes !== null ? ` · ${disruption.delayMinutes} minutes` : ''}
              {affected.departure_at ? ` · ${formatTimestamp(affected.departure_at)}` : ''}.
            </p>
          )}
          {simulation.analysisStatus === 'analyzing' && <p className="wva-meta mt-3">Assessing the remaining itinerary and connection buffers…</p>}
          {simulation.recommendation && <p className="wva-body mt-3 whitespace-pre-wrap">{simulation.recommendation}</p>}
          {simulation.status === 'complete' && !disruption && (
            <p className="wva-meta mt-3">No scheduled transport segment was available for a realistic disruption scenario.</p>
          )}
          {simulation.analysisStatus === 'error' && (
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
          {simulation.analysisStatus === 'complete' && (
            <p className="wva-meta mt-3">AI advice is based on your saved itinerary and plans. Service availability and fares have not been verified; confirm with the operator before changing bookings.</p>
          )}
        </div>
      )}
    </Card>
  )
}