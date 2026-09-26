import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Map as MapIcon, Plus, Upload, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useJourneys } from '../hooks/useTravelData'
import { isJourneyPast } from '../services/travelService'
import { createTripRecord } from '../services/importService'
import type { Trip } from '../types/database'
import { AddJourneyPanel } from '../components/journeys/AddJourneyPanel'
import { Banner, Button, Card, EmptyState, Field, PageHeader, SkeletonLines } from '../components/app/Primitives'
import { JourneyCard } from '../components/journeys/JourneyCard'

/**
 * Wayvo — /journeys
 *
 * The list of trips. A trip is a container for the journeys you are taking, so
 * the one action on this page is "+ Add Trip". Individual journeys are added to a
 * trip from inside it, either by uploading the tickets you already have or by
 * typing one in.
 */
export function JourneysPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const formOpen = searchParams.get('new') === '1'
  // "Import a Booking" is a separate, first-class action — one document, one
  // journey. It is not the same thing as building an itinerary.
  const showImport = searchParams.get('import') === '1'

  function setFlag(key: string, on: boolean) {
    setSearchParams((params) => {
      if (on) params.set(key, '1')
      else params.delete(key)
      return params
    })
  }

  const upcoming = journeys.rows.filter((trip) => !isJourneyPast(trip))
  const past = journeys.rows.filter((trip) => isJourneyPast(trip))
  const hasAny = journeys.rows.length > 0

  return (
    <>
      <PageHeader
        title="Your trips"
        description="Each trip holds all the journeys you are taking."
        actions={
          formOpen || showImport ? undefined : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setFlag('import', true)}>
                <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                Import a booking
              </Button>
              <Button onClick={() => setFlag('new', true)}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                Add trip
              </Button>
            </div>
          )
        }
      />

      {/* ---- Import a Booking: one document becomes one journey ---------- */}
      {showImport && (
        <AddJourneyPanel
          mode="single"
          onClose={() => setFlag('import', false)}
          onSaved={() => {
            setFlag('import', false)
            journeys.reload()
          }}
        />
      )}

      {formOpen && (
        <CreateTripForm
          onCancel={() => setFlag('new', false)}
          onCreated={(trip) => {
            setFlag('new', false)
            // Land on the new trip with the upload panel already open, so the
            // traveller goes straight from naming it to adding bookings.
            navigate(`/journeys/${trip.id}?upload=1`)
          }}
        />
      )}

      {/* ---- empty state ------------------------------------------------- */}
      {journeys.status === 'loading' && (
        <Card>
          <SkeletonLines rows={4} />
        </Card>
      )}

      {journeys.status === 'error' && (
        <Banner tone="danger">
          We couldn&rsquo;t load your trips. {journeys.error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={journeys.reload}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {/* The trip columns arrive in 0003/0004. Say so plainly rather than
          showing an empty list, which would look like data loss. */}
      {journeys.status === 'missing' && (
        <Banner tone="warn">
          <p className="font-semibold">Trips aren&rsquo;t set up on this project yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">0003_journey_import.sql</code> and{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">0004_trip_hierarchy.sql</code> in
            the Supabase SQL editor, then reload.
          </p>
        </Banner>
      )}

      {journeys.status === 'ready' && !hasAny && !formOpen && !showImport && (
        <Card>
          <EmptyState
            icon={<MapIcon size={22} strokeWidth={1.9} />}
            title="Nothing here yet"
            description="Import a single booking you already have, or create a trip and add all the tickets for a whole itinerary at once."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => setFlag('import', true)}>
                  <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                  Import a booking
                </Button>
                <Button onClick={() => setFlag('new', true)}>
                  <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                  Add trip
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {/* ---- lists --------------------------------------------------------- */}
      {journeys.status === 'ready' && hasAny && (
        <div className="flex flex-col gap-6">
          {upcoming.length > 0 && (
            <section>
              <h2 className="wva-h2 mb-3">Upcoming</h2>
              <ul className="flex flex-col gap-3">
                {upcoming.map((trip) => (
                  <li key={trip.id}>
                    <JourneyCard trip={trip} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="wva-h2 mb-3">Past</h2>
              <ul className="flex flex-col gap-3">
                {past.map((trip) => (
                  <li key={trip.id}>
                    <JourneyCard trip={trip} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

type CreateFormProps = { onCancel: () => void; onCreated: (trip: Trip) => void }

/**
 * "Create your trip" — names the parent container. The journeys go in after.
 */
function CreateTripForm({ onCancel, onCreated }: CreateFormProps) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const trimmed = title.trim()
    if (!trimmed) {
      setError('Give this trip a name.')
      return
    }
    if (trimmed.length > 120) {
      setError('Keep the name under 120 characters.')
      return
    }
    if (!user) return

    setError(undefined)
    setPending(true)
    try {
      const trip = await createTripRecord(user.id, trimmed)
      onCreated(trip)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'We could not create that trip. Please try again.')
      setPending(false)
    }
  }

  return (
    <Card className="mb-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="wva-h2">Create your trip</h2>
          <p className="wva-meta mt-1">
            Name the trip, then upload all the tickets for it. Wayvo reads each one and works out the order.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="wva-btn wva-btn--ghost wva-btn--sm" aria-label="Cancel">
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex max-w-lg flex-col gap-5">
        {formError && <Banner tone="danger">{formError}</Banner>}

        <Field id="trip-title" label="Trip name" error={error}>
          <input
            id="trip-title"
            className="wva-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Goa Vacation"
            autoComplete="off"
            maxLength={140}
            aria-invalid={Boolean(error) || undefined}
            disabled={pending}
            autoFocus
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={pending} pendingLabel="Creating…">
            Create trip
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
