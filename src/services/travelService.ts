/**
 * Real Supabase queries for the traveller-facing product data.
 *
 * Everything here reads or writes actual rows. There are no fallbacks, no
 * seeded demo data and no invented journeys: when a table is empty the UI shows
 * an empty state, and when a table does not exist yet the error is reported
 * honestly (see `isMissingTable`) so the page can tell the user what to run.
 *
 * Row Level Security is the real boundary. The `profile_id = <own uuid>` filters
 * below are a convenience, not the control — see 0002_travel.sql.
 */
import { getSupabase } from '../lib/supabase'
import type { Disruption, RecoveryPlan, Trip, TripInsert, TripStatus, TripUpdate } from '../types/database'

/** Thrown when a query fails, so callers can decide how to surface it. */
export class TravelDataError extends Error {
  readonly code: string | undefined
  /** True when the table is missing, i.e. the migration has not been run. */
  readonly isMissingTable: boolean

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'TravelDataError'
    this.code = code
    this.isMissingTable =
      code === '42P01' ||
      code === 'PGRST205' ||
      /does not exist|not found|schema cache/i.test(message)
  }
}

function toError(error: { message: string; code?: string }): TravelDataError {
  return new TravelDataError(error.message, error.code)
}

const TRIP_COLUMNS = 'id, profile_id, title, origin, destination, status, starts_on, ends_on, created_at, updated_at'

/* ---------------------------------------------------------------------------
 * Journeys
 * ------------------------------------------------------------------------- */

export async function fetchTrips(profileId: string): Promise<Trip[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('trips')
    .select(TRIP_COLUMNS)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })

  if (error) throw toError(error)
  return data ?? []
}

export async function createTrip(profileId: string, input: Omit<TripInsert, 'profile_id'>): Promise<Trip> {
  const supabase = getSupabase()
  // RLS rejects any profile_id that is not the caller's, so an empty or forged
  // value fails at the database rather than silently writing someone else's row.
  const { data, error } = await supabase
    .from('trips')
    .insert({ ...input, profile_id: profileId })
    .select(TRIP_COLUMNS)
    .single()

  if (error) throw toError(error)
  return data
}

export async function updateTrip(profileId: string, tripId: string, patch: Omit<TripUpdate, 'profile_id' | 'id'>): Promise<Trip> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('trips')
    .update(patch)
    .eq('id', tripId)
    .eq('profile_id', profileId)
    .select(TRIP_COLUMNS)
    .single()

  if (error) throw toError(error)
  return data
}

/* ---------------------------------------------------------------------------
 * Disruptions (Alerts)
 * ------------------------------------------------------------------------- */

/** Open disruptions, newest first. `resolved_at` null means still active. */
export async function fetchOpenDisruptions(profileId: string): Promise<Disruption[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('disruptions')
    .select('id, profile_id, trip_id, kind, severity, headline, detail, reported_at, resolved_at')
    .eq('profile_id', profileId)
    .is('resolved_at', null)
    .order('reported_at', { ascending: false })

  if (error) throw toError(error)
  return data ?? []
}

/* ---------------------------------------------------------------------------
 * Recovery plans
 * ------------------------------------------------------------------------- */

export async function fetchRecoveryPlans(profileId: string): Promise<RecoveryPlan[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('recovery_plans')
    .select('id, profile_id, trip_id, disruption_id, title, summary, total_cost, currency, status, created_at, updated_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })

  if (error) throw toError(error)
  return data ?? []
}

/* ---------------------------------------------------------------------------
 * Presentation helpers
 *
 * Pure formatting, no data invention. Unknown values degrade to a sensible
 * neutral rather than pretending to know something.
 * ------------------------------------------------------------------------- */

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  planning: 'Planning',
  booked: 'Booked',
  active: 'Travelling now',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/** Past journeys are the ones whose end date (or start date) has gone. */
export function isJourneyPast(trip: Trip, today = new Date()): boolean {
  const marker = trip.ends_on ?? trip.starts_on
  if (!marker) return trip.status === 'completed' || trip.status === 'cancelled'
  return new Date(`${marker}T23:59:59`) < today || trip.status === 'completed'
}

/** "12 – 18 Mar 2026", or whichever half of the range exists. */
export function formatDateRange(startsOn: string | null, endsOn: string | null): string {
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

  if (!startsOn && !endsOn) return 'Dates not set'
  if (startsOn && !endsOn) return fmt.format(new Date(`${startsOn}T00:00:00`))
  if (!startsOn && endsOn) return fmt.format(new Date(`${endsOn}T00:00:00`))

  const start = new Date(`${startsOn}T00:00:00`)
  const end = new Date(`${endsOn}T00:00:00`)
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()

  return sameMonth
    ? `${fmtShort.format(start)} – ${fmt.format(end)}`
    : `${fmt.format(start)} – ${fmt.format(end)}`
}

/** "Paris → Lisbon", or just whichever endpoint the traveller filled in. */
export function formatRoute(trip: Pick<Trip, 'origin' | 'destination'>): string {
  const from = trip.origin?.trim()
  const to = trip.destination?.trim()
  if (from && to) return `${from} \u2192 ${to}`
  if (to) return `To ${to}`
  if (from) return `From ${from}`
  return 'Route not set'
}
