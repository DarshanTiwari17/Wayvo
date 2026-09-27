/**
 * Scenario controls — the traveller's side of the twin.
 *
 * Everything here is honest about where its numbers come from. If a trip is
 * selected, the panel states whether the baseline is measured from real
 * bookings or estimated, and says so before the results are read rather than
 * hiding it underneath them.
 */
import { CloudRain, CloudSun, Flame, Info, RotateCcw, Snowflake, Thermometer, Timer } from 'lucide-react'
import { Button, Pill, SkeletonLines } from '../../components/app/Primitives'
import type { Trip } from '../../types/database'
import {
  DURATION_RANGE,
  SCENARIO_PRESETS,
  TEMPERATURE_RANGE,
  WEATHER_INTENSITY_OPTIONS,
  formatDurationHours,
  temperatureEffect,
  type TwinScenario,
} from './digitalTwin'
import type { TwinBaseline } from './twinBaseline'
import type { SegmentQueryState } from './useDigitalTwin'

type TripStatus = 'loading' | 'ready' | 'error' | 'missing'

export type ScenarioPanelProps = {
  scenario: TwinScenario
  onPatch: (next: Partial<TwinScenario>) => void
  onPreset: (preset: TwinScenario) => void
  onReset: () => void
  isDefault: boolean
  locations: readonly string[]

  trips: Trip[]
  tripsStatus: TripStatus
  tripsError: string | null
  onRetryTrips: () => void
  selectedTripId: string | null
  onSelectTrip: (tripId: string | null) => void

  baseline: TwinBaseline
  segments: SegmentQueryState
}

