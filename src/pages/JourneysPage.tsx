import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Map as MapIcon, Plus, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useJourneys } from '../hooks/useTravelData'
import { createTrip, isJourneyPast, TravelDataError } from '../services/travelService'
import type { TripInsert } from '../types/database'
import { getGmailConnection, type GmailConnection } from '../services/gmailService'
import { Banner, Button, Card, EmptyState, Field, PageHeader, SkeletonLines } from '../components/app/Primitives'
import { AddJourneyPanel } from '../components/journeys/AddJourneyPanel'
import { JourneyCard } from '../components/journeys/JourneyCard'
import { TRANSPORT_LABEL } from '../components/journeys/transport'

/**
 * Wayvo — /journeys
 *
 * A real, read/write view of `trips`, with two genuine import paths: uploading
 * a ticket, or importing a booking from Gmail. Both run through the same
 * extraction → review → confirm flow, and both write only what the traveller
 * approves.
 */
export function JourneysPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [gmail, setGmail] = useState<GmailConnection | null>(null)

  const showImport = searchParams.get('add') === '1'
  const formOpen = searchParams.get('new') === '1'

  useEffect(() => {
    void getGmailConnection().then(setGmail).catch(() => setGmail(null))
  }, [])

  function setFlag(key: string, on: boolean) {
    setSearchParams((params) => {
      if (on) params.set(key, '1')
      else params.delete(key)
      return params
    })
  }

  // The Gmail callback returns here with a result in the query string. It is
  // read once and then scrubbed, so a banner from a past attempt cannot stick
  // around or re-fire on a later render.
  const gmailResult = searchParams.get('gmail')
  useEffect(() => {
    if (!gmailResult) return

    if (gmailResult === 'connected') {
      void getGmailConnection().then(setGmail)
      setSearchParams((params) => {
        params.delete('gmail')
        params.set('add', '1')
        return params
      })
    } else {
      setSearchParams((params) => {
        params.delete('gmail')
        return params
      })
    }
  }, [gmailResult])

  // Deep link: /journeys?open=<id> scrolls that journey into view.
  const openId = searchParams.get('open')
  useEffect(() => {
    if (!openId) return
    const element = document.getElementById(`journey-${openId}`)
    if (element) element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [openId, journeys.status])

  const reloadAll = useCallback(() => journeys.reload(), [journeys])

  const upcoming = journeys.rows.filter((trip) => !isJourneyPast(trip))
  const past = journeys.rows.filter((trip) => isJourneyPast(trip))
  const hasAny = journeys.rows.length > 0

  return (
    <>
      <PageHeader
        title="Your journeys"
        description="Every journey Wayvo is watching for you."
        actions={
          !showImport && !formOpen ? (
            <>
              <Button variant="secondary" onClick={() => setFlag('add', true)}>
                Import a booking
              </Button>
              <Button onClick={() => setFlag('new', true)}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                Add journey
              </Button>
            </>
          ) : undefined
        }
      />

      {gmailResult === 'denied' && (
        <div className="mb-5">
          <Banner tone="warn">Gmail access wasn&rsquo;t granted. You can try again or upload your booking manually.</Banner>
        </div>
      )}
      {gmailResult === 'error' && (
        <div className="mb-5">
          <Banner tone="warn">Gmail couldn&rsquo;t be connected. You can try again or upload your booking manually.</Banner>
        </div>
      )}

      {showImport && (
        <AddJourneyPanel
          onClose={() => setFlag('add', false)}
          onSaved={() => {
            setFlag('add', false)
            reloadAll()
            navigate('/journeys', { replace: true })
          }}
        />
      )}

      {formOpen && <ManualJourneyForm onCancel={() => setFlag('new', false)} onSaved={() => { setFlag('new', false); reloadAll() }} />}

      {/* ---- empty state ------------------------------------------------- */}
      {journeys.status === 'loading' && (
        <Card>
          <SkeletonLines rows={4} />
        </Card>
      )}

      {journeys.status === 'error' && (
        <Banner tone="danger">
          We couldn&rsquo;t load your journeys. {journeys.error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={reloadAll}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {/* The import columns arrive in 0003. Say so plainly rather than showing
          an empty list, which would look like data loss. */}
      {journeys.status === 'missing' && (
        <Banner tone="warn">
          <p className="font-semibold">Journey importing isn&rsquo;t set up on this project yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">supabase/migrations/0003_journey_import.sql</code>{' '}
            in the Supabase SQL editor, then reload. Your existing journeys are untouched.
          </p>
        </Banner>
      )}

      {journeys.status === 'ready' && !hasAny && !showImport && !formOpen && (
        <Card>
          <EmptyState
            icon={<MapIcon size={22} strokeWidth={1.9} />}
            title="No journeys yet"
            description="Add one yourself, or bring in a booking and let Wayvo read the details."
            action={
              <>
                <Button onClick={() => setFlag('add', true)}>Upload ticket / PDF</Button>
                <Button
                  variant="secondary"
                  onClick={() => setFlag('new', true)}
                >
                  Add by hand
                </Button>
              </>
            }
          />

          <div className="mt-2 border-t border-app-border pt-5">
            <h3 className="wva-h3 mb-3">Add one using</h3>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Button variant="secondary" onClick={() => setFlag('add', true)}>
                Upload Ticket / PDF
              </Button>
              <Button variant="secondary" onClick={() => setFlag('add', true)}>
                {gmail ? 'Import from Gmail' : 'Import from Gmail'}
              </Button>
            </div>
            <p className="wva-meta mt-3">
              {gmail
                ? `Gmail connected as ${gmail.gmail_address ?? 'your account'}.`
                : 'Gmail is read-only and only used to find your booking emails.'}
            </p>
          </div>
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
                  <li key={trip.id} id={`journey-${trip.id}`}>
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
                  <li key={trip.id} id={`journey-${trip.id}`}>
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

type ManualFormProps = { onCancel: () => void; onSaved: () => void }

function ManualJourneyForm({ onCancel, onSaved }: ManualFormProps) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [transportMode, setTransportMode] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: Record<string, string | undefined> = {}
    if (!title.trim()) nextErrors.title = 'Give this journey a name.'
    else if (title.trim().length > 120) nextErrors.title = 'Keep the name under 120 characters.'
    if (startsOn && endsOn && endsOn < startsOn) nextErrors.endsOn = 'The end date cannot be before the start date.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || !user) return

    setPending(true)
    try {
      await createTrip(user.id, {
        title: title.trim(),
        origin: origin.trim() || null,
        destination: destination.trim() || null,
        transport_mode: (transportMode || null) as TripInsert['transport_mode'],
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        status: 'planning',
        source: 'manual',
      })
      onSaved()
    } catch (cause) {
      setFormError(
        cause instanceof TravelDataError && cause.isMissingTable
          ? 'Journeys are not set up in the database yet. Run supabase/migrations/0003_journey_import.sql to enable importing.'
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
          <h2 className="wva-h2">Add a journey by hand</h2>
          <p className="wva-meta mt-1">For journeys you have not imported yet.</p>
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
            <input id="origin" className="wva-input" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="London" disabled={pending} />
          </Field>
          <Field id="destination" label="To" hint="Optional">
            <input
              id="destination"
              className="wva-input"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Lisbon"
              disabled={pending}
            />
          </Field>
        </div>

        <Field id="transportMode" label="Transport" hint="Optional">
          <select
            id="transportMode"
            className="wva-select"
            value={transportMode}
            onChange={(event) => setTransportMode(event.target.value)}
            disabled={pending}
          >
            <option value="">Not set</option>
            {Object.entries(TRANSPORT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="startsOn" label="Departs" hint="Optional">
            <input id="startsOn" type="date" className="wva-input" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={pending} />
          </Field>
          <Field id="endsOn" label="Returns" hint="Optional" error={errors.endsOn}>
            <input
              id="endsOn"
              type="date"
              className="wva-input"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
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

