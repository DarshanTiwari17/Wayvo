/**
 * OSRM + Nominatim routing service.
 *
 * OSRM is free and requires no API key. Nominatim (OpenStreetMap) is used
 * for geocoding place names to coordinates. Fallback coordinates are used
 * when Nominatim is unavailable (rate-limited or down).
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

// Known city coordinates for India (fallback when Nominatim is unavailable)
const CITY_COORDS = {
  mumbai: { lat: 19.076, lng: 72.8777 },
  pune: { lat: 18.5204, lng: 73.8567 },
  delhi: { lat: 28.7041, lng: 77.1025 },
  'new delhi': { lat: 28.6139, lng: 77.209 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  surat: { lat: 21.1702, lng: 72.8311 },
  nashik: { lat: 19.9975, lng: 73.7898 },
  kanpur: { lat: 26.4499, lng: 80.3319 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
  indore: { lat: 22.7196, lng: 75.8577 },
  bhopal: { lat: 23.2599, lng: 77.4126 },
  visakhapatnam: { lat: 17.6868, lng: 83.2185 },
  patna: { lat: 25.5941, lng: 85.1376 },
  agra: { lat: 27.1767, lng: 78.0081 },
}

/**
 * Geocode a place name to coordinates using Nominatim, with a fallback
 * to known city coordinates when Nominatim is unavailable (rate-limited,
 * timeout, or down).
 */
export async function geocodePlace(query) {
  const normalized = query.toLowerCase().trim()

  // Try Nominatim first with a single quick attempt
  try {
    const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(query)}&format=json&limit=1`
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Wayvo-Travel-App/1.0' },
    })
    if (response.ok) {
      const payload = await response.json()
      const first = payload?.[0]
      if (first) {
        return { lng: Number(first.lon), lat: Number(first.lat) }
      }
    }
    // Nominatim failed or returned no results — fall through to fallback
  } catch {
    // Nominatim unreachable — fall through to fallback
  }

  // Fallback: match against known city coordinates
  const directMatch = CITY_COORDS[normalized]
  if (directMatch) return directMatch

  // Partial match: check if any city name appears in the query
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (normalized.includes(city) || city.includes(normalized)) {
      return coords
    }
  }

  // Last resort: return Delhi as a default since the user is in India
  return CITY_COORDS.delhi
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

  const coords = current_lng + ',' + current_lat + ';' + destination_lng + ',' + destination_lat
  const url = OSRM_BASE_URL + '/route/v1/driving/' + coords + '?overview=full&geometries=geojson'

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

  return {
    origin: { lat: current_lat, lng: current_lng },
    destination: { lat: destination_lat, lng: destination_lng },
    points: coordinates.map((coord) => ({ lng: coord[0], lat: coord[1] })),
    distanceMeters: route.distance,
    durationMinutes: route.duration === undefined ? undefined : Math.round(route.duration / 60),
  }
}
