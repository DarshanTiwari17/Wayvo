/**
 * Digital twin state.
 *
 * Two small hooks, kept out of the page component:
 *
 *   `useTwinScenario`  — the traveller's what-if inputs, remembered between
 *                        visits so a scenario is not lost on a refresh.
 *   `useTripSegments`  — the real bookings behind the selected trip, with the
 *                        same honest loading / ready / error contract as
 *                        `useTravelData`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSegments } from '../../services/importService'
import {
  fetchCurrentWeather,
  type WeatherObservation,
  type WeatherLookup,
} from './weatherAdapter'
import type { JourneySegment } from '../../types/database'
import {
  DEFAULT_SCENARIO,
  DURATION_RANGE,
  LOCATIONS,
  TEMPERATURE_RANGE,
  WEATHER_INTENSITY_OPTIONS,
  type TwinScenario,
  type WeatherIntensity,
} from './digitalTwin'

const SCENARIO_STORAGE_PREFIX = 'wayvo:digital-twin:'

function isWeatherIntensity(value: unknown): value is WeatherIntensity {
  return WEATHER_INTENSITY_OPTIONS.some((option) => option.value === value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/** Repairs anything that is not a valid scenario rather than trusting storage. */
export function sanitiseScenario(value: unknown): TwinScenario {
  const raw = (value ?? {}) as Partial<TwinScenario>
  return {
    weatherIntensity: isWeatherIntensity(raw.weatherIntensity) ? raw.weatherIntensity : DEFAULT_SCENARIO.weatherIntensity,
    durationHours: clampNumber(raw.durationHours, DURATION_RANGE.min, DURATION_RANGE.max, DEFAULT_SCENARIO.durationHours),
    temperatureC: clampNumber(raw.temperatureC, TEMPERATURE_RANGE.min, TEMPERATURE_RANGE.max, DEFAULT_SCENARIO.temperatureC),
    location: typeof raw.location === 'string' && raw.location.trim() ? raw.location : DEFAULT_SCENARIO.location,
  }
}

function readStoredScenario(key: string): TwinScenario | null {
  try {
    const raw = window.localStorage.getItem(SCENARIO_STORAGE_PREFIX + key)
    if (!raw) return null
    return sanitiseScenario(JSON.parse(raw))
  } catch {
    // Private mode, disabled storage or corrupt JSON: fall back to the default
    // rather than leaving the page unusable.
    return null
  }
}

export function useTwinScenario(storageKey: string) {
  const [scenario, setScenario] = useState<TwinScenario>(() => readStoredScenario(storageKey) ?? DEFAULT_SCENARIO)

  // Keyed on the account so one traveller's storm scenario does not follow
  // another traveller onto the same machine.
  useEffect(() => {
    setScenario(readStoredScenario(storageKey) ?? DEFAULT_SCENARIO)
  }, [storageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(SCENARIO_STORAGE_PREFIX + storageKey, JSON.stringify(scenario))
    } catch {
      /* best-effort: the scenario simply will not survive a refresh */
    }
  }, [scenario, storageKey])

  const patch = useCallback((next: Partial<TwinScenario>) => {
    setScenario((current) => sanitiseScenario({ ...current, ...next }))
  }, [])

  const applyPreset = useCallback((preset: TwinScenario) => {
    setScenario(sanitiseScenario(preset))
  }, [])

  const reset = useCallback(() => {
    setScenario(DEFAULT_SCENARIO)
  }, [])

  const isDefault = useMemo(() => JSON.stringify(scenario) === JSON.stringify(DEFAULT_SCENARIO), [scenario])

  return { scenario, patch, applyPreset, reset, isDefault, locations: LOCATIONS }
}

/* ========================================================================== */

export type SegmentQueryState = {
  rows: JourneySegment[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}

/** The bookings behind the selected trip. `idle` until a trip is chosen. */
export function useTripSegments(tripId: string | null): SegmentQueryState {
  const [state, setState] = useState<SegmentQueryState>({ rows: [], status: 'idle', error: null })

  useEffect(() => {
    if (!tripId) {
      setState({ rows: [], status: 'idle', error: null })
      return
    }

    let active = true
    setState({ rows: [], status: 'loading', error: null })

    void fetchSegments(tripId)
      .then((rows) => {
        if (active) setState({ rows, status: 'ready', error: null })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setState({
          rows: [],
          status: 'error',
          error: cause instanceof Error ? cause.message : 'We could not load the bookings for this trip.',
        })
      })

    return () => {
      active = false
    }
  }, [tripId])

  return state
}

/* ========================================================================== */

export type LiveWeatherState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  observation: WeatherObservation | null
  error: string | null
  /** The place the last successful lookup was for. */
  place: string | null
}

/**
 * Live current conditions for a place.
 *
 * Re-runs only when the place changes, so a render elsewhere on the page can
 * never trigger a second request.
 */
export function useLiveWeather(query: WeatherLookup | null, enabled: boolean, refreshKey = 0): LiveWeatherState {
  const [state, setState] = useState<LiveWeatherState>({
    status: 'idle',
    observation: null,
    error: null,
    place: null,
  })
  const lastRefreshKey = useRef(refreshKey)

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', observation: null, error: null, place: null })
      return
    }

    if (!query || !query.place.trim()) {
      setState({ status: 'idle', observation: null, error: null, place: null })
      return
    }

    const place = query.place.trim()

    let active = true
    const controller = new AbortController()
    const forceRefresh = lastRefreshKey.current !== refreshKey
    lastRefreshKey.current = refreshKey
    setState((current) => ({ ...current, status: 'loading', error: null }))

    void fetchCurrentWeather(query, controller.signal, forceRefresh)
      .then((observation) => {
        if (active) setState({ status: 'ready', observation, error: null, place })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setState({
          status: 'error',
          observation: null,
          error: cause instanceof Error ? cause.message : 'Live weather could not be loaded.',
          place,
        })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [query, enabled, refreshKey])

  return state
}
