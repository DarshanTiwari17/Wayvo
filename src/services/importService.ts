/**
 * Persists an extracted journey to Supabase.
 *
 * Nothing is written until the traveller has seen the extraction and pressed
 * Confirm. That is the whole point: extraction is uncertain, so the review
 * screen is mandatory rather than optional.
 */
import { getSupabase } from '../lib/supabase'
import type { ExtractedJourney, Provenance, TransportMode } from '../lib/bookingParser'
import type { Json, Trip, TripStatus } from '../types/database'

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export type JourneySource = 'manual' | 'upload' | 'gmail'

export interface JourneyDraft {
  title: string
  origin: string | null
  destination: string | null
  transportMode: TransportMode | null
  operator: string | null
  serviceNumber: string | null
  departureAt: string | null // ISO datetime
  arrivalAt: string | null
  bookingReference: string | null
  pnr: string | null
  ticketNumber: string | null
  passengerName: string | null
  seat: string | null
  coach: string | null
  terminal: string | null
  fareAmount: number | null
  fareCurrency: string | null
  bookingStatus: string | null
  startsOn: string | null
  endsOn: string | null
  status: TripStatus
  provenance: Record<string, Provenance>
  source: JourneySource
  extracted: ExtractedJourney | null
}

export interface SegmentDraft {
  seq: number
  origin: string | null
  destination: string | null
  departureAt: string | null
  arrivalAt: string | null
  transportMode: TransportMode | null
  operator: string | null
  serviceNumber: string | null
  bookingReference: string | null
  pnr: string | null
  seat: string | null
  coach: string | null
  terminal: string | null
  ticketNumber: string | null
}

export interface PotentialDuplicate {
  trip: Trip
  reason: string
}

/* ==========================================================================
 * Draft building — turns parser output into a saveable shape
 * ========================================================================== */

function combineDateTime(date: string | null, time: string | null): string | null {
  if (!date) return null
  // A bare time is treated as local time on that date.
  return new Date(`${date}T${time ?? '00:00'}:00`).toISOString()
}

export function draftFromExtraction(
  extracted: ExtractedJourney,
  provenance: Record<string, Provenance>,
  source: JourneySource,
): JourneyDraft {
  const title = [extracted.origin, extracted.destination].filter(Boolean).join(' → ') || 'Imported journey'

  return {
    title: title.slice(0, 120),
    origin: extracted.origin,
    destination: extracted.destination,
    transportMode: extracted.transportMode,
    operator: extracted.operator,
    serviceNumber: extracted.serviceNumber,
    departureAt: combineDateTime(extracted.departureDate, extracted.departureTime),
    arrivalAt: combineDateTime(extracted.arrivalDate, extracted.arrivalTime),
    bookingReference: extracted.bookingReference,
    pnr: extracted.pnr,
    ticketNumber: extracted.ticketNumber,
    passengerName: extracted.traveler,
    seat: extracted.seat,
    coach: extracted.coach,
    terminal: extracted.terminal,
    fareAmount: extracted.fare,
    fareCurrency: extracted.currency,
    bookingStatus: extracted.bookingStatus,
    startsOn: extracted.departureDate,
    endsOn: extracted.arrivalDate,
    status: extracted.bookingStatus === 'cancelled' ? 'cancelled' : 'booked',
    provenance,
    source,
    extracted,
  }
}

/* ==========================================================================
 * Deduplication
 * ========================================================================== */

/**
 * Looks for a journey the traveller already has.
 *
 * Matching is on the strongest identifier available, then falls back to
 * date + route, which is what actually catches a re-imported attachment whose
 * PNR was never printed.
 */
