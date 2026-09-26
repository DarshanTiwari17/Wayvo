/**
 * Rebuilds a trip's itinerary from the bookings that belong to it.
 *
 * This is pattern matching over what was actually read off the tickets — not a
 * model, and not an LLM. The rules are:
 *
 *   1. Chain by location. The next booking is the one that leaves where the
 *      previous one arrived.
 *   2. Where a chain cannot be formed, fall back to departure time.
 *   3. Never present a guess as certain. Anything ambiguous is still ordered, so
 *      the traveller sees a sensible list, but it is flagged `needsReview` with a
 *      plain-English reason, and the app asks them to confirm.
 *
 * Nothing here touches the network or the database, so it is exhaustively
 * testable. `persistItinerary` in the service layer writes the result.
 */
import type { TransportMode } from './bookingParser'

/* ==========================================================================
 * Types
 * ========================================================================== */

export interface SegmentInput {
  id: string
  origin: string | null
  destination: string | null
  departureAt: string | null
  arrivalAt: string | null
  transportMode: TransportMode | null
  operator: string | null
  serviceNumber: string | null
  bookingReference: string | null
  pnr: string | null
  passengerName: string | null
  seat: string | null
  coach: string | null
  terminal: string | null
  fareAmount: number | null
  fareCurrency: string | null
  bookingStatus: string | null
  source: 'manual' | 'upload' | 'gmail'
  /** 0..1 from the extractor, or null if it was added by hand. */
  confidence: number | null
  /** True once the traveller has accepted the order for this segment. */
  sequenceConfirmed?: boolean
}

export type ReviewReason =
  | 'no_location'
  | 'branch'
  | 'gap'
  | 'overlap'
  | 'no_time'
  | 'single'

export interface OrderedSegment extends SegmentInput {
  /** Zero-based position in the rebuilt itinerary. */
  seq: number
  /** Minutes between arriving on the previous booking and leaving on this one. */
  connectionMinutes: number | null
  /** True when this booking's place in the order is not certain. */
  needsReview: boolean
  reviewReason: ReviewReason | null
  /** Human-readable, safe to show the traveller. */
  reviewNote: string | null
}

export interface Itinerary {
  segments: OrderedSegment[]
  /** True when every link was an unambiguous, time-consistent chain. */
  confident: boolean
  /** Whole-trip notes, e.g. "2 bookings could not be matched to the route". */
  notes: string[]
}

/* ==========================================================================
 * Place normalisation
 * ==========================================================================
 *
 * Tickets print the same place many ways — "Mumbai (BOM)", "MUMBAI",
 * "Mumbai Airport", "Mumbai CSMT". Those must chain to each other or the
 * itinerary fragments. This is deliberately conservative: it only strips
 * decoration, never guesses a city it was not given.
 */

/**
 * Codes and noise that carry no place information.
 *
 * Station and airport suffixes matter here more than they might seem: tickets
 * routinely print "Pune Junction" on one leg and "PUNE" on the next, and if the
 * normaliser keeps "junction" the two legs will not chain and the itinerary
 * fragments for no good reason.
 */
const PLACE_NOISE =
  /\b(airport|international airport|domestic airport|airport terminal|city airport|railway station|rail station|bus station|bus stand|bus terminal|terminus|station|stn|junction|jn|central|city|halt|depot|port|terminal)\b/g

const PARENTHETICAL = /\(([^)]*)\)/g

/**
 * A comparison key for a place name. Two bookings chain only when their keys
 * are equal, so this errs towards "not the same place" and lets the caller
 * flag the ambiguity.
 */
export function normalisePlace(raw: string | null | undefined): string | null {
  if (!raw) return null

  let value = raw.toLowerCase().trim()
  if (!value) return null

  // Drop a trailing code in brackets: "Mumbai (BOM)" → "mumbai"
  const bracketed = value.replace(PARENTHETICAL, ' ').trim()
  // Only discard the bracket if what is left still says something. "BOM" alone
  // is a code with no city, and losing it entirely would be worse.
  if (bracketed) value = bracketed

  value = value.replace(PLACE_NOISE, ' ')
  value = value.replace(/[^a-z0-9\s]/g, ' ')
  value = value.replace(/\s+/g, ' ').trim()

  return value || null
}

/* ==========================================================================
 * Small helpers
 * ========================================================================== */

