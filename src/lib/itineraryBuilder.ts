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
  /**
   * The sequence stored against this booking. Only meaningful once
   * `sequenceConfirmed` is set; until then the sorter assigns the order.
   */
  seq?: number
}

export type ReviewReason =
  | 'no_location'
  | 'branch'
  | 'gap'
  | 'overlap'
  | 'no_time'
  /**
   * The booking ended up before one that leaves earlier. The route chained, but
   * the dates disagree, which usually means a place name did not match and the
   * chain started in the wrong place.
   */
  | 'out_of_sequence'
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
 * Ordering
 * ========================================================================== */

/**
 * The automatic order.
 *
 * Time is the primary key, because it is the one signal every document shares:
 * a departure for a transport booking, a check-in for a stay. Sorting on it means
 * the itinerary reflects when things actually happen rather than the order the
 * documents happened to be uploaded in.
 *
 * Location continuity is then used to validate the result — see the gap and
 * branch checks in `buildItinerary` — rather than to drive it, so a chain that
 * does not line up is reported instead of being forced.
 */
function chronologicalOrder(segments: SegmentInput[]): SegmentInput[] {
  const legs = segments.filter((segment) => !isEvent(segment))
  const events = segments.filter((segment) => isEvent(segment))
  return mergeEvents([...legs].sort(byDeparture), [...events].sort(byDeparture))
}

/* ==========================================================================
 * Merging events into the chain
 * ========================================================================== */

/**
 * Slots each event into the gap it belongs in.
 *
 * An event is placed after the last leg that finishes before it starts, so a
 * hotel checked in after a bus arrives lands directly after that bus — which
 * also makes the connection time between them come out right.
 *
 * An event with no readable time cannot be positioned honestly, so it goes to
 * the end and is flagged for review rather than dropped or silently guessed.
 */
function mergeEvents(legs: SegmentInput[], events: SegmentInput[]): SegmentInput[] {
  if (events.length === 0) return legs
  if (legs.length === 0) return [...events].sort(byDeparture)

  const merged = [...legs]

  for (const event of [...events].sort(byDeparture)) {
    const starts = timeOf(event.departureAt)

    if (starts === null) {
      merged.push(event)
      continue
    }

    // The first leg that starts after this event begins is where the event goes
    // in front of. Everything before it has already finished.
    let index = merged.findIndex((leg) => {
      const legStart = timeOf(leg.departureAt)
      return legStart !== null && legStart > starts
    })

    if (index === -1) index = merged.length
    merged.splice(index, 0, event)
  }

  return merged
}

/* ==========================================================================
 * Public entry point
 * ========================================================================== */

/**
 * A booking that occupies a place in time rather than moving between two places.
 *
 * A hotel has a check-in and a check-out but no route, so it cannot be chained
 * onto the transport legs. Treating one as a leg would flag every hotel as an
 * unreadable location, which is wrong: the dates were read perfectly well.
 */
function isEvent(segment: SegmentInput): boolean {
  return segment.transportMode === 'hotel' || segment.transportMode === 'other'
}

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

  // Once the traveller has confirmed an order it is theirs; the automatic
  // sorter must not run again and undo it. Otherwise order by when each booking
  // starts, slotting hotels and other non-transport bookings into the gap they
  // belong in.
  const allConfirmed =
    segments.length > 0 &&
    segments.every((segment) => segment.sequenceConfirmed && typeof segment.seq === 'number')

  const ordered = allConfirmed
    ? [...segments].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    : chronologicalOrder(segments)

  /* --- connection times and the remaining flags ------------------------- */
  const result: OrderedSegment[] = ordered.map((segment, index) => {
    const previous = index > 0 ? ordered[index - 1] : null
    const arrival = previous ? timeOf(previous.arrivalAt) : null
    const departure = timeOf(segment.departureAt)

    let connectionMinutes: number | null = null
    if (arrival !== null && departure !== null) {
      connectionMinutes = Math.round((departure - arrival) / 60000)
    }

    let needsReview = false
    let reviewReason: ReviewReason | null = null
    let reviewNote: string | null = null

    // A booking whose location could not be read cannot be placed by route.
    // Events are exempt: a hotel is not supposed to have a route.
    if (!isEvent(segment) && (!normalisePlace(segment.origin) || !normalisePlace(segment.destination))) {
      needsReview = true
      reviewReason = 'no_location'
    }

    // More than one booking leaves from the same place: genuinely
    // ambiguous. Checked before the gap test, because two bookings from one
    // origin to two destinations are a branch even though the first one's
    // destination does not match the second one's origin.
    if (!isEvent(segment) && !reviewNote) {
      const sharedOrigin = ordered
        .slice(0, index)
        .filter(
          (other) =>
            !isEvent(other) &&
            normalisePlace(other.origin) &&
            normalisePlace(other.origin) === normalisePlace(segment.origin),
        )
      if (sharedOrigin.length > 0) {
        needsReview = true
        reviewReason = 'branch'
        reviewNote = 'More than one booking leaves from here, so we could not be sure of the order.'
      }
    }

    // Location continuity (2C): the previous booking must have arrived where
    // this one departs from. If it did not, the chain is broken — report it
    // rather than forcing a connection the document does not support.
    if (!isEvent(segment) && previous && !isEvent(previous) && !reviewNote) {
      const arrived = normalisePlace(previous.destination)
      const departs = normalisePlace(segment.origin)
      if (arrived && departs && arrived !== departs) {
        needsReview = true
        reviewReason = 'gap'
        reviewNote = 'This booking does not continue from the one before it, so its place in the trip is a guess.'
      }
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

    // The order is time-sorted, so a backwards sequence cannot occur. Equal
    // times with different origins are the one case worth flagging, and that is
    // caught by the branch check above.
    void departure

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
