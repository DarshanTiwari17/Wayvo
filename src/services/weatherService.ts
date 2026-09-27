/**
 * Weather API client.
 *
 * Talks to the backend weather endpoint. The WEATHER_API_KEY never reaches
 * the browser — it lives only in the backend environment.
 */

import { getSupabase } from '../lib/supabase'

const API_BASE = '/api/weather'

export interface WeatherData {
  location: string
  country: string
  temperature: number | null
  feels_like: number | null
  humidity: number | null
  pressure: number | null
  wind_speed: number | null
  wind_deg: number | null
  clouds: number | null
  rain_1h: number | null
  snow_1h: number | null
  weather_id: number | null
  weather_main: string
  weather_description: string
  weather_icon: string
  visibility: number | null
  sunrise: number | null
  sunset: number | null
  fetched_at: string
}

export class WeatherError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode = 0) {
    super(message)
    this.name = 'WeatherError'
    this.statusCode = statusCode
  }
}

export async function fetchWeather(params: { lat?: number; lng?: number; place?: string }): Promise<WeatherData> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new WeatherError('Your session has expired. Please sign in again.')

  const search = new URLSearchParams()
  if (params.lat !== undefined && params.lng !== undefined) {
    search.set('lat', String(params.lat))
    search.set('lng', String(params.lng))
  } else if (params.place) {
    search.set('place', params.place)
  }

  const response = await fetch(`${API_BASE}?${search}`, {
    headers: { authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = await response.json()
      if (body.error) message = body.error
    } catch {
      // ignore JSON parse errors
    }
    throw new WeatherError(message, response.status)
  }

  return response.json() as Promise<WeatherData>
}
