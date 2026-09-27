/**
 * Live conditions as a starting point for the twin.
 *
 * The traveller can start from what the sky is actually doing where their
 * trip begins, instead of guessing. Applying a reading only sets the four
 * scenario inputs — the simulation stays the same pure local model, so a
 * live-fed scenario is exactly as reproducible as a hand-built one.
 *
 * Everything the provider says is shown, including the assumptions, because a
 * weather reading the traveller cannot audit is not much better than one the
 * app invented.
 */
import { useState } from 'react'
import { CloudSun, MapPin, RefreshCw, TriangleAlert, Wind } from 'lucide-react'
import { Button, Pill } from '../../components/app/Primitives'
import type { WeatherLookup, WeatherObservation } from './weatherAdapter'
import { weatherIntensityLabel, type WeatherIntensity, type TwinScenario } from './digitalTwin'
import type { LiveWeatherState } from './useDigitalTwin'

export type LiveWeatherPanelProps = {
  live: LiveWeatherState
  /** The place that will be looked up — the trip origin when there is one. */
  query: string | null
  canAutoQuery: boolean
  onQuery: (query: WeatherLookup) => void
  onApply: (scenario: Partial<TwinScenario>) => void
  onRefresh: () => void
}

export function LiveWeatherPanel({ live, query, canAutoQuery, onQuery, onApply, onRefresh }: LiveWeatherPanelProps) {
  const [manualPlace, setManualPlace] = useState('')
  const observation = live.observation

  return (
    <div className="wva-digital-live">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-app-text">Start from real conditions</p>
          <p className="wva-body mt-1">
            Search a place for current weather, then apply the observed conditions to the scenario.
          </p>
        </div>
        {canAutoQuery && query && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onQuery({ kind: 'place', place: query })}
            pending={live.status === 'loading'}
            pendingLabel="Looking up…"
          >
            <MapPin size={14} strokeWidth={2.2} aria-hidden="true" />
            {live.status === 'loading' ? 'Looking up' : `Look up ${query}`}
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <form
          className="flex min-w-[min(100%,280px)] flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (manualPlace.trim()) onQuery({ kind: 'place', place: manualPlace.trim() })
          }}
        >
          <label className="sr-only" htmlFor="digital-twin-live-place">
            Place name
          </label>
          <input
            id="digital-twin-live-place"
            className="wva-input flex-1 min-w-[160px]"
            placeholder="City or place name"
            value={manualPlace}
            onChange={(event) => setManualPlace(event.target.value)}
            disabled={live.status === 'loading'}
          />
          <Button type="submit" variant="secondary" size="sm" disabled={live.status === 'loading' || !manualPlace.trim()}>
            <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
            Look up
          </Button>
        </form>
      </div>

      {live.status === 'loading' && (
        <p className="wva-meta mt-3 text-app-text-muted" role="status">
          Reading current conditions for {live.place ?? query}…
        </p>
      )}

      {live.status === 'error' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2" role="alert">
          <p className="wva-body inline-flex items-start gap-1.5 text-app-danger">
            <TriangleAlert size={14} strokeWidth={2.1} className="mt-0.5 shrink-0" aria-hidden="true" />
            {live.error} The scenario above is unchanged.
          </p>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {live.status === 'ready' && observation && (
        <Observation
          observation={observation}
          onRefresh={onRefresh}
          onApply={() => onApply({
            weatherIntensity: observation.intensity,
            temperatureC: observation.temperatureC,
            durationHours: observation.forecastExposureHours,
            location: observation.place,
          })}
        />
      )}
    </div>
  )
}

/** Keep the provider's precipitation distinct from the twin's scenario intensity. */
function readingPhrase(intensity: WeatherIntensity): string {
  return intensity === 'none' ? 'No precipitation' : `${weatherIntensityLabel(intensity)} scenario`
}

function Observation({ observation, onApply, onRefresh }: { observation: WeatherObservation; onApply: () => void; onRefresh: () => void }) {
  const observedTime = new Date(observation.observedAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: observation.timezone,
  })

  return (
    <div className="mt-3 rounded-lg border border-app-border bg-app-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <CloudSun size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-app-info" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold capitalize text-app-text">
              {observation.place}
              {observation.country ? `, ${observation.country}` : ''} — {observation.description}
            </p>
            {observation.nearbyArea && observation.nearbyArea.toLowerCase() !== observation.place.toLowerCase() && (
              <p className="wva-meta mt-0.5">Regional conditions from nearby report: {observation.nearbyArea}</p>
            )}
            <p className="wva-meta mt-0.5 text-app-text-muted">
              {observation.temperatureC}°C · feels like {observation.feelsLikeC}°C · {observation.humidityPercent}% humidity ·{' '}
              {observation.rainfallMm} mm precipitation ·{' '}
              <span className="inline-flex items-center gap-1">
                <Wind size={11} strokeWidth={2.1} aria-hidden="true" />
                {observation.windKph} km/h, gusts {observation.windGustKph} km/h
              </span>
            </p>
            <p className="wva-meta mt-1">
              {observation.provider} · Place search
              {observation.latitude !== null && observation.longitude !== null
                ? ` · ${observation.latitude.toFixed(3)}, ${observation.longitude.toFixed(3)}`
                : ''}
              {' · Updated '}{observedTime}
            </p>
          </div>
        </div>
        <Pill tone={observation.intensity === 'none' ? 'success' : observation.intensity === 'extreme' ? 'danger' : 'warn'}>
          {readingPhrase(observation.intensity)}
        </Pill>
      </div>

      {observation.nextHours.length > 0 && (
        <>
          <p className="wva-eyebrow mt-3">Next 6 hours</p>
          <div className="wva-weather-forecast mt-2" aria-label="Next six hours forecast">
            {observation.nextHours.map((hour) => (
              <div className="wva-weather-forecast__hour" key={hour.time}>
                <time dateTime={hour.time}>
                  {new Date(hour.time).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: observation.timezone })}
                </time>
                <strong>{hour.temperatureC}°</strong>
                <span>{hour.precipitationProbability}% chance</span>
                <small>{hour.windKph} km/h wind</small>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-[12px] text-app-text-subtle">
        {observation.basis}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onApply}>
          Apply current conditions
        </Button>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
          Refresh
        </Button>
      </div>
    </div>
  )
}
