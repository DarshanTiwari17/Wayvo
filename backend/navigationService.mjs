const ORS_BASE_URL = 'https://api.openrouteservice.org'

function isCoordinate(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export async function geocodePlace(query, apiKey) {
  const response = await fetch(`${ORS_BASE_URL}/geocode/search?api_key=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(query)}&size=1`)
  if (!response.ok) throw new Error('OpenRouteService could not find that place.')

  const payload = await response.json()
  const coordinates = payload.features?.[0]?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error(`No map location found for ${query}.`)
  return { lng: coordinates[0], lat: coordinates[1] }
}

export async function calculateRoute({ current_lat, current_lng, destination_lat, destination_lng, profile }, apiKey) {
  if (!isCoordinate(current_lat, -90, 90) || !isCoordinate(destination_lat, -90, 90) || !isCoordinate(current_lng, -180, 180) || !isCoordinate(destination_lng, -180, 180)) {
    const error = new Error('Invalid navigation coordinates.')
    error.statusCode = 400
    throw error
  }

  const routeProfile = profile === 'foot-walking' ? 'foot-walking' : 'driving-car'
  const response = await fetch(`${ORS_BASE_URL}/v2/directions/${routeProfile}/geojson`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: [[current_lng, current_lat], [destination_lng, destination_lat]] }),
  })
  if (!response.ok) throw new Error('OpenRouteService could not calculate this route.')

  const payload = await response.json()
  const feature = payload.features?.[0]
  const coordinates = feature?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('OpenRouteService returned no usable route.')

  return {
    origin: { lat: current_lat, lng: current_lng },
    destination: { lat: destination_lat, lng: destination_lng },
    points: coordinates.map(([lng, lat]) => ({ lng, lat })),
    distanceMeters: feature.properties?.summary?.distance,
    durationMinutes: feature.properties?.summary?.duration === undefined ? undefined : Math.round(feature.properties.summary.duration / 60),
  }
}