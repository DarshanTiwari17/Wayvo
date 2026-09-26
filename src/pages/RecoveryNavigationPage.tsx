import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Navigation, ShieldCheck } from 'lucide-react'
import { MOCK_RECOVERY_NAVIGATION } from '../data/recoveryNavigationMock'
import { RecoveryNavigation } from '../components/recovery/RecoveryNavigation'
import { Banner, Button, Card, EmptyState, SkeletonLines } from '../components/app/Primitives'
import { useAuth } from '../hooks/useAuth'
import { useDeviceLocation } from '../hooks/useDeviceLocation'
import { useJourneys } from '../hooks/useTravelData'
import { formatRoute } from '../services/travelService'
import { fetchRoute, fetchRouteFromCoordinate } from '../services/navigationRouteService'
import { buildJourneyNavigationData } from '../lib/navigationJourney'
import type { NavigationJourneyKind, RecoveryCoordinate, RecoveryNavigationData } from '../types/recoveryNavigation'

export function RecoveryNavigationPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const [activeKind, setActiveKind] = useState<NavigationJourneyKind>('journey')
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [routeData, setRouteData] = useState<RecoveryNavigationData | null>(null)
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [routeError, setRouteError] = useState<string | null>(null)
  const [currentLocation, setCurrentLocation] = useState<RecoveryCoordinate | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)
  const lastRoutedLocation = useRef<RecoveryCoordinate | null>(null)
  const routeRequestInFlight = useRef(false)
  const { location: deviceLocation, status: deviceStatus, message: deviceMessage } = useDeviceLocation(isTracking && activeKind === 'journey')

  const selectedTrip = useMemo(
    () => journeys.rows.find((trip) => trip.id === selectedTripId) ?? journeys.rows.find((trip) => trip.origin?.trim() && trip.destination?.trim()) ?? journeys.rows[0],
    [journeys.rows, selectedTripId],
  )

  useEffect(() => {
    if (activeKind !== 'journey' || !selectedTrip) return
    setSelectedTripId((current) => current ?? selectedTrip.id)
    const base = buildJourneyNavigationData(selectedTrip, deviceLocation)
    const canRoute = Boolean((deviceLocation || selectedTrip.origin?.trim()) && selectedTrip.destination?.trim())
    if (!canRoute) {
      setRouteData(base)
      setRouteStatus('error')
      setRouteError('Add an origin and destination to this journey to show its real route.')
      return
    }

    const routePoints = routeData?.routeGeometry?.points ?? []
    const hasMovedEnough = deviceLocation && (!lastRoutedLocation.current || distanceBetween(lastRoutedLocation.current, deviceLocation) >= 150)
    const hasDeviated = deviceLocation && routePoints.length > 1 && distanceToRoute(deviceLocation, routePoints) >= 100
    if (routeRequestInFlight.current || (routeData?.routeGeometry && !hasMovedEnough && !hasDeviated)) return

    let active = true
    routeRequestInFlight.current = true
    setRouteStatus('loading')
    setRouteError(null)
    const routeRequest = deviceLocation
      ? fetchRouteFromCoordinate(deviceLocation, selectedTrip.destination as string)
      : fetchRoute(selectedTrip.origin as string, selectedTrip.destination as string)
    void routeRequest
      .then((geometry) => {
        if (!active) return
        lastRoutedLocation.current = deviceLocation ?? null
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
  }, [activeKind, deviceLocation, selectedTrip])

  useEffect(() => {
    if (!deviceLocation) return
    setCurrentLocation(deviceLocation)
    setLocationAccuracy(deviceLocation.accuracyMeters)
    setLocationStatus('ready')
    setLocationMessage(null)
  }, [deviceLocation])

  useEffect(() => {
    if (deviceStatus === 'watching') {
      setLocationStatus('ready')
      setLocationMessage(null)
    } else if (deviceStatus !== 'idle') {
      setLocationStatus('error')
      setLocationMessage(deviceMessage)
    }
  }, [deviceMessage, deviceStatus])

  function toggleCurrentLocation() {
    setIsTracking((tracking) => !tracking)
    if (isTracking) {
      setLocationStatus('idle')
      setLocationMessage(null)
    } else {
      setLocationStatus('loading')
      setLocationMessage('Requesting live location permission...')
    }
  }

  const activeData = activeKind === 'recovery' ? MOCK_RECOVERY_NAVIGATION : routeData ?? (selectedTrip ? buildJourneyNavigationData(selectedTrip, deviceLocation) : null)

  return (
    <>
      <div className="mb-6 rounded-xl border border-app-border bg-app-surface-alt p-1.5 sm:flex sm:items-center sm:justify-between">
        <div className="px-3 py-2">
          <p className="text-[13px] font-semibold text-app-text">Choose what you want to navigate</p>
          <p className="wva-meta mt-0.5">Follow your planned journey or the route created after a disruption.</p>
        </div>
        <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Navigation type">
          <button type="button" role="tab" aria-selected={activeKind === 'journey'} className={`wva-btn wva-btn--sm ${activeKind === 'journey' ? 'wva-btn--primary' : 'wva-btn--ghost'}`} onClick={() => setActiveKind('journey')}>
            <Navigation size={15} aria-hidden="true" /> My journey
          </button>
          <button type="button" role="tab" aria-selected={activeKind === 'recovery'} className={`wva-btn wva-btn--sm ${activeKind === 'recovery' ? 'wva-btn--primary' : 'wva-btn--ghost'}`} onClick={() => setActiveKind('recovery')}>
            <ShieldCheck size={15} aria-hidden="true" /> Recovery session
          </button>
        </div>
      </div>
      {activeKind === 'journey' && (
        <Card className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="wva-eyebrow">Journey options</p>
              <h2 className="wva-h2 mt-1">Choose a trip from Your trips</h2>
              <p className="wva-body mt-1">Use your laptop location as the start, then route to the journey destination.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={isTracking ? 'primary' : 'secondary'} size="sm" onClick={toggleCurrentLocation} disabled={locationStatus === 'loading'}>
                <Navigation size={15} aria-hidden="true" /> {locationStatus === 'loading' ? 'Locating you...' : isTracking ? 'Live location on' : 'Use my location'}
              </Button>
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
          {routeStatus === 'loading' && <p className="wva-meta mt-4" role="status">Loading real route from OpenRouteService...</p>}
          {locationStatus === 'ready' && currentLocation && <p className="wva-meta mt-4 text-app-accent" role="status">Live laptop location captured. Accuracy ±{Math.round(locationAccuracy ?? 0)} m. Route updates after 150 m movement or a significant deviation.</p>}
          {locationMessage && <p className="wva-meta mt-4 text-app-danger" role="alert">{locationMessage}</p>}
          {routeStatus === 'error' && routeError && <p className="wva-meta mt-4 text-app-danger" role="alert">{routeError}</p>}
        </Card>
      )}
      {activeData && <RecoveryNavigation key={`${activeData.id}-${routeStatus}`} data={activeData} currentLocation={activeKind === 'journey' ? deviceLocation : null} />}
    </>
  )
}

function distanceBetween(first: RecoveryCoordinate, second: RecoveryCoordinate) {
  const earthRadius = 6371000
  const latitudeDelta = (second.lat - first.lat) * Math.PI / 180
  const longitudeDelta = (second.lng - first.lng) * Math.PI / 180
  const latitude = first.lat * Math.PI / 180
  const otherLatitude = second.lat * Math.PI / 180
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitude) * Math.cos(otherLatitude)
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function distanceToRoute(location: RecoveryCoordinate, points: RecoveryCoordinate[]) {
  return points.reduce((closest, point) => Math.min(closest, distanceBetween(location, point)), Number.POSITIVE_INFINITY)
}