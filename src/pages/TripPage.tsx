import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Upload } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getSupabase } from '../lib/supabase'
import { TRIP_COLUMNS, type JourneySegment, type Trip } from '../types/database'
import { calculateImpact } from '../services/impactService'
import {
  confirmItinerary,
  fetchSegments,
  ImportError,
  rebuildItinerary,
  saveSegmentOrder,
} from '../services/importService'
import type { Itinerary } from '../lib/itineraryBuilder'
import { fetchTripDisruptions, formatDateRange, TravelDataError } from '../services/travelService'
import { Banner, Button, Card, PageHeader, Pill, SkeletonLines } from '../components/app/Primitives'
import { AddJourneyPanel } from '../components/journeys/AddJourneyPanel'
import { ItineraryRouteSummary, ItineraryView } from '../components/journeys/ItineraryView'
import { ManualSegmentForm } from '../components/journeys/ManualSegmentForm'
import { DisruptionImpactView } from '../components/journeys/DisruptionImpactView'
import { DisruptionSimulator } from '../components/journeys/DisruptionSimulator'
import { RefundEligibilityView } from '../components/journeys/RefundEligibilityView'
import { evaluateRefundEligibilityForDisruption, updatePassengerTravelStatus, type EligibilityEvaluation } from '../services/refundEligibilityService'
import { chooseTrainCandidate, fetchTripMonitoringStates, fetchTripNotifications, MonitoringDataError } from '../services/railradarMonitoringService'
import { LiveJourneyMonitoring } from '../components/journeys/LiveJourneyMonitoring'

/**
 * Wayvo — /journeys/:id
 *
 * One trip, and the bookings that make it up. The trip is the parent: a ticket
 * imported here becomes a booking on this trip, never a separate trip. After
 * every change Wayvo rebuilds the order from the bookings themselves.
 */
