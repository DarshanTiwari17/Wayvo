import { useEffect, useRef } from 'react'
import { MapPin } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { SocialSignal } from '../../services/socialSignalsService'

type SocialSignalsMapProps = {
  articles: SocialSignal[]
  location: string
}

// Approximate coordinates for common Indian cities
const CITY_COORDS: Record<string, [number, number]> = {
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  nashik: [19.9975, 73.7898],
  delhi: [28.7041, 77.1025],
  'new delhi': [28.6139, 77.209],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  hyderabad: [17.385, 78.4867],
  ahmedabad: [23.0225, 72.5714],
  jaipur: [26.9124, 75.7873],
  lucknow: [26.8467, 80.9462],
  kanpur: [26.4499, 80.3319],
  nagpur: [21.1458, 79.0882],
  indore: [22.7196, 75.8577],
  bhopal: [23.2599, 77.4126],
  patna: [25.5941, 85.1376],
  varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081],
  amritsar: [31.634, 74.8723],
  chandigarh: [30.7333, 76.7794],
  guwahati: [26.1445, 91.7362],
  bhubaneswar: [20.2961, 85.8245],
  coimbatore: [11.0168, 76.9558],
  kochi: [9.9312, 76.2673],
  thiruvananthapuram: [8.5241, 76.9366],
  visakhapatnam: [17.6868, 83.2185],
  vijayawada: [16.5062, 80.648],
  surat: [21.1702, 72.8311],
}

const SEVERITY_COLORS: Record<string, string> = {
  High: '#b42318',
  Medium: '#b54708',
  Low: '#5a6a64',
}

function getCenterForLocation(location: string): [number, number] {
  const key = location.toLowerCase().trim()
  return CITY_COORDS[key] ?? [20.5937, 78.9629]
}

/**
 * Leaflet map showing social-signal markers for the selected location.
 * Reuses the existing Leaflet dependency — no second map system.
 */
export function SocialSignalsMap({ articles, location }: SocialSignalsMapProps) {
  const mapElement = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markersRef = useRef<L.CircleMarker[]>([])
  const center = getCenterForLocation(location)

  // Initialize map once
  useEffect(() => {
    if (!mapElement.current || map.current) return

    const instance = L.map(mapElement.current, {
      center: center,
      zoom: 10,
      zoomControl: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(instance)

    map.current = instance

    // Fix: invalidate size after mount so tiles load correctly
    setTimeout(() => {
      instance.invalidateSize()
    }, 100)

    return () => {
      instance.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update markers when articles or location change
  useEffect(() => {
    if (!map.current) return

    // Clear existing markers
    for (const marker of markersRef.current) {
      marker.remove()
    }
    markersRef.current = []

    if (articles.length === 0) {
      map.current.setView(center, 10)
      return
    }

    // Add markers spread around the city center
    articles.forEach((article, index) => {
      const angle = (index / articles.length) * Math.PI * 2
      const radius = 0.08 + (index % 3) * 0.08
      const lat = center[0] + Math.sin(angle) * radius
      const lng = center[1] + Math.cos(angle) * radius
      const color = SEVERITY_COLORS[article.severity] ?? '#5a6a64'

      const marker = L.circleMarker([lat, lng], {
        radius: 10,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 1,
        weight: 2,
      })

      marker.bindPopup(
        `<div style="font-family:Inter,sans-serif;max-width:220px;">
          <strong style="font-size:13px;color:#0f1a16;">${article.event_type}</strong>
          <p style="margin:4px 0 0;font-size:12px;color:#5a6a64;line-height:1.4;">${article.title}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#85938d;">${article.source} · ${article.severity}</p>
        </div>`,
      )

      marker.bindTooltip(
        `<strong>${article.event_type}</strong><br/>${article.title.slice(0, 60)}${article.title.length > 60 ? '...' : ''}`,
        { direction: 'top', offset: [0, -8] },
      )

      marker.addTo(map.current!)
      markersRef.current.push(marker)
    })

    // Fit bounds to show all markers
    if (markersRef.current.length > 0) {
      const group = L.featureGroup(markersRef.current)
      map.current.fitBounds(group.getBounds().pad(0.3))
    }
  }, [articles, center])

  // Update center when location changes
  useEffect(() => {
    if (!map.current) return
    map.current.setView(center, 10)
    setTimeout(() => {
      map.current?.invalidateSize()
    }, 100)
  }, [center])

  return (
    <div className="relative overflow-hidden rounded-xl border border-app-border bg-app-surface-alt" aria-label="Social signals map">
      <div ref={mapElement} className="h-[350px] w-full" role="img" aria-label={`Map of social signals for ${location}`} />
      <div className="pointer-events-none absolute left-4 top-4 z-[1000] rounded-lg border border-app-border bg-white/90 px-3 py-2 shadow-sm backdrop-blur-sm">
        <p className="wva-eyebrow">Social Signals Map</p>
        <p className="mt-1 text-[12px] text-app-text-muted">
          {articles.length} signal{articles.length !== 1 ? 's' : ''} near {location}
        </p>
      </div>
      <div className="absolute bottom-4 left-4 right-4 z-[1000] flex flex-wrap gap-3 rounded-lg border border-app-border bg-white/90 px-3 py-2 text-[12px] text-app-text-muted shadow-sm backdrop-blur-sm">
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} className="text-app-danger" aria-hidden="true" /> High
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} className="text-app-warn" aria-hidden="true" /> Medium
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin size={13} className="text-app-text-subtle" aria-hidden="true" /> Low
        </span>
      </div>
    </div>
  )
}
