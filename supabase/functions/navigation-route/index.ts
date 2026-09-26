import { corsHeaders, json } from '../_shared/gmail.ts'

type Profile = 'driving-car' | 'foot-walking'

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function routeHeaders(request: Request) {
  return corsHeaders(request.headers.get('origin'), {
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    ALLOWED_REDIRECT_ORIGINS: Deno.env.get('ALLOWED_REDIRECT_ORIGINS') ?? '',
  })
}

Deno.serve(async (request) => {
  const headers = routeHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers)

  const auth = request.headers.get('Authorization') ?? ''
  const jwt = auth.replace('Bearer ', '').trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const orsKey = Deno.env.get('OPENROUTESERVICE_API_KEY') ?? ''
  if (!jwt || !supabaseUrl || !anonKey || !orsKey) return json({ error: 'Navigation service is not configured.' }, 500, headers)

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization: `Bearer ${jwt}`, apikey: anonKey } })
  if (!userResponse.ok) return json({ error: 'Unauthorised' }, 401, headers)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = body?.action
  if (action === 'geocode') {
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) return json({ error: 'A place is required.' }, 400, headers)
    const response = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(orsKey)}&text=${encodeURIComponent(query)}&size=1`)
    if (!response.ok) return json({ error: 'OpenRouteService could not find that place.' }, 502, headers)
    const payload = (await response.json()) as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
    const coordinates = payload.features?.[0]?.geometry?.coordinates
    if (!coordinates) return json({ error: `No map location found for ${query}.` }, 404, headers)
    return json({ coordinates: { lng: coordinates[0], lat: coordinates[1] } }, 200, headers)
  }

  if (action !== 'route') return json({ error: 'Unknown navigation action.' }, 400, headers)
  const currentLat = body.current_lat
  const currentLng = body.current_lng
  const destinationLat = body.destination_lat
  const destinationLng = body.destination_lng
  const profile: Profile = body.profile === 'foot-walking' ? 'foot-walking' : 'driving-car'
  if (!validCoordinate(currentLat, -90, 90) || !validCoordinate(destinationLat, -90, 90) || !validCoordinate(currentLng, -180, 180) || !validCoordinate(destinationLng, -180, 180)) {
    return json({ error: 'Invalid navigation coordinates.' }, 400, headers)
  }

  const orsResponse = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: { authorization: orsKey, 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: [[currentLng, currentLat], [destinationLng, destinationLat]] }),
  })
  if (!orsResponse.ok) return json({ error: 'OpenRouteService could not calculate this route.' }, 502, headers)
  const payload = (await orsResponse.json()) as { features?: Array<{ geometry?: { coordinates?: Array<[number, number]> }; properties?: { summary?: { distance?: number; duration?: number } } }> }
  const feature = payload.features?.[0]
  const coordinates = feature?.geometry?.coordinates
  if (!coordinates || coordinates.length < 2) return json({ error: 'OpenRouteService returned no usable route.' }, 502, headers)
  return json({
    origin: { lat: currentLat, lng: currentLng },
    destination: { lat: destinationLat, lng: destinationLng },
    points: coordinates.map(([lng, lat]) => ({ lng, lat })),
    distanceMeters: feature.properties?.summary?.distance,
    durationMinutes: feature.properties?.summary?.duration === undefined ? undefined : Math.round(feature.properties.summary.duration / 60),
  }, 200, headers)
})