/**
 * OSRM + Nominatim routing service.
 *
 * OSRM is free and requires no API key. Nominatim (OpenStreetMap) is used
 * for geocoding place names to coordinates.
 */

const OSRM_BASE_URL = 'https://router.project-osrm.org'
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'
const REQUEST_TIMEOUT_MS = 10_000

function isCoordinate(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('The geocoding service timed out. Please try again.'), { statusCode: 504 })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Geocode a place name to coordinates using Nominatim.
 */
export async function geocodePlace(query) {
  const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&limit=1`
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Wayvo-Travel-App/1.0' },
  })
  if (!response.ok) throw new Error('Geocoding service could not find that place.')

  const payload = await response.json()
  const first = payload?.[0]
  if (!first) throw new Error(`No map location found for "${query}". Check the place name and try again.`)

  return { lng: Number(first.lon), lat: Number(first.lat) }
}

/**
 * Calculate a driving route between two coordinates using OSRM.
 */
export async function calculateRoute({ current_lat, current_lng, destination_lat, destination_lng, profile }) {
  if (!isCoordinate(current_lat, -90, 90) || !isCoordinate(destination_lat, -90, 90) || !isCoordinate(current_lng, -180, 180) || !isCoordinate(destination_lng, -180, 180)) {
    const error = new Error('Invalid navigation coordinates.')
    error.statusCode = 400
    throw error
  }

  const coords = `${current_lng},${current_lat};${destination_lng},${destination_lat}`
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`

  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error('OSRM could not calculate this route.')

  const payload = await response.json()
  if (payload.code !== 'Ok' || !payload.routes?.length) {
    throw new Error('OSRM returned no usable route.')
  }

  const route = payload.routes[0]
  const geometry = route.geometry
  const coordinates = geometry?.coordinates

  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('OSRM returned no usable route.')
  }

  // OSRM returns [lng, lat] — convert to { lat, lng } for the app
  return {
    origin: { lat: current_lat, lng: current_lng },
    destination: { lat: destination_lat, lng: destination_lng },
    points: coordinates.map(([lng, lat]) => ({ lng, lat })),
    distanceMeters: route.distance,
    durationMinutes: route.duration === undefined ? undefined : Math.round(route.duration / 60),
  }
}
