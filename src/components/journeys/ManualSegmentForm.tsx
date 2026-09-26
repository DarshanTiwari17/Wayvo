import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Banner, Button, Field } from '../app/Primitives'
import { TRANSPORT_LABEL } from './transport'
import { emptyDraft, saveSegment, type JourneyDraft } from '../../services/importService'
import type { TransportMode } from '../../lib/bookingParser'
import { ImportError } from '../../services/importService'

/**
 * "+ Add Journey" — a booking typed in by hand.
 *
 * This used to be a top-level action that created a whole journey. It now adds
 * one booking to the trip the traveller is looking at, so several of these build
 * up a single itinerary. It lives inside the trip, directly under the ticket
 * upload, for exactly that reason.
 */

type Props = {
  tripId: string
  onSaved: () => void
  onCancel: () => void
}

export function ManualSegmentForm({ tripId, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<JourneyDraft>(emptyDraft)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const set = <K extends keyof JourneyDraft>(key: K, value: JourneyDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: Record<string, string | undefined> = {}
    if (!draft.origin?.trim() && !draft.destination?.trim()) {
      nextErrors.origin = 'Give at least a starting point or a destination.'
    }
    if (draft.departureAt && draft.arrivalAt && draft.arrivalAt < draft.departureAt) {
      nextErrors.arrivalAt = 'The arrival time cannot be before the departure time.'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setPending(true)
    try {
      await saveSegment(tripId, {
        ...draft,
        title: draft.title.trim() || [draft.origin, draft.destination].filter(Boolean).join(' → '),
        origin: draft.origin?.trim() || null,
        destination: draft.destination?.trim() || null,
        operator: draft.operator?.trim() || null,
        serviceNumber: draft.serviceNumber?.trim() || null,
        passengerName: draft.passengerName?.trim() || null,
        // Hand-typed, so nothing is "confirmed from a document".
        provenance: {},
        confidence: null,
      })
      onSaved()
    } catch (cause) {
      setFormError(cause instanceof ImportError ? cause.message : 'That booking could not be added. Please try again.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="wva-card wva-card--pad">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="wva-h3">Add a journey by hand</h3>
          <p className="wva-meta mt-1">
            For a booking you do not have a ticket for. It joins this trip and Wayvo will work out where it fits.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="wva-btn wva-btn--ghost wva-btn--sm" aria-label="Cancel">
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {formError && <Banner tone="danger">{formError}</Banner>}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="seg-origin" label="From" error={errors.origin}>
            <input
              id="seg-origin"
              className="wva-input"
              value={draft.origin ?? ''}
              onChange={(event) => set('origin', event.target.value)}
              placeholder="Pune"
              disabled={pending}
              autoFocus
            />
          </Field>
          <Field id="seg-destination" label="To">
            <input
              id="seg-destination"
              className="wva-input"
              value={draft.destination ?? ''}
              onChange={(event) => set('destination', event.target.value)}
              placeholder="Goa"
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field id="seg-mode" label="Transport" hint="Optional">
            <select
              id="seg-mode"
              className="wva-select"
              value={draft.transportMode ?? ''}
              onChange={(event) => set('transportMode', (event.target.value || null) as TransportMode | null)}
              disabled={pending}
            >
              <option value="">Not set</option>
              {Object.entries(TRANSPORT_LABEL)
                .filter(([value]) => value !== 'hotel')
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          <Field id="seg-operator" label="Operator" hint="Optional">
            <input
              id="seg-operator"
              className="wva-input"
              value={draft.operator ?? ''}
              onChange={(event) => set('operator', event.target.value)}
              placeholder="Indigo"
              disabled={pending}
            />
          </Field>
          <Field id="seg-service" label="Number" hint="Optional">
            <input
              id="seg-service"
              className="wva-input"
              value={draft.serviceNumber ?? ''}
              onChange={(event) => set('serviceNumber', event.target.value)}
              placeholder="6E 2145"
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="seg-departure" label="Departs" hint="Optional">
            <input
              id="seg-departure"
              type="datetime-local"
              className="wva-input"
              value={toLocalInput(draft.departureAt)}
              onChange={(event) => set('departureAt', fromLocalInput(event.target.value))}
              disabled={pending}
            />
          </Field>
          <Field id="seg-arrival" label="Arrives" hint="Optional" error={errors.arrivalAt}>
            <input
              id="seg-arrival"
              type="datetime-local"
              className="wva-input"
              value={toLocalInput(draft.arrivalAt)}
              onChange={(event) => set('arrivalAt', fromLocalInput(event.target.value))}
              disabled={pending}
              aria-invalid={Boolean(errors.arrivalAt) || undefined}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field id="seg-ref" label="Booking ref" hint="Optional">
            <input
              id="seg-ref"
              className="wva-input"
              value={draft.bookingReference ?? ''}
              onChange={(event) => set('bookingReference', event.target.value.toUpperCase())}
              disabled={pending}
            />
          </Field>
          <Field id="seg-pnr" label="PNR" hint="Optional">
            <input
              id="seg-pnr"
              className="wva-input"
              value={draft.pnr ?? ''}
              onChange={(event) => set('pnr', event.target.value.toUpperCase())}
              disabled={pending}
            />
          </Field>
          <Field id="seg-passenger" label="Passenger" hint="Optional">
            <input
              id="seg-passenger"
              className="wva-input"
              value={draft.passengerName ?? ''}
              onChange={(event) => set('passengerName', event.target.value)}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={pending} pendingLabel="Adding…">
            <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
            Add to trip
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in local time, not a UTC ISO string. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The inverse: local wall-clock input becomes a real ISO instant. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