function timeOf(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function departureOf(segment: SegmentInput): number {
  // A booking with no departure time sorts to the end of its group rather than
  // the beginning, so an unknown time never masquerades as "first".
  return timeOf(segment.departureAt) ?? Number.POSITIVE_INFINITY
}

function byDeparture(a: SegmentInput, b: SegmentInput): number {
  const delta = departureOf(a) - departureOf(b)
  if (delta !== 0 && Number.isFinite(delta)) return delta
  // Stable tiebreak so the same input always produces the same order.
  return a.id.localeCompare(b.id)
}

/* ==========================================================================
 * The chain walk
 * ========================================================================== */

/**
 * Walks the bookings into a route.
 *
 * `remaining` is consumed as we go. Returns the order plus why any booking had
 * to be placed by guesswork.
 */
function chain(remaining: SegmentInput[]): {
  ordered: SegmentInput[]
  reasons: Map<string, ReviewReason>
} {
  const reasons = new Map<string, ReviewReason>()
  const pool = [...remaining].sort(byDeparture)
  const used = new Set<string>()
  const ordered: SegmentInput[] = []

  const take = (segment: SegmentInput) => {
    ordered.push(segment)
    used.add(segment.id)
  }

  /* --- where does the route start? ------------------------------------
   * A place that some booking leaves from, and no booking arrives at, is a
   * real starting point. A round trip has none, so fall back to the earliest
   * departure.
   * ------------------------------------------------------------------- */
  const destinations = new Set(
    pool.map((segment) => normalisePlace(segment.destination)).filter(Boolean) as string[],
  )

  const starts = pool.filter((segment) => {
    const origin = normalisePlace(segment.origin)
    if (!origin) return false
    return !destinations.has(origin)
  })

  let current: string | null = null

  if (starts.length === 1) {
    current = normalisePlace(starts[0].origin)
  } else if (starts.length > 1) {
    // Two bookings leave from somewhere nothing arrives at — genuinely
    // ambiguous. Earliest departure is the most defensible guess.
    for (const segment of starts) reasons.set(segment.id, 'branch')
    current = normalisePlace(starts[0].origin)
  } else {
    // A closed loop (Delhi → Mumbai → Delhi). Start at the earliest departure.
    current = null
  }

  /* --- walk the chain --------------------------------------------------- */
  let progress = true

  while (progress) {
    progress = false

    if (current === null) {
      // No anchor yet: take the earliest unplaced booking and start there.
      const next = pool.find((segment) => !used.has(segment.id))
      if (!next) break
      take(next)
      current = normalisePlace(next.destination)
      progress = true
      continue
    }

    const matches = pool.filter(
      (segment) => !used.has(segment.id) && normalisePlace(segment.origin) === current,
    )

    if (matches.length === 1) {
      take(matches[0])
      current = normalisePlace(matches[0].destination)
      progress = true
      continue
    }

    if (matches.length > 1) {
      // Two bookings leave the same place. Ordering by time is the best we can
      // do, and it is worth saying so.
      for (const match of matches) reasons.set(match.id, 'branch')
      const next = matches.sort(byDeparture)[0]
      take(next)
      current = normalisePlace(next.destination)
      progress = true
      continue
    }

    // Nothing leaves from here. Either we have arrived at the end of the route,
    // or there is a hole in it.
    const leftovers = pool.filter((segment) => !used.has(segment.id))
    if (leftovers.length === 0) break

    const next = leftovers.sort(byDeparture)[0]
    reasons.set(next.id, 'gap')
    take(next)
    current = normalisePlace(next.destination)
    progress = true
  }

  return { ordered, reasons }
}

/* ==========================================================================
 * Public entry point
 * ========================================================================== */

/**
 * Rebuilds the itinerary.
 *
 * Segments the traveller has already confirmed keep their relative order: their
 * `sequenceConfirmed` flag is passed through so the service layer can leave
 * them alone. Within this function they are still ordered, but `confident` is
 * reported as false whenever any booking needed a guess.
 */
export function buildItinerary(segments: SegmentInput[]): Itinerary {
  const notes: string[] = []

  if (segments.length === 0) {
    return { segments: [], confident: true, notes }
  }

  const { ordered, reasons } = chain(segments)

  /* --- connection times and the remaining flags ------------------------- */
  const result: OrderedSegment[] = ordered.map((segment, index) => {
    const previous = index > 0 ? ordered[index - 1] : null
    const arrival = previous ? timeOf(previous.arrivalAt) : null
    const departure = timeOf(segment.departureAt)

    let connectionMinutes: number | null = null
    if (arrival !== null && departure !== null) {
      connectionMinutes = Math.round((departure - arrival) / 60000)
    }

    let needsReview = reasons.has(segment.id)
    let reviewReason: ReviewReason | null = reasons.get(segment.id) ?? null
    let reviewNote: string | null = null

    // A booking whose location could not be read cannot be chained at all.
    if (!normalisePlace(segment.origin) || !normalisePlace(segment.destination)) {
      needsReview = true
      reviewReason = 'no_location'
    }

    // Departing before the previous booking arrives is impossible, and worth
    // flagging even when the locations chained cleanly.
    if (connectionMinutes !== null && connectionMinutes < 0) {
      needsReview = true
      reviewReason = 'overlap'
    }

    if (reviewReason === 'no_location') {
      reviewNote = 'We could not read both ends of this journey, so its place in the trip is a guess.'
    } else if (reviewReason === 'branch') {
      reviewNote = 'More than one booking leaves from here, so we could not be sure of the order.'
    } else if (reviewReason === 'gap') {
      reviewNote = 'This booking does not continue from the one before it, so its place in the trip is a guess.'
    } else if (reviewReason === 'overlap') {
      reviewNote = 'This booking appears to leave before the one before it arrives. Please check the times.'
    }

    if (!reviewNote && connectionMinutes === null && index > 0) {
      // Not wrong, just not verifiable.
      needsReview = true
      reviewReason = 'no_time'
      reviewNote = 'We could not work out the connection time because a time was missing.'
    }

    if (segment.sequenceConfirmed) {
      // The traveller has already accepted this booking's place in the trip.
      needsReview = false
      reviewNote = null
    }

    return { ...segment, seq: index, connectionMinutes, needsReview, reviewReason, reviewNote }
  })

  /* --- trip-level notes ------------------------------------------------- */
  const flagged = result.filter((segment) => segment.needsReview)

  if (segments.length === 1) {
    const only = segments[0]
    if (!normalisePlace(only.origin) || !normalisePlace(only.destination)) {
      notes.push('Add another booking to see the full route for this trip.')
    }
  }

  if (flagged.length === 1) {
    notes.push('1 booking needs your confirmation before we can be sure of the order.')
  } else if (flagged.length > 1) {
    notes.push(`${flagged.length} bookings need your confirmation before we can be sure of the order.`)
  }

  return { segments: result, confident: flagged.length === 0, notes }
}

/* ==========================================================================
 * Trip summary, derived from the itinerary
 * ========================================================================== */

export interface ItinerarySummary {
  origin: string | null
  destination: string | null
  startsOn: string | null
  endsOn: string | null
  segmentCount: number
}

/** The date part of an ISO timestamp, in the trip's own local terms. */
function datePart(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${parsed.getFullYear()}-${month}-${day}`
}

/**
 * Works out the trip's overall origin, destination and date span from its
 * bookings, so the dashboard and trip list stay correct without a join.
 *
 * Falls back to the trip's own values when the bookings do not say — it never
 * overwrites real information with a blank.
 */
export function summariseItinerary(
  itinerary: Pick<Itinerary, 'segments'>,
  current: { origin: string | null; destination: string | null; startsOn: string | null; endsOn: string | null } = {
    origin: null,
    destination: null,
    startsOn: null,
    endsOn: null,
  },
): ItinerarySummary {
  const { segments } = itinerary

  if (segments.length === 0) {
    return { ...current, segmentCount: 0 }
  }

  const first = segments[0]
  const last = segments[segments.length - 1]

  // Span across every booking, not just the first and last, so a later
  // correction cannot leave a stale start date behind.
  const dates = segments.flatMap((segment) => [datePart(segment.departureAt), datePart(segment.arrivalAt)])
  const known = dates.filter((value): value is string => Boolean(value)).sort()

  return {
    origin: first.origin ?? current.origin,
    destination: last.destination ?? current.destination,
    startsOn: known[0] ?? current.startsOn,
    endsOn: known[known.length - 1] ?? current.endsOn,
    segmentCount: segments.length,
  }
}
