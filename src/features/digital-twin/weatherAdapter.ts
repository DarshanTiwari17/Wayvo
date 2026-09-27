import { clamp, type WeatherIntensity } from './digitalTwin'
import { fetchWeather } from '../../services/weatherService'

const RAIN_BANDS: Array<{ upTo: number; intensity: WeatherIntensity }> = [
  { upTo: 0.2, intensity: 'none' },
  { upTo: 2.4, intensity: 'light' },
  { upTo: 7.5, intensity: 'moderate' },
  { upTo: 25.5, intensity: 'heavy' },
]
const INTENSITY_ORDER: WeatherIntensity[] = ['none', 'light', 'moderate', 'heavy', 'extreme']

type RawWeather = {
  name?: string
  sys?: { country?: string }
  dt?: number
  main?: { temp?: number }
  weather?: Array<{ main?: string; description?: string; id?: number }>
  rain?: { '1h'?: number; '3h'?: number }
  snow?: { '1h'?: number; '3h'?: number }
  wind?: { speed?: number }
}

export type WeatherLookup = { kind: 'place'; place: string }

export type WeatherObservation = {
  place: string
  country: string | null
  temperatureC: number
  feelsLikeC: number
  humidityPercent: number
  description: string
  rainfallMm: number
  snowfallMm: number
  windKph: number
  windGustKph: number
  windDirectionDeg: number
  observedAt: string
  timezone: string
  intensity: WeatherIntensity
  provider: string
  latitude: number | null
  longitude: number | null
  nearbyArea: string | null
  forecastExposureHours: number
  nextHours: Array<{
    time: string
    temperatureC: number
    precipitationMm: number
    rainfallMm: number
    precipitationProbability: number
    windKph: number
    description: string
  }>
  basis: string
}

function intensityFromRate(rate: number): WeatherIntensity {
  for (const band of RAIN_BANDS) if (rate <= band.upTo) return band.intensity
  return 'extreme'
}

function increaseIntensity(intensity: WeatherIntensity, amount: number): WeatherIntensity {
  return INTENSITY_ORDER[clamp(INTENSITY_ORDER.indexOf(intensity) + amount, 0, INTENSITY_ORDER.length - 1)]
}

export function rainfallRate(rain?: RawWeather['rain']): { mm: number; basis: string } {
  const oneHour = rain?.['1h']
  if (typeof oneHour === 'number' && Number.isFinite(oneHour) && oneHour > 0) {
    return { mm: oneHour, basis: 'measured over the last hour' }
  }
  const threeHour = rain?.['3h']
  if (typeof threeHour === 'number' && Number.isFinite(threeHour) && threeHour > 0) {
    return { mm: threeHour / 3, basis: 'averaged from the last three hours' }
  }
  return { mm: 0, basis: 'no rainfall reported in the last three hours' }
}

export function classifyObservation(observation: RawWeather) {
  const rain = rainfallRate(observation.rain)
  const snowMm = observation.snow?.['1h'] ?? observation.snow?.['3h'] ?? 0
  const condition = observation.weather?.[0]
  const isThunderstorm = typeof condition?.id === 'number' && condition.id >= 200 && condition.id < 300
  const isDrizzle = typeof condition?.id === 'number' && condition.id >= 300 && condition.id < 400
  let intensity = intensityFromRate(rain.mm)
  const escalations: string[] = []

  if (isThunderstorm) {
    intensity = increaseIntensity(intensity, 2)
    escalations.push('thunderstorm reported, escalated two bands')
  } else if (isDrizzle) {
    intensity = increaseIntensity(intensity, 1)
    escalations.push('drizzle reported, escalated one band')
  }

  const temperatureC = clamp(Math.round(observation.main?.temp ?? 0), -80, 60)
  if (intensity !== 'none' && temperatureC <= 0) escalations.push('falling at or below 0°C, so icing applies')
  const basisParts = [`rain rate ${rain.mm.toFixed(1)} mm/h (${rain.basis})`]
  if (escalations.length) basisParts.push(escalations.join('; '))
  if (snowMm > 0) basisParts.push(`${snowMm} mm of snow reported`)

  return {
    place: observation.name?.trim() || 'Unknown location',
    country: observation.sys?.country?.trim() || null,
    temperatureC,
    description: condition?.description?.trim() || condition?.main?.trim() || 'No description reported',
    rainfallMm: Math.round(rain.mm * 10) / 10,
    snowfallMm: snowMm,
    windKph: Math.round((observation.wind?.speed ?? 0) * 3.6),
    observedAt: observation.dt ? new Date(observation.dt * 1000).toISOString() : new Date().toISOString(),
    intensity,
    basis: basisParts.join('. '),
  }
}

export function assumedExposureHours(intensity: WeatherIntensity, rainfallMm: number): number {
  switch (intensity) {
    case 'none': return 3
    case 'light': return rainfallMm >= 1 ? 4 : 2
    case 'moderate': return rainfallMm >= 5 ? 5 : 3
    case 'heavy': return rainfallMm >= 15 ? 6 : 4
    case 'extreme': return 6
  }
}

export async function fetchCurrentWeather(
  query: WeatherLookup,
  signal?: AbortSignal,
  _forceRefresh = false,
): Promise<WeatherObservation> {
  if (signal?.aborted) throw new Error('Weather lookup cancelled.')
  const data = await fetchWeather({ place: query.place.trim() })
  if (signal?.aborted) throw new Error('Weather lookup cancelled.')

  const classified = classifyObservation({
    name: data.location || query.place,
    sys: { country: data.country },
    dt: Math.floor(Date.parse(data.fetched_at) / 1000),
    main: { temp: data.temperature ?? 0 },
    weather: [{ main: data.weather_main, description: data.weather_description, id: data.weather_id ?? undefined }],
    rain: { '1h': data.rain_1h ?? undefined },
    snow: { '1h': data.snow_1h ?? undefined },
    wind: { speed: data.wind_speed ?? undefined },
  })
  const country = classified.country === 'IN' ? 'India' : classified.country
  const place = query.place.trim().toLowerCase() === 'goa' ? 'Goa' : classified.place
  const rainfallMm = classified.rainfallMm

  return {
    ...classified,
    place,
    country,
    feelsLikeC: Math.round(data.feels_like ?? classified.temperatureC),
    humidityPercent: Math.round(data.humidity ?? 0),
    windGustKph: 0,
    windDirectionDeg: Math.round(data.wind_deg ?? 0),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time',
    provider: 'Wayvo weather service',
    latitude: null,
    longitude: null,
    nearbyArea: null,
    forecastExposureHours: assumedExposureHours(classified.intensity, rainfallMm),
    nextHours: [],
    basis: `Current conditions from Wayvo's authenticated weather service. ${classified.basis} Exposure duration is an estimate; adjust the scenario if conditions are expected to last longer.`,
  }
}
