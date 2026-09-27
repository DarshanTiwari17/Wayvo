import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Navigation } from 'lucide-react'
import { RecoveryNavigation } from '../components/recovery/RecoveryNavigation'
import { Banner, Card, EmptyState, SkeletonLines } from '../components/app/Primitives'
import { useAuth } from '../hooks/useAuth'
import { useJourneys } from '../hooks/useTravelData'
import { formatRoute } from '../services/travelService'
import { fetchRoute } from '../services/navigationRouteService'
import { buildJourneyNavigationData } from '../lib/navigationJourney'
import type { RecoveryNavigationData } from '../types/recoveryNavigation'

export function RecoveryNavigationPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [routeData, setRouteData] = useState<RecoveryNavigationData | null>(null)
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [routeError, setRouteError] = useState<string | null>(null)
  const routeRequestInFlight = useRef(false)

  const selectedTrip = useMemo(
    () => journeys.rows.find((trip) => trip.id === selectedTripId) ?? journeys.rows.find((trip) => trip.origin?.trim() && trip.destination?.trim()) ?? journeys.rows[0],
    [journeys.rows, selectedTripId],
  )

  useEffect(() => {
    if (!selectedTrip) return
    setSelectedTripId((current) => current ?? selectedTrip.id)
    const base = buildJourneyNavigationData(selectedTrip, null)
    const canRoute = Boolean(selectedTrip.origin?.trim() && selectedTrip.destination?.trim())
    if (!canRoute) {
      setRouteData(base)
      setRouteStatus('error')
      setRouteError('Add an origin and destination to this journey to show its real route.')
      return
    }

    if (routeRequestInFlight.current) return

    let active = true
    routeRequestInFlight.current = true
    setRouteStatus('loading')
    setRouteError(null)
    const routeRequest = fetchRoute(selectedTrip.origin as string, selectedTrip.destination as string)
    void routeRequest
      .then((geometry) => {
        if (!active) return
        setRouteData({ ...base, routeGeometry: geometry, steps: [{ ...base.steps[0], mode: 'drive', distanceMeters: geometry.distanceMeters, durationMinutes: geometry.durationMinutes }] })
        setRouteStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setRouteData(base)
        setRouteStatus('error')
        setRouteError(cause instanceof Error ? cause.message : 'The real route could not be loaded.')
      })
      .finally(() => {
        routeRequestInFlight.current = false
      })
    return () => { active = false }
  }, [selectedTrip])

  const activeData = routeData ?? (selectedTrip ? buildJourneyNavigationData(selectedTrip, null) : null)

  return (
    <>
      <Card className="mb-6">
        <div className="flex flex-col gap-4">
          <div>
            <p className="wva-eyebrow">Journey options</p>
            <h2 className="wva-h2 mt-1">Choose a trip from Your trips</h2>
            <p className="wva-body mt-1">Select a journey to see its route on the map.</p>
          </div>
        </div>
        {journeys.status === 'loading' && <div className="mt-5"><SkeletonLines rows={2} /></div>}
        {journeys.status === 'error' && <div className="mt-5"><Banner tone="danger">We could not load your journeys. {journeys.error}</Banner></div>}
        {journeys.status === 'ready' && journeys.rows.length === 0 && <div className="mt-5"><EmptyState icon={<Navigation size={22} aria-hidden="true" />} title="No journeys to navigate" description="Add a trip and save its origin and destination first, then it will appear here as a route option." action={<Link to="/journeys?new=1" className="wva-btn wva-btn--primary">Add a trip</Link>} /></div>}
        {journeys.status === 'ready' && journeys.rows.length > 0 && <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {journeys.rows.map((trip) => <button key={trip.id} type="button" onClick={() => setSelectedTripId(trip.id)} className={`rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${selectedTrip?.id === trip.id ? 'border-app-accent bg-app-accent-soft' : 'border-app-border bg-app-surface hover:border-app-border-strong'}`} aria-pressed={selectedTrip?.id === trip.id}>
            <span className="block text-[14px] font-semibold text-app-text">{trip.title}</span>
            <span className="mt-1 block text-[12px] text-app-text-muted">{formatRoute(trip)}</span>
          </button>)}
        </div>}
        {routeStatus === 'loading' && <p className="wva-meta mt-4" role="status">Loading route...</p>}
        {routeStatus === 'error' && routeError && <p className="wva-meta mt-4 text-app-danger" role="alert">{routeError}</p>}
      </Card>
      {activeData && <RecoveryNavigation key={`${activeData.id}-${routeStatus}`} data={activeData} currentLocation={null} />}
    </>
  )
}