export async function findPotentialDuplicates(
  profileId: string,
  draft: JourneyDraft,
  excludeTripId?: string,
): Promise<PotentialDuplicate[]> {
  const supabase = getSupabase()
  const found: PotentialDuplicate[] = []

  const byPnr = async (column: 'pnr' | 'booking_reference', value: string) => {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('profile_id', profileId)
      .eq(column, value)
      .limit(5)
    if (!error && data) {
      for (const trip of data) {
        if (trip.id !== excludeTripId && !found.some((f) => f.trip.id === trip.id)) {
          found.push({ trip, reason: column === 'pnr' ? `matching PNR ${value}` : `matching booking reference ${value}` })
        }
      }
    }
  }

  if (draft.pnr) await byPnr('pnr', draft.pnr)
  if (draft.bookingReference) await byPnr('booking_reference', draft.bookingReference)
  if (draft.ticketNumber) await byPnr('booking_reference', draft.ticketNumber)

  // Date + route, for documents with no usable identifier.
  if (draft.startsOn && (draft.origin || draft.destination)) {
    let query = supabase.from('trips').select('*').eq('profile_id', profileId).eq('starts_on', draft.startsOn)
    if (draft.origin) query = query.eq('origin', draft.origin)
    if (draft.destination) query = query.eq('destination', draft.destination)
    const { data, error } = await query.limit(5)
    if (!error && data) {
      for (const trip of data) {
        if (trip.id !== excludeTripId && !found.some((f) => f.trip.id === trip.id)) {
          found.push({ trip, reason: 'same date and route' })
        }
      }
    }
  }

  return found
}

/* ==========================================================================
 * Save
 * ========================================================================== */

const TRIP_COLUMNS =
  'id, profile_id, title, origin, destination, status, starts_on, ends_on, created_at, updated_at, transport_mode, operator_name, service_number, departure_at, arrival_at, booking_reference, pnr, ticket_number, passenger_name, seat, coach, terminal, fare_amount, fare_currency, booking_status, source, field_provenance, import_payload'

/**
 * Writes the journey, then its segments. Segments are optional: a single-ticket
 * import is one journey with no legs to describe.
 */
export async function saveJourney(
  profileId: string,
  draft: JourneyDraft,
  segments: SegmentDraft[] = [],
): Promise<Trip> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('trips')
    .insert({
      profile_id: profileId,
      title: draft.title,
      origin: draft.origin,
      destination: draft.destination,
      status: draft.status,
      starts_on: draft.startsOn,
      ends_on: draft.endsOn,
      transport_mode: draft.transportMode,
      operator_name: draft.operator,
      service_number: draft.serviceNumber,
      departure_at: draft.departureAt,
      arrival_at: draft.arrivalAt,
      booking_reference: draft.bookingReference,
      pnr: draft.pnr,
      ticket_number: draft.ticketNumber,
      passenger_name: draft.passengerName,
      seat: draft.seat,
      coach: draft.coach,
      terminal: draft.terminal,
      fare_amount: draft.fareAmount,
      fare_currency: draft.fareCurrency,
      booking_status: draft.bookingStatus,
      source: draft.source,
      field_provenance: draft.provenance,
      import_payload: draft.extracted ? (JSON.parse(JSON.stringify(draft.extracted)) as Json) : null,
    })
    .select(TRIP_COLUMNS)
    .single()

  if (error) {
    if (/row-level security|permission/i.test(error.message)) {
      throw new ImportError('We couldn\'t save that journey. Please sign in again and retry.')
    }
    if (/trips_source_check|trips_transport_mode_check/.test(error.message)) {
      throw new ImportError('Some of those details aren\'t in a format Wayvo accepts. Please check and try again.')
    }
    if (/date|invalid input/i.test(error.message)) {
      throw new ImportError('One of the dates or times could not be read. Please check them and try again.')
    }
    throw new ImportError('That journey could not be saved. Please try again.')
  }

  if (segments.length > 0) {
    const { error: segError } = await supabase.from('journey_segments').insert(
      segments.map((segment) => ({
        trip_id: data.id,
        seq: segment.seq,
        origin: segment.origin,
        destination: segment.destination,
        departure_at: segment.departureAt,
        arrival_at: segment.arrivalAt,
        transport_mode: segment.transportMode,
        operator_name: segment.operator,
        service_number: segment.serviceNumber,
        booking_reference: segment.bookingReference,
        pnr: segment.pnr,
        seat: segment.seat,
        coach: segment.coach,
        terminal: segment.terminal,
        ticket_number: segment.ticketNumber,
      })),
    )
    if (segError) {
      // The journey itself is saved; a failed leg must not lose it.
      console.warn('Journey saved but its legs could not be stored:', segError.message)
    }
  }

  return data
}
