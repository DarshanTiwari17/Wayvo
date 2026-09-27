/**
 * The bridge between real journey data and the digital twin.
 *
 * `digitalTwin.ts` knows nothing about Supabase. This module knows nothing
 * about weather. It answers one question: *given this trip and its bookings,
 * what is the twin actually simulating?*
 *
 * The rule is the same one the rest of the app follows — never invent data.
 * If the traveller's bookings carry departure and arrival times, the twin runs
 * on those real minutes. If they do not, the page says so and falls back to a
 * clearly-labelled estimate rather than quietly pretending the estimate is a
 * measured itinerary.
 */
import type { JourneySegment, TransportMode, Trip } from '../../types/database'
import { formatRoute } from '../../services/travelService'
import { GENERIC_CORRIDORS, type TwinCorridorInput } from './digitalTwin'

/** Used only when a trip has no times saved at all. Always labelled as an estimate. */
export const ESTIMATED_BASELINE_MINUTES = 35

export type TwinBaselineSource = 'measured' | 'estimated'

export type TwinBaseline = {
  /** Scheduled minutes for the whole trip. Never zero. */
  minutes: number
  corridors: TwinCorridorInput[]
  source: TwinBaselineSource
  /** How the minutes were obtained, shown to the traveller. */
  label: string
  /** True when at least one real leg duration backs the numbers. */
  hasLegTimings: boolean
  legCount: number
  /** Honest caveats, e.g. a trip with no bookings on it yet. */
  notes: string[]
}

const MODE_LABELS: Record<TransportMode, string> = {
  train: 'Train',
  flight: 'Flight',
  bus: 'Bus',
  car: 'Car',
  ferry: 'Ferry',
  hotel: 'Hotel',
  other: 'Other',
}

/**
 * Whole minutes between two timestamps, or `null` when either is missing,
 * unparseable, or the arrival is not after the departure. Returns `null`
 * rather than 0 so "no data" is never mistaken for "no time".
 */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const minutes = Math.round((end - start) / 60_000)
  return minutes > 0 ? minutes : null
}

function describeLeg(segment: JourneySegment, index: number): string {
  const route = [segment.origin?.trim(), segment.destination?.trim()].filter(Boolean).join(' → ')
  if (route) return route
  const operator = [segment.operator_name?.trim(), segment.service_number?.trim()].filter(Boolean).join(' · ')
  if (operator) return operator
  const mode = segment.transport_mode ? MODE_LABELS[segment.transport_mode] : null
  return mode ? `${mode} booking ${index + 1}` : `Booking ${index + 1}`
}

function detailFor(segment: JourneySegment): string {
  const operator = [segment.operator_name?.trim(), segment.service_number?.trim()].filter(Boolean).join(' · ')
  if (operator) return operator
  if (segment.transport_mode) return MODE_LABELS[segment.transport_mode]
  return 'Booking in this itinerary'
}

/**
 * Turns a real trip (and its bookings) into a twin baseline.
 *
 * Resolution order for the headline number:
 *   1. the sum of the real leg durations
 *   2. the trip's own departure → arrival window
 *   3. a labelled estimate
 */
export function baselineForTrip(trip: Trip, segments: JourneySegment[]): TwinBaseline {
  const notes: string[] = []
  const ordered = [...segments].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const timed = ordered.filter((segment) => minutesBetween(segment.departure_at, segment.arrival_at) !== null)

  // --- corridors -------------------------------------------------------
  let corridors: TwinCorridorInput[] = []
  let minutes = 0
  let source: TwinBaselineSource = 'estimated'
  let hasLegTimings = false

  if (ordered.length > 0) {
    corridors = ordered.map((segment, index) => ({
      id: segment.id,
      label: describeLeg(segment, index),
      detail: detailFor(segment),
      baseMinutes: minutesBetween(segment.departure_at, segment.arrival_at),
      // The real changeover window before this leg, when the traveller has one.
      connectionMinutes: segment.connection_minutes,
    }))
    hasLegTimings = timed.length > 0
    minutes = timed.reduce((total, segment) => total + (minutesBetween(segment.departure_at, segment.arrival_at) ?? 0), 0)
    // Real leg durations make the baseline measured, not estimated.
    if (minutes > 0) source = 'measured'
  }

  if (minutes <= 0) {
    const tripWindow = minutesBetween(trip.departure_at, trip.arrival_at)
    if (tripWindow !== null) {
      // One real duration for the whole trip: model it as a single timed
      // corridor rather than inventing a split across the legs.
      minutes = tripWindow
      source = 'measured'
      corridors = [
        {
          id: `${trip.id}-route`,
          label: formatRoute(trip),
          detail: 'Whole trip window from the saved booking',
          baseMinutes: tripWindow,
        },
      ]
    }
  }

  if (minutes <= 0) {
    minutes = ESTIMATED_BASELINE_MINUTES
    source = 'estimated'
    if (ordered.length > 0) {
      // Legs exist but carry no times — keep them as named corridors so the
      // breakdown still reflects the real itinerary, and split the estimate by
      // the generic network weights.
      corridors = ordered.map((segment, index) => ({
        id: segment.id,
        label: describeLeg(segment, index),
        detail: detailFor(segment),
        baseMinutes: null,
        weight: 1,
        connectionMinutes: segment.connection_minutes,
      }))
      notes.push(
        `This trip has ${ordered.length} booking${ordered.length === 1 ? '' : 's'} but no departure and arrival times, so the ${
          ESTIMATED_BASELINE_MINUTES
        } minute baseline is an estimate shared evenly across them.`,
      )
    } else {
      corridors = GENERIC_CORRIDORS.map((corridor) => ({ ...corridor }))
      notes.push(
        'This trip has no bookings with times on it, so the model runs on the generic network baseline rather than your real itinerary.',
      )
    }
  }

  // Timed legs whose saved times are unusable should not be silently dropped.
  const untimed = ordered.length - timed.length
  if (minutes > 0 && untimed > 0) {
    notes.push(
      `${untimed} of ${ordered.length} booking${ordered.length === 1 ? '' : 's'} ${
        untimed === 1 ? 'has' : 'have'
      } no usable departure and arrival times and ${untimed === 1 ? 'is' : 'are'} modelled on the network average.`,
    )
  }

  const label = buildLabel({ trip, source, minutes, legCount: ordered.length, hasLegTimings })

  return {
    minutes: Math.max(1, Math.round(minutes)),
    corridors,
    source,
    label,
    hasLegTimings,
    legCount: ordered.length,
    notes,
  }
}

/** The system baseline used when no trip is in scope. */
export function systemBaseline(): TwinBaseline {
  return {
    minutes: ESTIMATED_BASELINE_MINUTES,
    corridors: GENERIC_CORRIDORS.map((corridor) => ({ ...corridor })),
    source: 'estimated',
    label: `System baseline · ${ESTIMATED_BASELINE_MINUTES} min reference journey`,
    hasLegTimings: false,
    legCount: 0,
    notes: [],
  }
}

function buildLabel(input: {
  trip: Trip
  source: TwinBaselineSource
  minutes: number
  legCount: number
  hasLegTimings: boolean
}): string {
  const duration = `${input.minutes} min`
  if (input.source === 'estimated') return `${input.trip.title} · estimated ${duration} baseline`
  if (input.hasLegTimings) {
    return `${input.trip.title} · real itinerary, ${input.legCount} booking${input.legCount === 1 ? '' : 's'}, ${duration}`
  }
  return `${input.trip.title} · real booking window, ${duration}`
}
