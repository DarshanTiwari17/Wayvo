import { useCallback, useEffect, useRef, useState } from 'react'
import { Droplets, Eye, Gauge, Thermometer, Wind } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DeviceLocation, RecoveryCoordinate, RecoveryNavigationStep, RecoveryRouteGeometry } from '../../types/recoveryNavigation'
import { fetchWeather, WeatherError, type WeatherData } from '../../services/weatherService'
import { useAuth } from '../../hooks/useAuth'

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

function weatherIcon(id?: number): string {
  if (!id) return '🌤️'
  if (id >= 200 && id < 300) return '⛈️'
  if (id >= 300 && id < 600) return '🌧️'
  if (id >= 600 && id < 700) return '🌨️'
  if (id >= 700 && id < 800) return '🌫️'
  if (id === 800) return '☀️'
  return '☁️'
}

export function RecoveryMap({ steps, currentStep: _currentStep, completedSteps: _completedSteps, routeGeometry, currentLocation, onRecenter }: RecoveryMapProps) {
  const { session } = useAuth()
  const token = session?.access_token ?? ''
  const mapElement = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const routeLayer = useRef<L.Polyline | null>(null)
  const locationMarker = useRef<L.CircleMarker | null>(null)
  const originMarker = useRef<L.CircleMarker | null>(null)
  const destinationMarker = useRef<L.CircleMarker | null>(null)
  const [loading, setLoading] = useState(true)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const weatherFetchedFor = useRef<string>('')

  const origin = routeGeometry?.origin
  const destination = routeGeometry?.destination
  const fallbackOrigin = steps[0]?.origin
  const fallbackDestination = steps[steps.length - 1]?.destination
  const displayOrigin = origin ?? fallbackOrigin
  const displayDestination = destination ?? fallbackDestination

  const points = routeGeometry?.points ?? (displayOrigin && displayDestination ? [displayOrigin, displayDestination] : [])

  // Initialize map once
  useEffect(() => {
    if (!mapElement.current || map.current) return
    const instance = L.map(mapElement.current, { center: [20.5937, 78.9629], zoom: 5, zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(instance)
    map.current = instance
    const timer = setTimeout(() => { instance.invalidateSize(); setLoading(false) }, 300)
    return () => { clearTimeout(timer); instance.remove(); map.current = null }
  }, [])

  // Update route line and markers
  useEffect(() => {
    if (!map.current || points.length < 2) return
    routeLayer.current?.remove()
    routeLayer.current = L.polyline(points.map(toLatLng), { color: '#2f7661', weight: 6, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }).addTo(map.current)

    // Origin marker
    originMarker.current?.remove()
    if (displayOrigin) {
      originMarker.current = L.circleMarker(toLatLng(displayOrigin), { radius: 9, color: '#2f7661', fillColor: '#2f7661', fillOpacity: 1, weight: 3 })
        .bindTooltip('Origin', { direction: 'top', offset: [0, -8] }).addTo(map.current)
    }

    // Destination marker
    destinationMarker.current?.remove()
    if (displayDestination) {
      destinationMarker.current = L.circleMarker(toLatLng(displayDestination), { radius: 9, color: '#d18a36', fillColor: '#ffffff', fillOpacity: 1, weight: 3 })
        .bindTooltip('Destination', { direction: 'top', offset: [0, -8] }).addTo(map.current)
    }

    if (points.length >= 2) {
      map.current.fitBounds(routeLayer.current.getBounds(), { padding: [32, 32] })
    }

    // Reset weather cache when route changes
    weatherFetchedFor.current = ''
    setWeather(null)
    setWeatherError(null)
  }, [points, displayOrigin, displayDestination])

  // Update current location marker
  useEffect(() => {
    if (!map.current || !currentLocation) return
    locationMarker.current?.remove()
    locationMarker.current = L.circleMarker(toLatLng(currentLocation), { radius: 9, color: '#ffffff', fillColor: '#d18a36', fillOpacity: 1, weight: 3 })
      .bindTooltip('You are here', { direction: 'top', offset: [0, -10] }).addTo(map.current)
  }, [currentLocation])

  // Weather target changes with origin or destination
  const weatherTarget = currentLocation ?? displayOrigin ?? displayDestination ?? points[0]

  // Fetch weather for the map location (keyed by coordinates to refresh on route change)
  const loadWeather = useCallback(async () => {
    if (!weatherTarget || !token) return
    const key = `${weatherTarget.lat.toFixed(2)},${weatherTarget.lng.toFixed(2)}`
    if (key === weatherFetchedFor.current && weather) return
    weatherFetchedFor.current = key
    setWeatherLoading(true)
    setWeatherError(null)
    try {
      const result = await fetchWeather({ lat: weatherTarget.lat, lng: weatherTarget.lng })
      setWeather(result)
    } catch (error) {
      setWeatherError(error instanceof WeatherError ? error.message : 'Could not load weather.')
    } finally {
      setWeatherLoading(false)
    }
  }, [weatherTarget, token, weather])

  useEffect(() => { void loadWeather() }, [loadWeather])

  return (
    <div className="relative overflow-hidden rounded-xl border border-app-border bg-app-surface-alt" aria-label="Route map">
      <div ref={mapElement} className="h-[420px] w-full" role="img" aria-label="Journey route map" />

      {loading && <div className="absolute inset-0 z-[1000] grid place-items-center bg-app-surface-alt"><p className="text-sm text-app-text-muted" role="status">Loading map...</p></div>}

      {/* Weather overlay card */}
      {(weather || weatherLoading) && (
        <div className="absolute left-4 top-4 z-[1001] w-[230px] rounded-xl border border-app-border bg-white/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <p className="wva-eyebrow">Weather</p>
            {weatherLoading && <span className="wva-meta animate-pulse">Updating...</span>}
          </div>
          {weather && (
            <>
              <p className="mt-0.5 wva-meta capitalize text-[12px] text-app-text-muted">{weather.location}{weather.country ? `, ${weather.country}` : ''}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-2xl" aria-hidden="true">{weatherIcon(weather.weather_id ?? undefined)}</span>
                <div>
                  <p className="text-[15px] font-semibold leading-none text-app-text">{weather.temperature !== null ? `${Math.round(weather.temperature)}°C` : '—'}</p>
                  <p className="wva-meta mt-0.5 capitalize">{weather.weather_description}</p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-app-border pt-2 text-[11px] text-app-text-muted">
                <span className="flex items-center gap-1"><Thermometer size={11} aria-hidden="true" /> Feels {weather.feels_like !== null ? `${Math.round(weather.feels_like)}°` : '—'}</span>
                <span className="flex items-center gap-1"><Droplets size={11} aria-hidden="true" /> Humidity {weather.humidity ?? '—'}%</span>
                <span className="flex items-center gap-1"><Wind size={11} aria-hidden="true" /> Wind {weather.wind_speed ?? '—'} m/s</span>
                <span className="flex items-center gap-1"><Gauge size={11} aria-hidden="true" /> Pressure {weather.pressure ?? '—'} hPa</span>
                {weather.rain_1h != null && <span className="flex items-center gap-1"><Droplets size={11} aria-hidden="true" /> Rain {weather.rain_1h} mm/h</span>}
                {weather.visibility != null && <span className="flex items-center gap-1"><Eye size={11} aria-hidden="true" /> Vis {((weather.visibility ?? 0) / 1000).toFixed(1)} km</span>}
              </div>
            </>
          )}
          {weatherError && <p className="mt-1 text-[11px] text-app-danger">{weatherError}</p>}
        </div>
      )}

      {currentLocation && <button type="button" onClick={() => { map.current?.setView(toLatLng(currentLocation), 15, { animate: true }); onRecenter?.() }} className="wva-btn wva-btn--secondary wva-btn--sm absolute right-4 top-4 z-[1002] bg-white/95 shadow-sm" aria-label="Recenter map"><span className="text-[12px]">Recenter</span></button>}

      <div className="absolute bottom-4 left-4 right-4 z-[1001] flex flex-wrap gap-3 rounded-lg border border-app-border bg-white/90 px-3 py-2 text-[12px] text-app-text-muted shadow-sm backdrop-blur-sm">
        <span className="inline-flex items-center gap-1.5"><span className="text-app-accent" aria-hidden="true">📍</span> Origin</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-[#d18a36]" aria-hidden="true">📍</span> Route</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true">📍</span> Destination</span>
        {routeGeometry?.distanceMeters !== undefined && <span className="ml-auto font-semibold text-app-text">{(routeGeometry.distanceMeters / 1000).toFixed(1)} km · {routeGeometry.durationMinutes ?? '—'} min</span>}
      </div>
    </div>
  )
}
