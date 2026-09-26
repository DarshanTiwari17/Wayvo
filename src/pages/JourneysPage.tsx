import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, Map, Plus, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useJourneys } from '../hooks/useTravelData'
import { createTrip, formatDateRange, formatRoute, isJourneyPast, TravelDataError, TRIP_STATUS_LABELS } from '../services/travelService'
import type { Trip } from '../types/database'
import { Banner, Button, Card, EmptyState, Field, PageHeader, Pill, SectionTitle, SkeletonLines } from '../components/app/Primitives'

/**
 * Wayvo — /journeys
 *
 * A real, read/write view of the `trips` table. The list is whatever the
 * database holds; the form performs a genuine Supabase insert. If the table is
 * empty the user gets an empty state, never a seeded example.
 */
export function JourneysPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const formOpen = searchParams.get('new') === '1'

  function openForm() {
    setSearchParams((params) => {
      params.set('new', '1')
      return params
    })
  }

  function closeForm() {
    setSearchParams((params) => {
      params.delete('new')
      return params
    })
  }

  // Deep link from the dashboard: /journeys?open=<id> focuses that journey.
  const openId = searchParams.get('open')
  useEffect(() => {
    if (!openId) return
    const element = document.getElementById(`journey-${openId}`)
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [openId, journeys.status])

  const upcoming = journeys.rows.filter((trip) => !isJourneyPast(trip))
  const past = journeys.rows.filter((trip) => isJourneyPast(trip))

  return (
    <>
      <PageHeader
        title="Your journeys"
        description="Every journey Wayvo is watching for you."
        actions={
          !formOpen ? (
            <Button onClick={openForm}>
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
              Add journey
            </Button>
          ) : undefined
        }
      />

      {formOpen && <JourneyForm onCancel={closeForm} onSaved={() => { closeForm(); navigate('/journeys', { replace: true }) }} />}

      {journeys.status === 'loading' && (
        <Card>
          <SkeletonLines rows={4} />
        </Card>
      )}

      {journeys.status === 'error' && (
        <Banner tone="danger">
          We could not load your journeys. {journeys.error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={journeys.reload}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {journeys.status === 'ready' && journeys.rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<Map size={22} strokeWidth={1.9} />}
            title="No journeys yet"
            description="Add your upcoming journey to let Wayvo monitor disruptions and help you recover when plans change."
            action={
              <Button onClick={openForm}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                Add journey
              </Button>
            }
          />
        </Card>
      )}

      {journeys.status === 'ready' && journeys.rows.length > 0 && (
        <div className="flex flex-col gap-6">
          {upcoming.length > 0 && (
            <Card>
              <SectionTitle>Upcoming</SectionTitle>
              <JourneyList trips={upcoming} />
            </Card>
          )}

          {past.length > 0 && (
            <Card>
              <SectionTitle>Past</SectionTitle>
              <JourneyList trips={past} />
            </Card>
          )}
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function JourneyList({ trips }: { trips: Trip[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {trips.map((trip) => (
        <li key={trip.id} id={`journey-${trip.id}`}>
          <div className="wva-card wva-card--interactive flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-app-text">{trip.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-app-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Map size={13} strokeWidth={2} aria-hidden="true" />
                  {formatRoute(trip)}
                </span>
                <span aria-hidden="true" className="text-app-text-subtle">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={13} strokeWidth={2} aria-hidden="true" />
                  {formatDateRange(trip.starts_on, trip.ends_on)}
                </span>
              </span>
            </span>

            <Pill tone={trip.status === 'active' ? 'info' : trip.status === 'completed' ? 'neutral' : 'success'}>
              {TRIP_STATUS_LABELS[trip.status]}
            </Pill>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */

type JourneyFormProps = { onCancel: () => void; onSaved: () => void }

function JourneyForm({ onCancel, onSaved }: JourneyFormProps) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: Record<string, string | undefined> = {}
    if (!title.trim()) {
      nextErrors.title = 'Give this journey a name.'
    } else if (title.trim().length > 120) {
      nextErrors.title = 'Keep the name under 120 characters.'
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      nextErrors.endsOn = 'The end date cannot be before the start date.'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !user) return

    setPending(true)
    try {
      await createTrip(user.id, {
        title: title.trim(),
        origin: origin.trim() || null,
        destination: destination.trim() || null,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        status: 'planning',
      })
      onSaved()
    } catch (cause) {
      setFormError(
        cause instanceof TravelDataError && cause.isMissingTable
          ? 'Journeys are not set up in the database yet. Run supabase/migrations/0002_travel.sql to enable them.'
          : cause instanceof Error
            ? cause.message
            : 'We could not save that journey. Please try again.',
      )
      setPending(false)
    }
  }

  return (
    <Card className="mb-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="wva-h2">Add a journey</h2>
          <p className="wva-meta mt-1">Where you are going, and roughly when.</p>
        </div>
        <button type="button" onClick={onCancel} className="wva-btn wva-btn--ghost wva-btn--sm" aria-label="Cancel">
          <X size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {formError && <Banner tone="danger">{formError}</Banner>}

        <Field id="title" label="Journey name" error={errors.title}>
          <input
            id="title"
            className="wva-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Summer in Portugal"
            autoComplete="off"
            maxLength={140}
            aria-invalid={Boolean(errors.title) || undefined}
            aria-describedby={errors.title ? 'title-error' : undefined}
            disabled={pending}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="origin" label="From" hint="Optional">
            <input
              id="origin"
              className="wva-input"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="London"
              autoComplete="off"
              disabled={pending}
            />
          </Field>

          <Field id="destination" label="To" hint="Optional">
            <input
              id="destination"
              className="wva-input"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Lisbon"
              autoComplete="off"
              disabled={pending}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="startsOn" label="Departing" hint="Optional" error={errors.startsOn}>
            <input
              id="startsOn"
              type="date"
              className="wva-input"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              aria-invalid={Boolean(errors.startsOn) || undefined}
              disabled={pending}
            />
          </Field>

          <Field id="endsOn" label="Returning" hint="Optional" error={errors.endsOn}>
            <input
              id="endsOn"
              type="date"
              className="wva-input"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              aria-invalid={Boolean(errors.endsOn) || undefined}
              aria-describedby={errors.endsOn ? 'endsOn-error' : undefined}
              disabled={pending}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={pending} pendingLabel="Saving…">
            Save journey
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