export function ScenarioPanel({
  scenario,
  onPatch,
  onPreset,
  onReset,
  isDefault,
  locations,
  trips,
  tripsStatus,
  tripsError,
  onRetryTrips,
  selectedTripId,
  onSelectTrip,
  baseline,
  segments,
}: ScenarioPanelProps) {
  const temperature = temperatureEffect(scenario.temperatureC, scenario.weatherIntensity)
  const hasSelectedTrip = selectedTripId !== null
  const segmentsPending = hasSelectedTrip && segments.status === 'loading'
  const showBaselineNote = !segmentsPending && segments.status !== 'error'

  return (
    <div className="space-y-6">
      {/* ---- what is being simulated ---------------------------------- */}
      <section>
        <label className="wva-label" htmlFor="digital-twin-trip">
          What is being simulated
        </label>

        {tripsStatus === 'loading' && (
          <div className="mt-2">
            <SkeletonLines rows={2} />
          </div>
        )}

        {tripsStatus === 'error' && (
          <div className="mt-2">
            <p className="wva-body text-app-danger" role="alert">
              We could not load your journeys, so the twin is running on the system baseline. {tripsError}
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetryTrips}>
              Try again
            </Button>
          </div>
        )}

        {tripsStatus === 'missing' && (
          <div className="mt-2">
            <p className="wva-body text-app-warn" role="status">
              Your journeys table is not set up on this project yet, so the twin is running on the system baseline. Run
              the travel migrations in Supabase to scope it to a real trip.
            </p>
          </div>
        )}

        {(tripsStatus === 'ready' || tripsStatus === 'missing') && (
          <>
            <select
              id="digital-twin-trip"
              className="wva-select"
              value={selectedTripId ?? 'system'}
              onChange={(event) => onSelectTrip(event.target.value === 'system' ? null : event.target.value)}
            >
              <option value="system">System baseline (no trip)</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>

            {tripsStatus === 'ready' && trips.length === 0 && (
              <p className="mt-2 text-[12px] text-app-text-subtle">
                You have no journeys saved yet, so the twin runs on the generic network baseline.
              </p>
            )}

            {hasSelectedTrip && (
              <div className="wva-digital-baseline mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={baseline.source === 'measured' ? 'success' : 'warn'}>
                    {baseline.source === 'measured' ? 'Real itinerary' : 'Estimated baseline'}
                  </Pill>
                  <span className="wva-meta text-app-text-muted">{baseline.label}</span>
                </div>

                {showBaselineNote &&
                  baseline.notes.map((note) => (
                    <p key={note} className="wva-meta mt-2 text-app-text-muted">
                      {note}
                    </p>
                  ))}

                {segments.status === 'error' && (
                  <p className="wva-meta mt-2 text-app-danger" role="alert">
                    We could not load the bookings for this trip, so it is modelled as one corridor. {segments.error}
                  </p>
                )}

                {segmentsPending && (
                  <p className="wva-meta mt-2 text-app-text-muted" role="status">
                    Loading the bookings for this trip…
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- ready-made scenarios -------------------------------------- */}
      <section>
        <span className="wva-label">Start from a scenario</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SCENARIO_PRESETS.map((preset) => {
            const active = JSON.stringify(preset.scenario) === JSON.stringify(scenario)
            return (
              <button
                key={preset.id}
                type="button"
                className={`wva-digital-preset ${active ? 'wva-digital-preset--active' : ''}`}
                aria-pressed={active}
                onClick={() => onPreset(preset.scenario)}
              >
                <span className="font-semibold">{preset.label}</span>
                <small>{preset.description}</small>
              </button>
            )
          })}
        </div>
      </section>

      {/* ---- rainfall --------------------------------------------------- */}
      <section>
        <fieldset>
          <legend className="wva-label">Rainfall intensity</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {WEATHER_INTENSITY_OPTIONS.map((option) => {
              const active = scenario.weatherIntensity === option.value
              return (
                <label key={option.value} className={`wva-digital-chip ${active ? 'wva-digital-chip--active' : ''}`}>
                  <input
                    type="radio"
                    name="digital-twin-intensity"
                    value={option.value}
                    checked={active}
                    onChange={() => onPatch({ weatherIntensity: option.value })}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-2">
                    {option.value === 'none' ? (
                      <CloudSun size={14} strokeWidth={2.1} aria-hidden="true" />
                    ) : (
                      <CloudRain size={14} strokeWidth={2.1} aria-hidden="true" />
                    )}
                    <span className="font-semibold">{option.label}</span>
                  </span>
                  <small>{option.description}</small>
                </label>
              )
            })}
          </div>
        </fieldset>
      </section>

      {/* ---- exposure --------------------------------------------------- */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="wva-label mb-0" htmlFor="digital-twin-duration">
            <span className="inline-flex items-center gap-1.5">
              <Timer size={13} strokeWidth={2.1} aria-hidden="true" />
              Exposure duration
            </span>
          </label>
          <span className="wva-meta">{formatDurationHours(scenario.durationHours)}</span>
        </div>
        <input
          id="digital-twin-duration"
          type="range"
          className="wva-slider"
          min={DURATION_RANGE.min}
          max={DURATION_RANGE.max}
          step={DURATION_RANGE.step}
          value={scenario.durationHours}
          aria-valuetext={`${scenario.durationHours} hours of rainfall`}
          onChange={(event) => onPatch({ durationHours: Number(event.target.value) })}
        />
        <p className="mt-1.5 text-[12px] text-app-text-subtle">
          Longer exposure keeps adding delay, but with diminishing returns — the first hour is the expensive one.
        </p>
      </section>

      {/* ---- temperature ------------------------------------------------ */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label className="wva-label mb-0" htmlFor="digital-twin-temperature">
            <span className="inline-flex items-center gap-1.5">
              <Thermometer size={13} strokeWidth={2.1} aria-hidden="true" />
              Temperature
            </span>
          </label>
          <span className="wva-meta">{scenario.temperatureC}°C</span>
        </div>
        <input
          id="digital-twin-temperature"
          type="range"
          className="wva-slider"
          min={TEMPERATURE_RANGE.min}
          max={TEMPERATURE_RANGE.max}
          step={TEMPERATURE_RANGE.step}
          value={scenario.temperatureC}
          aria-valuetext={`${scenario.temperatureC} degrees Celsius`}
          onChange={(event) => onPatch({ temperatureC: Number(event.target.value) })}
        />
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-app-text-subtle">
          {temperature.icing ? (
            <>
              <Snowflake size={13} strokeWidth={2.1} className="mt-px shrink-0 text-app-info" aria-hidden="true" />
              Icing risk at this temperature — the model adds black-ice braking delay.
            </>
          ) : temperature.heat ? (
            <>
              <Flame size={13} strokeWidth={2.1} className="mt-px shrink-0 text-app-warn" aria-hidden="true" />
              Extreme heat — the model adds vehicle slowdown.
            </>
          ) : (
            <>
              <Info size={13} strokeWidth={2.1} className="mt-px shrink-0" aria-hidden="true" />
              Neutral band. Below 2°C wet surfaces ice over; above 28°C vehicles slow down.
            </>
          )}
        </p>
      </section>

      {/* ---- area ------------------------------------------------------- */}
      <section>
        <label className="wva-label" htmlFor="digital-twin-location">
          Affected area
        </label>
        <select
          id="digital-twin-location"
          className="wva-select"
          value={scenario.location}
          onChange={(event) => onPatch({ location: event.target.value })}
        >
          {!locations.some((location) => location === scenario.location) && (
            <option value={scenario.location}>{scenario.location}</option>
          )}
          {locations.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-4">
        <Button variant="secondary" size="sm" onClick={onReset} disabled={isDefault}>
          <RotateCcw size={14} strokeWidth={2.2} aria-hidden="true" />
          Reset scenario
        </Button>
        <span className="wva-meta text-app-text-subtle">Results update as you change anything.</span>
      </div>
    </div>
  )
}
