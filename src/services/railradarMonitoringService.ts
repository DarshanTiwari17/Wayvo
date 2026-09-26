import { getSupabase } from '../lib/supabase'
import type { JourneyNotification, RailRadarMonitoringState } from '../types/database'

export interface JourneyTrainCandidate {
  trainNumber: string
  trainName: string
  departure: string | null
  arrival: string | null
  originCode: string
  originName: string
  destinationCode: string
  destinationName: string
}

export class MonitoringDataError extends Error {
  readonly isMissingTable: boolean

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'MonitoringDataError'
    this.isMissingTable = code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message)
  }
}

export async function fetchTripMonitoringStates(tripId: string): Promise<RailRadarMonitoringState[]> {
  const { data, error } = await getSupabase()
    .from('railradar_monitoring_state')
    .select('segment_id, trip_id, profile_id, train_number, provider, monitoring_status, checked_at, provider_timestamp, previous_status, operational_status, operational_fingerprint, current_disruption_id, last_error, identification_status, identification_candidates')
    .eq('trip_id', tripId)

  if (error) throw new MonitoringDataError(error.message, error.code)
  return data ?? []
}

export async function fetchTripNotifications(tripId: string): Promise<JourneyNotification[]> {
  const { data, error } = await getSupabase()
    .from('journey_notifications')
    .select('id, profile_id, trip_id, segment_id, disruption_id, notification_type, headline, detail, operational_fingerprint, created_at, read_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new MonitoringDataError(error.message, error.code)
  return data ?? []
}

export async function chooseTrainCandidate(segmentId: string, trainNumber: string): Promise<void> {
  const supabase = getSupabase()
  const { data: state, error: stateError } = await supabase
    .from('railradar_monitoring_state')
    .select('identification_status, identification_candidates')
    .eq('segment_id', segmentId)
    .maybeSingle()
  if (stateError) throw new MonitoringDataError(stateError.message, stateError.code)
  if (state?.identification_status !== 'ambiguous') throw new Error('Train candidates are no longer available.')

  const candidates = Array.isArray(state.identification_candidates)
    ? state.identification_candidates as unknown as JourneyTrainCandidate[]
    : []
  const candidate = candidates.find((item) => item.trainNumber === trainNumber)
  if (!candidate) throw new Error('Choose one of the trains Wayvo found for this journey.')

  const { error } = await supabase
    .from('journey_segments')
    .update({ service_number: candidate.trainNumber, service_number_source: 'manual_clarification' })
    .eq('id', segmentId)
  if (error) throw error
}