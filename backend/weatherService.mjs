/**
 * Weather API integration using OpenWeatherMap.
 *
 * Reads WEATHER_API_KEY from the environment. Never exposes the key in responses.
 * Implements caching to avoid excessive API calls.
 */

const WEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const REQUEST_TIMEOUT_MS = 8_000

// Simple in-memory cache
const cache = new Map()

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/**
 * Fetch current weather for a location.
 * Accepts either lat/lng coordinates or a place name.
 *
 * @param {object} params
 * @param {number} [params.lat]
 * @param {number} [params.lng]
 * @param {string} [params.place] - e.g. "Mumbai"
 * @returns {Promise<object>}
 */
export async function fetchWeather({ lat, lng, place }) {
  const apiKey = process.env.WEATHER_API_KEY
  if (!apiKey) {
    throw Object.assign(new Error('WEATHER_API_KEY is missing from the backend environment.'), { statusCode: 500 })
  }

  const cacheKey = place ? `place:${place}` : `coord:${lat},${lng}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({ appid: apiKey, units: 'metric' })
  if (lat !== undefined && lng !== undefined) {
    params.set('lat', String(lat))
    params.set('lon', String(lng))
  } else if (place) {
    params.set('q', place)
  } else {
    throw Object.assign(new Error('Provide either lat/lng or a place name.'), { statusCode: 400 })
  }

  const url = `${WEATHER_BASE_URL}?${params}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('Weather API request timed out.'), { statusCode: 504 })
    }
    throw Object.assign(new Error('Could not reach the weather service.'), { statusCode: 502 })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw Object.assign(new Error('Weather data not found for this location.'), { statusCode: 404 })
    }
    throw Object.assign(new Error(`Weather API returned status ${response.status}.`), { statusCode: 502 })
  }

  const data = await response.json()

  // Normalize the response
  const result = {
    location: data.name || place || `${lat},${lng}`,
    country: data.sys?.country || '',
    temperature: data.main?.temp ?? null,
    feels_like: data.main?.feels_like ?? null,
    humidity: data.main?.humidity ?? null,
    pressure: data.main?.pressure ?? null,
    wind_speed: data.wind?.speed ?? null,
    wind_deg: data.wind?.deg ?? null,
    clouds: data.clouds?.all ?? null,
    rain_1h: data.rain?.['1h'] ?? null,
    snow_1h: data.snow?.['1h'] ?? null,
    weather_id: data.weather?.[0]?.id ?? null,
    weather_main: data.weather?.[0]?.main || 'Unknown',
    weather_description: data.weather?.[0]?.description || '',
    weather_icon: data.weather?.[0]?.icon || '',
    visibility: data.visibility ?? null,
    sunrise: data.sys?.sunrise ?? null,
    sunset: data.sys?.sunset ?? null,
    fetched_at: new Date().toISOString(),
  }

  cacheSet(cacheKey, result)
  return result
}
