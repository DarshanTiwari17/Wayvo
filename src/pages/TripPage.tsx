import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Upload } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getSupabase } from '../lib/supabase'
import { TRIP_COLUMNS, type JourneySegment, type Trip } from '../types/database'
import {
  confirmItinerary,
  fetchSegments,
  ImportError,
  rebuildItinerary,
  saveSegmentOrder,
} from '../services/importService'
import type { Itinerary } from '../lib/itineraryBuilder'
import { formatDateRange } from '../services/travelService'
import { Banner, Button, Card, PageHeader, SkeletonLines } from '../components/app/Primitives'
import { BatchImportPanel } from '../components/journeys/BatchImportPanel'
import { ItineraryRouteSummary, ItineraryView } from '../components/journeys/ItineraryView'
import { ManualSegmentForm } from '../components/journeys/ManualSegmentForm'

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
  const [searchParams, setSearchParams] = useSearchParams()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [rows, setRows] = useState<JourneySegment[]>([])
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inside a trip the traveller adds documents in bulk: a whole itinerary's
  // worth of tickets, not one at a time.
  const [showImport, setShowImport] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // "+ Add Trip" hands off to this page with ?upload=1, so the traveller lands on
  // the upload step directly instead of having to find the button themselves.
  // The parameter is consumed and cleared, so a later reload keeps the panel open
  // without the URL advertising it.
  useEffect(() => {
    if (searchParams.get('upload') !== '1') return
    setShowImport(true)
    const params = new URLSearchParams(searchParams)
    params.delete('upload')
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

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
      const segments = await fetchSegments(id)
      setRows(segments)
      const built = await rebuildItinerary(id)
      setItinerary(built)
      setStatus('ready')
    } catch (cause) {
      const missing = cause instanceof ImportError && /isn't set up/.test(cause.message)
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

      // Reflect the traveller's order at once. The builder treats a confirmed
      // order as authoritative, so this is the source of truth rather than a
      // temporary visual that the next rebuild would discard.
      setItinerary((current) => {
        if (!current) return current
        const byId = new Map(current.segments.map((segment) => [segment.id, segment]))
        const reordered = next
          .map((segmentId, position) => {
            const segment = byId.get(segmentId)
            return segment
              ? { ...segment, seq: position, sequenceConfirmed: true, needsReview: false, reviewNote: null }
              : null
          })
          .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
        return { ...current, segments: reordered, confident: true }
      })

      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not move that booking.')
    } finally {
      setBusy(false)
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
            Run <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">0003_journey_import.sql</code> and{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[12px]">0004_trip_hierarchy.sql</code> in the
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
                  Upload tickets
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

      {/* ---- import: the working PDF/ticket path, unchanged in behaviour --- */}
      {showImport && (
        <BatchImportPanel
          tripId={trip.id}
          tripName={trip.title}
          onClose={() => setShowImport(false)}
          onChanged={handleChanged}
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
              Upload all the tickets and bookings for this trip at once — train, bus, flight, hotel. Wayvo reads
              each one and works out the order for you.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setShowImport(true)}>
                <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                Upload tickets / bookings
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
              Add more tickets
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowManual(true)}>
              <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
              Add journey
            </Button>
          </div>
        </div>
      )}

      {!user && null}
    </>
  )
}
