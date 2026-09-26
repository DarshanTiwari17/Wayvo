import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import type { JourneySegment } from '../../types/database'
import { createDisruption } from '../../services/travelService'
import { fromLocalInput, toLocalInput } from './ManualSegmentForm'
import { Banner, Button, Card, Field } from '../app/Primitives'

type Props = {
  profileId: string
  tripId: string
  segments: JourneySegment[]
  onCreated: () => void
}

export function DisruptionSimulator({ profileId, tripId, segments, onCreated }: Props) {
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? '')
  const [kind, setKind] = useState<'delay' | 'cancellation'>('delay')
  const [delayMinutes, setDelayMinutes] = useState('30')
  const [revisedDeparture, setRevisedDeparture] = useState<string | null>(null)
  const [revisedArrival, setRevisedArrival] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = segments.find((segment) => segment.id === segmentId) ?? null

  useEffect(() => {
    if (!selected) return
    setRevisedDeparture(selected.departure_at)
    setRevisedArrival(selected.arrival_at)
  }, [selected])

  async function handleSubmit() {
    if (!selected) return
    setPending(true)
    setError(null)
    const parsedDelay = Number(delayMinutes)
    const validDelay = Number.isFinite(parsedDelay) && parsedDelay >= 0 ? Math.round(parsedDelay) : null
    if (kind === 'delay' && validDelay === null) {
      setError('Enter a delay of zero minutes or more.')
      setPending(false)
      return
    }

    try {
      await createDisruption(profileId, {
        trip_id: tripId,
        segment_id: selected.id,
        kind,
        severity: kind === 'cancellation' || (validDelay ?? 0) >= 120 ? 'critical' : 'warn',
        headline: kind === 'cancellation' ? 'Development simulation: cancellation' : `Development simulation: ${validDelay} minute delay`,
        detail: 'Created by the development-only disruption simulator.',
        reported_at: new Date().toISOString(),
        delay_minutes: kind === 'delay' ? validDelay : null,
        original_departure_at: selected.departure_at,
        original_arrival_at: selected.arrival_at,
        revised_departure_at: kind === 'delay' ? revisedDeparture : null,
        revised_arrival_at: kind === 'delay' ? revisedArrival : null,
        cancellation_at: kind === 'cancellation' ? new Date().toISOString() : null,
        provider_event_reference: null,
        source: 'simulator',
      })
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The simulated disruption could not be created.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="mt-8 border-dashed border-app-warn">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-app-warn-soft text-app-warn">
          <FlaskConical size={17} aria-hidden="true" />
        </span>
        <div>
          <p className="wva-eyebrow">Developer test tools</p>
          <h2 className="wva-h3 mt-1">Disruption simulator</h2>
          <p className="wva-meta mt-1">Creates a real disruption row using the same schema as future provider events. It is not rendered in production.</p>
        </div>
      </div>

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="sim-segment" label="Journey segment">
          <select id="sim-segment" className="wva-select" value={segmentId} onChange={(event) => setSegmentId(event.target.value)} disabled={pending}>
            {segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.origin ?? 'Unknown'} → {segment.destination ?? 'Unknown'}</option>)}
          </select>
        </Field>
        <Field id="sim-kind" label="Event">
          <select id="sim-kind" className="wva-select" value={kind} onChange={(event) => setKind(event.target.value as 'delay' | 'cancellation')} disabled={pending}>
            <option value="delay">Delay</option>
            <option value="cancellation">Cancellation</option>
          </select>
        </Field>
      </div>

      {kind === 'delay' && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id="sim-delay" label="Delay minutes">
            <input id="sim-delay" className="wva-input" type="number" min="0" step="1" value={delayMinutes} onChange={(event) => setDelayMinutes(event.target.value)} disabled={pending} />
          </Field>
          <Field id="sim-departure" label="Revised departure" hint="Optional">
            <input id="sim-departure" className="wva-input" type="datetime-local" value={toLocalInput(revisedDeparture)} onChange={(event) => setRevisedDeparture(fromLocalInput(event.target.value))} disabled={pending} />
          </Field>
          <Field id="sim-arrival" label="Revised arrival" hint="Optional">
            <input id="sim-arrival" className="wva-input" type="datetime-local" value={toLocalInput(revisedArrival)} onChange={(event) => setRevisedArrival(fromLocalInput(event.target.value))} disabled={pending} />
          </Field>
        </div>
      )}

      <div className="mt-4"><Button onClick={() => void handleSubmit()} pending={pending} pendingLabel="Creating…">Create disruption</Button></div>
    </Card>
  )
}