export function TripPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [rows, setRows] = useState<JourneySegment[]>([])
  const [disruptions, setDisruptions] = useState<Awaited<ReturnType<typeof fetchTripDisruptions>>>([])
  const [monitoringStates, setMonitoringStates] = useState<Awaited<ReturnType<typeof fetchTripMonitoringStates>>>([])
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof fetchTripNotifications>>>([])
  const [eligibility, setEligibility] = useState<EligibilityEvaluation | null>(null)
  const [eligibilityLoading, setEligibilityLoading] = useState(false)
  const [eligibilityError, setEligibilityError] = useState<string | null>(null)
  const [travelStatusPending, setTravelStatusPending] = useState(false)
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showImport, setShowImport] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const supabase = getSupabase()

    const { data: tripRow, error: tripError } = await supabase
      .from('trips')
      .select(TRIP_COLUMNS)
      .eq('id', id)
      .maybeSingle()

    if (tripError) {
      const missing = tripError.code === '42P01' || /does not exist|schema cache/i.test(tripError.message)
      setStatus(missing ? 'missing' : 'error')
      setError(tripError.message)
      return
    }

    if (!tripRow) {
      setStatus('ready')
      setTrip(null)
      return
    }

    setTrip(tripRow as Trip)

    try {
      const [segments, tripDisruptions, trainStates, tripNotifications] = await Promise.all([
        fetchSegments(id),
        fetchTripDisruptions(id),
        fetchTripMonitoringStates(id),
        fetchTripNotifications(id),
      ])
      setRows(segments)
      setDisruptions(tripDisruptions)
      setMonitoringStates(trainStates)
      setNotifications(tripNotifications)
      const built = await rebuildItinerary(id)
      setItinerary(built)
      const latest = tripDisruptions[0] ?? null
      if (user && latest?.segment_id) {
        setEligibilityLoading(true)
        setEligibilityError(null)
        try {
          setEligibility(await evaluateRefundEligibilityForDisruption(user.id, id, latest.segment_id, latest.id))
        } catch (cause) {
          setEligibility(null)
          setEligibilityError(cause instanceof Error ? cause.message : 'Refund eligibility could not be evaluated.')
        } finally {
          setEligibilityLoading(false)
        }
      } else {
        setEligibility(null)
      }
      setStatus('ready')
    } catch (cause) {
      const missing = (cause instanceof ImportError && /isn't set up/.test(cause.message)) ||
        (cause instanceof TravelDataError && cause.isMissingTable) ||
        (cause instanceof MonitoringDataError && cause.isMissingTable)
      setStatus(missing ? 'missing' : 'error')
      setError(cause instanceof Error ? cause.message : 'We could not load this trip.')
    }
  }, [id])

  useEffect(() => {
    setStatus('loading')
    void load()
  }, [load])

  // A booking was added: rebuild and show the new order.
  const handleChanged = useCallback(async () => {
    setBusy(true)
    try {
      const built = await rebuildItinerary(id)
      setItinerary(built)
      await load()
    } catch {
      /* load() already surfaces failures */
    } finally {
      setBusy(false)
    }
  }, [id, load])

  async function handleConfirmOrder() {
    setBusy(true)
    setError(null)
    try {
      await confirmItinerary(id)
      await handleChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not save that.')
    } finally {
      setBusy(false)
    }
  }

  async function handleMove(segmentId: string, direction: -1 | 1) {
    const order = (itinerary?.segments ?? []).map((segment) => segment.id)
    const index = order.indexOf(segmentId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return

    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]

    setBusy(true)
    setError(null)
    try {
      await saveSegmentOrder(id, next)
      await handleChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not move that booking.')
    } finally {
      setBusy(false)
    }
  }

  async function handleTravelStatusChange(status: JourneySegment['passenger_travel_status']) {
    const affectedSegmentId = latestDisruption?.segment_id
    if (!affectedSegmentId) return
    setTravelStatusPending(true)
    setError(null)
    try {
      await updatePassengerTravelStatus(id, affectedSegmentId, status)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Travel status could not be saved.')
    } finally {
      setTravelStatusPending(false)
    }
  }

  /* ---------------------------------------------------------------- */

  if (status === 'loading') {
    return (
      <>
        <PageHeader title="Trip" />
        <Card>
          <SkeletonLines rows={5} />
        </Card>
      </>
    )
  }

  if (status === 'missing') {
    return (
      <>
        <PageHeader title="Trip" />
        <Banner tone="warn">
          <p className="font-semibold">Trips aren&rsquo;t set up on this project yet.</p>
          <p className="mt-1">
            Run the journey migrations through <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">0009_railradar_monitoring.sql</code> in the
            Supabase SQL editor, then reload.
          </p>
        </Banner>
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        <PageHeader title="Trip" />
        <Banner tone="danger">
          We couldn&rsquo;t load this trip. {error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </Banner>
      </>
    )
  }

  if (!trip) {
    return (
      <>
        <PageHeader title="Trip" />
        <Card>
          <p className="wva-body">We couldn&rsquo;t find that trip.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => navigate('/journeys')}>
              Back to your trips
            </Button>
          </div>
        </Card>
      </>
    )
  }

  const bookingCount = rows.length
  const latestDisruption = disruptions[0] ?? null
  const orderedRows = (itinerary?.segments ?? []).flatMap((segment) => {
    const row = rows.find((candidate) => candidate.id === segment.id)
    return row ? [row] : []
  })
  const impact = calculateImpact(orderedRows, latestDisruption)

  return (
    <>
      <PageHeader
        title={trip.title}
        description={formatDateRange(trip.starts_on, trip.ends_on)}
        actions={
          <>
            <Link to="/journeys" className="wva-btn wva-btn--ghost wva-btn--sm">
              <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
              All trips
            </Link>
            {!showImport && !showManual && (
              <>
                <Button variant="secondary" onClick={() => setShowImport(true)}>
                  <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                  Import a booking
                </Button>
                <Button onClick={() => setShowManual(true)}>
                  <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                  Add journey
                </Button>
              </>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-5">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {itinerary && bookingCount > 0 && (
        <div className="mb-5">
          <ItineraryRouteSummary itinerary={itinerary} />
        </div>
      )}

      {bookingCount > 0 && (
        <LiveJourneyMonitoring
          segments={rows}
          states={monitoringStates}
          notifications={notifications}
          onTrainSelected={async (segmentId, trainNumber) => {
            setError(null)
            try {
              await chooseTrainCandidate(segmentId, trainNumber)
              await load()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'The selected train could not be saved.')
              throw cause
            }
          }}
        />
      )}

      {/* ---- import: the working PDF/ticket path, unchanged in behaviour --- */}
      {showImport && (
        <AddJourneyPanel
          tripId={trip.id}
          tripName={trip.title}
          onClose={() => setShowImport(false)}
          onSaved={() => void handleChanged()}
        />
      )}

      {/* ---- manual booking, now inside the trip -------------------------- */}
      {showManual && (
        <div className="mb-6">
          <ManualSegmentForm
            tripId={trip.id}
            onCancel={() => setShowManual(false)}
            onSaved={() => {
              setShowManual(false)
              void handleChanged()
            }}
          />
        </div>
      )}

      {/* ---- the itinerary ------------------------------------------------ */}
      {bookingCount === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <h2 className="wva-h3">No bookings in this trip yet</h2>
            <p className="wva-body max-w-md">
              A trip holds all the journeys you are taking. Upload the tickets you already have, and Wayvo will read them
              and work out the order for you.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setShowImport(true)}>
                <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                Upload ticket / PDF
              </Button>
              <Button variant="secondary" onClick={() => setShowManual(true)}>
                <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
                Add journey
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        itinerary && (
          <ItineraryView
            tripId={trip.id}
            rows={rows}
            itinerary={itinerary}
            onConfirmOrder={handleConfirmOrder}
            onMove={handleMove}
            confirming={busy}
          />
        )
      )}

      {bookingCount > 0 && !showImport && !showManual && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-app-border pt-5">
          <p className="wva-meta">
            {bookingCount} {bookingCount === 1 ? 'booking' : 'bookings'} in this trip.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
              <Upload size={14} strokeWidth={2.2} aria-hidden="true" />
              Add another booking
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowManual(true)}>
              <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
              Add journey
            </Button>
          </div>
        </div>
      )}

      <DisruptionImpactView impact={impact} disruption={latestDisruption} segments={rows} />

      {eligibilityError && <div className="mt-6"><Banner tone="danger">{eligibilityError}</Banner></div>}
      {eligibilityLoading && latestDisruption && <div className="mt-6"><Card><SkeletonLines rows={5} /></Card></div>}
      {!eligibilityLoading && latestDisruption?.segment_id && (
        <RefundEligibilityView
          evaluation={eligibility}
          segment={rows.find((row) => row.id === latestDisruption.segment_id) ?? null}
          onTravelStatusChange={(status) => void handleTravelStatusChange(status)}
          statusPending={travelStatusPending}
        />
      )}

      {import.meta.env.DEV && user && bookingCount > 0 && (
        <DisruptionSimulator profileId={user.id} tripId={trip.id} segments={rows} onCreated={() => void load()} />
      )}

      {!user && null}
    </>
  )
}

export function TripStatusPill({ trip }: { trip: Trip }) {
  return <Pill tone={trip.status === 'cancelled' ? 'danger' : 'neutral'}>{trip.status}</Pill>
}
