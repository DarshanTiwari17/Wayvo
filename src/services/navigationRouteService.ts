import type { RecoveryCoordinate, RecoveryRouteGeometry } from '../types/recoveryNavigation'
import { getSupabase } from '../lib/supabase'

const API_BASE = import.meta.env.VITE_NAVIGATION_API_URL ?? '/api/navigation'

async function navigationRequest<T>(path: string, body: unknown): Promise<T> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session has expired. Please sign in again.')
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) throw new Error(payload?.error || `Navigation backend returned ${response.status}.`)
  return payload as T
}

export async function geocodePlace(place: string): Promise<RecoveryCoordinate> {
  return (await navigationRequest<{ coordinates: RecoveryCoordinate }>('/geocode', { query: place })).coordinates
}

export async function fetchRoute(origin: string, destination: string, profile: 'driving-car' | 'foot-walking' = 'driving-car'): Promise<RecoveryRouteGeometry> {
  const [from, to] = await Promise.all([geocodePlace(origin), geocodePlace(destination)])
  return fetchRouteCoordinates(from, to, profile)
}

export async function fetchRouteFromCoordinate(origin: RecoveryCoordinate, destination: string, profile: 'driving-car' | 'foot-walking' = 'driving-car'): Promise<RecoveryRouteGeometry> {
  const to = await geocodePlace(destination)
  return fetchRouteCoordinates(origin, to, profile)
}

async function fetchRouteCoordinates(origin: RecoveryCoordinate, destination: RecoveryCoordinate, profile: 'driving-car' | 'foot-walking'): Promise<RecoveryRouteGeometry> {
  return navigationRequest<RecoveryRouteGeometry>('/route', {
    current_lat: origin.lat,
    current_lng: origin.lng,
    destination_lat: destination.lat,
    destination_lng: destination.lng,
    profile,
  })
}