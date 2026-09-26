import { useEffect, useRef, useState } from 'react'
import { LocateFixed, MapPin, Navigation } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DeviceLocation, RecoveryCoordinate, RecoveryNavigationStep, RecoveryRouteGeometry } from '../../types/recoveryNavigation'

type RecoveryMapProps = {
  steps: RecoveryNavigationStep[]
  currentStep: number
  completedSteps: number[]
  routeGeometry?: RecoveryRouteGeometry
  currentLocation?: DeviceLocation | null
  onRecenter?: () => void
}

function toLatLng(point: RecoveryCoordinate): L.LatLngExpression {
  return [point.lat, point.lng]
}

export function RecoveryMap({ steps, currentStep: _currentStep, completedSteps: _completedSteps, routeGeometry, currentLocation, onRecenter }: RecoveryMapProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const routeLayer = useRef<L.Polyline | null>(null)
  const locationMarker = useRef<L.CircleMarker | null>(null)
  const destinationMarker = useRef<L.CircleMarker | null>(null)
  const [loading, setLoading] = useState(true)

  const fallbackPoints = steps.flatMap((step) => (step.origin && step.destination ? [step.origin, step.destination] : []))
  const points = routeGeometry?.points ?? fallbackPoints
  const destination = routeGeometry?.destination ?? points[points.length - 1]

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 250)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (loading || !mapElement.current || map.current || points.length < 2) return
    const instance = L.map(mapElement.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(instance)
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
  }, [loading, points.length])

  useEffect(() => {
    if (!map.current || points.length < 2) return
    routeLayer.current?.remove()
    routeLayer.current = L.polyline(points.map(toLatLng), {
      color: '#2f7661', weight: 6, opacity: 0.88, lineCap: 'round', lineJoin: 'round',
    }).addTo(map.current)

    destinationMarker.current?.remove()
    if (destination) {
      destinationMarker.current = L.circleMarker(toLatLng(destination), { radius: 8, color: '#17352c', fillColor: '#ffffff', fillOpacity: 1, weight: 3 })
        .bindTooltip('Destination', { direction: 'top', offset: [0, -8] })
        .addTo(map.current)
    }

    if (!currentLocation) map.current.fitBounds(routeLayer.current.getBounds(), { padding: [32, 32] })
  }, [currentLocation, destination, points])

  useEffect(() => {
    if (!map.current || !currentLocation) return
    locationMarker.current?.remove()
    locationMarker.current = L.circleMarker(toLatLng(currentLocation), { radius: 9, color: '#ffffff', fillColor: '#d18a36', fillOpacity: 1, weight: 3 })
      .bindTooltip(`You are here · accuracy ±${Math.round(currentLocation.accuracyMeters)} m`, { direction: 'top', offset: [0, -10] })
      .addTo(map.current)
  }, [currentLocation])

  if (loading) return <div className="grid min-h-[420px] place-items-center rounded-xl bg-app-surface-alt text-sm text-app-text-muted" role="status">Loading map...</div>
  if (points.length < 2) return <div className="grid min-h-[420px] place-items-center rounded-xl bg-app-surface-alt px-6 text-center text-sm text-app-text-muted" role="alert">No route available</div>

  return (
    <div className="relative overflow-hidden rounded-xl border border-app-border bg-app-surface-alt" aria-label={routeGeometry ? 'OpenRouteService route map' : 'Demo recovery route map'}>
      <div ref={mapElement} className="h-[420px] w-full" role="img" aria-label={routeGeometry ? 'Real route from your current location to the journey destination' : 'Illustrative recovery route'} />
      {currentLocation && <button type="button" onClick={() => { map.current?.setView(toLatLng(currentLocation), 15, { animate: true }); onRecenter?.() }} className="wva-btn wva-btn--secondary wva-btn--sm absolute right-4 top-4 z-[1000] bg-white/95 shadow-sm" aria-label="Recenter map on your current location">
        <LocateFixed size={15} aria-hidden="true" /> Recenter
      </button>}
      <div className="pointer-events-none absolute left-4 top-4 z-[1000] rounded-lg border border-app-border bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
        <p className="wva-eyebrow">{routeGeometry ? 'OpenRouteService route' : 'Demo route'}</p>
        <p className="mt-1 text-[12px] text-app-text-muted">{currentLocation ? `You are here · ±${Math.round(currentLocation.accuracyMeters)} m` : routeGeometry ? 'Based on your saved journey' : 'Illustrative navigation data'}</p>
      </div>
      <div className="absolute bottom-4 left-4 right-4 z-[1000] flex flex-wrap gap-3 rounded-lg border border-app-border bg-white/90 px-3 py-2 text-[12px] text-app-text-muted shadow-sm backdrop-blur-sm">
        <span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-app-accent" aria-hidden="true" /> {currentLocation ? 'You are here' : 'Origin'}</span>
        {!currentLocation && <span className="inline-flex items-center gap-1.5"><Navigation size={13} className="text-[#d18a36]" aria-hidden="true" /> Current</span>}
        <span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-app-text" aria-hidden="true" /> Destination</span>
        {routeGeometry?.distanceMeters !== undefined && <span className="ml-auto font-semibold text-app-text">Remaining {(routeGeometry.distanceMeters / 1000).toFixed(1)} km · {routeGeometry.durationMinutes ?? '—'} min</span>}
      </div>
    </div>
  )
}
