import {
  fetchRailRadarStatus,
  hasMeaningfulOperationalChange,
  isOperationalStatusStale,
  operationalFingerprint,
  shouldPersistDisruption,
  shouldResolveDisruption,
  type NormalizedTrainStatus,
} from '../_shared/railradar.ts'
import { evaluateRailRadarDisruption } from '../_shared/railradarEvaluation.ts'
import {
  existingJourneyTrainNumber,
  identifyRailRadarTrain,
  type TrainCandidate,
} from '../_shared/railradarIdentification.ts'

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  RAILRADAR_API_KEY: string
  RAILRADAR_MONITORING_SECRET: string
  RAILRADAR_STALE_AFTER_SECONDS: number
  RAILRADAR_LOOKAHEAD_DAYS: number
  RAILRADAR_LOOKBACK_HOURS: number
}

interface TripRow {
  id: string
  profile_id: string
  status: string
  starts_on: string | null
}

interface SegmentRow {
  id: string
  trip_id: string
  service_number: string | null
  service_number_source: 'booking_import' | 'railradar' | 'manual_clarification' | null
  transport_mode: string | null
  operator_name: string | null
  booking_reference: string | null
  pnr: string | null
  field_provenance: unknown
  import_payload: unknown
  departure_at: string | null
  arrival_at: string | null
  origin: string | null
  destination: string | null
  trips: TripRow | TripRow[]
}

interface MonitoringStateRow {
  monitoring_status: string
  operational_status: NormalizedTrainStatus | null
  operational_fingerprint: string | null
  current_disruption_id: string | null
  identification_status: string
  identification_candidates: TrainCandidate[]
}

type IdentificationStatus = 'not_attempted' | 'identifying' | 'identified' | 'ambiguous' | 'not_found' | 'unavailable'

function env(): Env {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RAILRADAR_API_KEY: Deno.env.get('RAILRADAR_API_KEY') ?? '',
    RAILRADAR_MONITORING_SECRET: Deno.env.get('RAILRADAR_MONITORING_SECRET') ?? '',
    RAILRADAR_STALE_AFTER_SECONDS: positiveInteger(Deno.env.get('RAILRADAR_STALE_AFTER_SECONDS'), 600),
    RAILRADAR_LOOKAHEAD_DAYS: positiveInteger(Deno.env.get('RAILRADAR_LOOKAHEAD_DAYS'), 3),
    RAILRADAR_LOOKBACK_HOURS: positiveInteger(Deno.env.get('RAILRADAR_LOOKBACK_HOURS'), 24),
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function constantTimeEqual(actual: string, expected: string): boolean {
  let difference = actual.length ^ expected.length
  const length = Math.max(actual.length, expected.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0)
  }
  return difference === 0
}

function toTrip(segment: SegmentRow): TripRow | null {
  return Array.isArray(segment.trips) ? segment.trips[0] ?? null : segment.trips
}

function journeyDate(segment: SegmentRow, trip: TripRow): string | null {
  const value = segment.departure_at ?? trip.starts_on
  if (!value || Number.isNaN(Date.parse(value))) return null
  return value.slice(0, 10)
}

function isRelevant(segment: SegmentRow, trip: TripRow, config: Env, now: number): boolean {
  const departure = segment.departure_at ?? trip.starts_on
  if (!departure) return true
  const departureTime = Date.parse(departure)
  if (Number.isNaN(departureTime)) return true
  const arrivalTime = segment.arrival_at ? Date.parse(segment.arrival_at) : departureTime
  const latest = Number.isNaN(arrivalTime) ? departureTime : arrivalTime
  return departureTime <= now + config.RAILRADAR_LOOKAHEAD_DAYS * 86_400_000 &&
    latest >= now - config.RAILRADAR_LOOKBACK_HOURS * 3_600_000
}

async function rest(config: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

async function readRows<T>(config: Env, path: string): Promise<T[]> {
  const response = await rest(config, path)
  if (!response.ok) throw new Error(`Database read failed (${response.status}).`)
  return await response.json() as T[]
}

async function writeState(config: Env, row: Record<string, unknown>): Promise<void> {
  const response = await rest(config, 'railradar_monitoring_state?on_conflict=segment_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  })
  if (!response.ok) throw new Error(`Monitoring state write failed (${response.status}).`)
}

async function patchRow(config: Env, table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const response = await rest(config, `${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`${table} update failed (${response.status}).`)
}

async function saveSegmentTrainNumber(config: Env, segmentId: string, trainNumber: string, source: 'booking_import' | 'railradar'): Promise<void> {
  const response = await rest(config, `journey_segments?id=eq.${encodeURIComponent(segmentId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ service_number: trainNumber, service_number_source: source }),
  })
  if (!response.ok) throw new Error(`Train number persistence failed (${response.status}).`)
}

function importedTrainName(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = importedTrainName(entry)
      if (found) return found
    }
    return null
  }
  if (payload === null || typeof payload !== 'object') return null
  for (const [key, value] of Object.entries(payload)) {
    if (/^(train|service)(name)$/i.test(key.replace(/[_\s-]/g, '')) && typeof value === 'string' && value.trim()) return value.trim()
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const found = importedTrainName(value)
      if (found) return found
    }
  }
  return null
}

function importedTime(payload: unknown, key: 'departure' | 'arrival'): string | null {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const found = importedTime(entry, key)
      if (found) return found
    }
    return null
  }
  if (payload === null || typeof payload !== 'object') return null
  for (const [name, value] of Object.entries(payload)) {
    if (new RegExp(`^(scheduled)?${key}(at|time)?$`, 'i').test(name.replace(/[_\s-]/g, '')) && typeof value === 'string') return value
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object') {
      const found = importedTime(value, key)
      if (found) return found
    }
  }
  return null
}

function disruptionKind(status: NormalizedTrainStatus): string {
  if (status.cancelled) return 'cancellation'
  if (status.diverted) return 'diversion'
  if (status.rescheduled) return 'rescheduling'
  if (status.status === 'delayed' || (status.delayMinutes !== null && status.delayMinutes > 0)) return 'delay'
  return 'operational_exception'
}

function headline(status: NormalizedTrainStatus): string {
  if (status.cancelled) return 'Your train has been cancelled.'
  if (status.diverted) return 'Your train has been diverted.'
  if (status.rescheduled) return 'Your train has been rescheduled.'
  if (status.status === 'delayed' || (status.delayMinutes !== null && status.delayMinutes > 0)) return 'Your train is currently delayed.'
  return 'Your train has an operational update.'
}

function detail(status: NormalizedTrainStatus): string {
  const facts = [
    status.delayMinutes === null ? null : `RailRadar reported a delay of ${status.delayMinutes} minutes.`,
    status.currentLocation ? `Last reported near ${status.currentLocation}.` : null,
    status.nextHalt ? `Next station: ${status.nextHalt}.` : null,
    ...status.exceptions.map((exception) => exception.detail),
  ].filter((fact): fact is string => Boolean(fact))
  return [
    ...facts,
    'Wayvo recorded this provider-reported update. Open the journey to review its impact and applicable policy.',
  ].join(' ')
}

async function getCurrentState(config: Env, segmentId: string): Promise<MonitoringStateRow | null> {
  const rows = await readRows<MonitoringStateRow>(config,
    `railradar_monitoring_state?segment_id=eq.${encodeURIComponent(segmentId)}&select=monitoring_status,operational_status,operational_fingerprint,current_disruption_id&limit=1`)
  return rows[0] ?? null
}

async function openDisruptionId(config: Env, segmentId: string): Promise<string | null> {
  const rows = await readRows<{ id: string }>(config,
    `disruptions?segment_id=eq.${encodeURIComponent(segmentId)}&source=eq.provider&resolved_at=is.null&select=id&limit=1`)
  return rows[0]?.id ?? null
}

async function upsertDisruption(config: Env, segment: SegmentRow, trip: TripRow, status: NormalizedTrainStatus, currentId: string | null, now: string): Promise<string> {
  const kind = disruptionKind(status)
  const fields = {
    profile_id: trip.profile_id,
    trip_id: trip.id,
    segment_id: segment.id,
    kind,
    severity: status.cancelled ? 'critical' : 'warn',
    headline: headline(status),
    detail: detail(status),
    reported_at: now,
    resolved_at: null,
    delay_minutes: status.delayMinutes,
    original_departure_at: segment.departure_at,
    original_arrival_at: segment.arrival_at,
    revised_departure_at: status.expectedDeparture,
    revised_arrival_at: status.expectedArrival,
    cancellation_at: status.cancelled ? now : null,
    provider_event_reference: `railradar:${segment.id}`,
    source: 'provider',
  }

  if (currentId) {
    await patchRow(config, 'disruptions', currentId, fields)
    return currentId
  }

  const response = await rest(config, 'disruptions?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  })
  if (response.ok) {
    const rows = await response.json() as { id: string }[]
    if (rows[0]?.id) return rows[0].id
  }
  if (response.status === 409) {
    const racedId = await openDisruptionId(config, segment.id)
    if (racedId) {
      await patchRow(config, 'disruptions', racedId, fields)
      return racedId
    }
  }
  throw new Error(`Disruption write failed (${response.status}).`)
}

async function createNotification(config: Env, segment: SegmentRow, trip: TripRow, disruptionId: string, status: NormalizedTrainStatus, fingerprint: string): Promise<void> {
  const response = await rest(config,
    'journey_notifications?on_conflict=segment_id,disruption_id,operational_fingerprint', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        profile_id: trip.profile_id,
        trip_id: trip.id,
        segment_id: segment.id,
        disruption_id: disruptionId,
        notification_type: 'train_disruption',
        headline: headline(status),
        detail: detail(status),
        operational_fingerprint: fingerprint,
      }),
    })
  if (!response.ok) throw new Error(`Notification write failed (${response.status}).`)
}

async function scanSegments(config: Env, now: number): Promise<SegmentRow[]> {
  const result: SegmentRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const rows = await readRows<SegmentRow>(config,
      `journey_segments?select=id,trip_id,service_number,service_number_source,transport_mode,operator_name,departure_at,arrival_at,origin,destination,booking_reference,pnr,field_provenance,import_payload,trips!inner(id,profile_id,status,starts_on)&transport_mode=eq.train&trips.status=in.(planning,booked,active)&order=departure_at.asc&limit=1000&offset=${offset}`)
    result.push(...rows.filter((segment) => {
      const trip = toTrip(segment)
      return trip !== null && isRelevant(segment, trip, config, now)
    }))
    if (rows.length < 1000) return result
  }
}

async function monitorSegment(config: Env, segment: SegmentRow, now: Date): Promise<'checked' | 'unavailable' | 'unchanged' | 'disrupted' | 'ambiguous' | 'not_found'> {
  const trip = toTrip(segment)
  if (!trip) return 'unavailable'
  const previous = await getCurrentState(config, segment.id)
  const checkedAt = now.toISOString()
  const existingTrain = existingJourneyTrainNumber(segment.service_number, segment.service_number_source, segment.import_payload)
  let trainNumber = existingTrain?.trainNumber ?? null
  let identificationStatus: IdentificationStatus = trainNumber ? 'identified' : 'identifying'
  let identificationCandidates: TrainCandidate[] = []
  let identificationError: string | null = null
  const date = journeyDate(segment, trip)

  if (existingTrain?.recoveredFromPayload && trainNumber) {
    await saveSegmentTrainNumber(config, segment.id, trainNumber, 'booking_import')
    identificationStatus = 'identified'
  }

  if (!trainNumber) {
    if (!segment.origin || !segment.destination || !date) {
      identificationStatus = 'unavailable'
      identificationError = !segment.origin || !segment.destination
        ? 'Wayvo needs both journey stations before it can identify the train.'
        : 'Wayvo needs the journey date before it can identify the train.'
    } else {
      await writeState(config, {
        segment_id: segment.id,
        trip_id: trip.id,
        profile_id: trip.profile_id,
        provider: 'railradar',
        monitoring_status: 'monitoring_unavailable',
        identification_status: 'identifying',
        identification_candidates: [],
        checked_at: checkedAt,
        previous_status: previous?.operational_status ?? null,
        operational_status: previous?.operational_status ?? null,
        operational_fingerprint: previous?.operational_fingerprint ?? null,
        current_disruption_id: previous?.current_disruption_id ?? null,
        last_error: null,
      })
      const identification = await identifyRailRadarTrain({
        origin: segment.origin,
        destination: segment.destination,
        journeyDate: date,
        evidence: {
          pnr: segment.pnr,
          trainName: importedTrainName(segment.import_payload),
          departureAt: segment.departure_at ?? importedTime(segment.import_payload, 'departure'),
          arrivalAt: segment.arrival_at ?? importedTime(segment.import_payload, 'arrival'),
        },
        apiKey: config.RAILRADAR_API_KEY,
      })
      identificationStatus = identification.status
      if (identification.status === 'ambiguous') {
        identificationCandidates = identification.candidates
        identificationError = 'Wayvo found multiple trains matching this journey.'
      } else if (identification.status === 'not_found') {
        identificationError = "Wayvo couldn't identify a train for this journey from the available booking and schedule information."
      } else if (identification.status === 'unavailable') {
        identificationError = identification.message
      } else {
        trainNumber = identification.candidate.trainNumber
        await saveSegmentTrainNumber(config, segment.id, trainNumber, identification.source)
      }
    }
  }

  if (!trainNumber || !date) {
    const isAmbiguous = identificationStatus === 'ambiguous'
    const isNotFound = identificationStatus === 'not_found'
    await writeState(config, {
      segment_id: segment.id,
      trip_id: trip.id,
      profile_id: trip.profile_id,
      train_number: trainNumber,
      provider: 'railradar',
      monitoring_status: 'monitoring_unavailable',
      identification_status: identificationStatus,
      identification_candidates: identificationCandidates,
      checked_at: checkedAt,
      previous_status: previous?.operational_status ?? null,
      operational_status: previous?.operational_status ?? null,
      operational_fingerprint: previous?.operational_fingerprint ?? null,
      current_disruption_id: previous?.current_disruption_id ?? null,
      last_error: identificationError ?? (!date ? 'Wayvo needs the journey date before it can check live train status.' : null),
    })
    return isAmbiguous ? 'ambiguous' : isNotFound ? 'not_found' : 'unavailable'
  }

  const providerResult = await fetchRailRadarStatus({ trainNumber, journeyDate: date }, config.RAILRADAR_API_KEY)
  if (!providerResult.ok) {
    await writeState(config, {
      segment_id: segment.id,
      trip_id: trip.id,
      profile_id: trip.profile_id,
      train_number: trainNumber,
      provider: 'railradar',
      monitoring_status: 'provider_unavailable',
      identification_status: identificationStatus,
      identification_candidates: [],
      checked_at: checkedAt,
      previous_status: previous?.operational_status ?? null,
      operational_status: previous?.operational_status ?? null,
      operational_fingerprint: previous?.operational_fingerprint ?? null,
      current_disruption_id: previous?.current_disruption_id ?? null,
      last_error: providerResult.message,
    })
    return 'unavailable'
  }

  const status = providerResult.status
  const stale = isOperationalStatusStale(status, now.getTime(), config.RAILRADAR_STALE_AFTER_SECONDS)
  const fingerprint = operationalFingerprint(status)
  const priorStatus = previous?.operational_status ?? null
  const changed = hasMeaningfulOperationalChange(priorStatus, status)
  let currentDisruptionId = previous?.current_disruption_id ?? null
  let outcome: 'checked' | 'unchanged' | 'disrupted' = 'checked'

  if (shouldPersistDisruption({ status, isStale: stale, changed, currentDisruptionId })) {
    currentDisruptionId = await upsertDisruption(config, segment, trip, status, currentDisruptionId, checkedAt)
    await evaluateRailRadarDisruption(config, trip.profile_id, trip.id, segment.id, currentDisruptionId)
    await createNotification(config, segment, trip, currentDisruptionId, status, fingerprint)
    outcome = 'disrupted'
  } else if (shouldResolveDisruption({ status, isStale: stale, currentDisruptionId })) {
    await patchRow(config, 'disruptions', currentDisruptionId!, { resolved_at: checkedAt })
    currentDisruptionId = null
  } else if (!changed) {
    outcome = 'unchanged'
  }

  await writeState(config, {
    segment_id: segment.id,
    trip_id: trip.id,
    profile_id: trip.profile_id,
    train_number: trainNumber,
    provider: 'railradar',
    monitoring_status: stale ? 'stale' : 'monitoring',
    identification_status: 'identified',
    identification_candidates: [],
    checked_at: checkedAt,
    provider_timestamp: status.providerTimestamp,
    previous_status: priorStatus,
    operational_status: status,
    operational_fingerprint: fingerprint,
    current_disruption_id: currentDisruptionId,
    last_error: stale ? 'RailRadar data is stale; no disruption was inferred from this response.' : null,
  })
  return stale ? 'unavailable' : outcome
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const config = env()
  const suppliedSecret = request.headers.get('x-monitor-secret') ?? ''
  if (!config.RAILRADAR_MONITORING_SECRET || !constantTimeEqual(suppliedSecret, config.RAILRADAR_MONITORING_SECRET)) {
    return json({ error: 'unauthorised' }, 401)
  }
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY || !config.RAILRADAR_API_KEY) {
    return json({ error: 'monitoring_not_configured' }, 503)
  }

  try {
    const now = new Date()
    const segments = await scanSegments(config, now.getTime())
    const counts = { checked: 0, unchanged: 0, disrupted: 0, ambiguous: 0, not_found: 0, unavailable: 0, failed: 0 }
    for (const segment of segments) {
      try {
        const result = await monitorSegment(config, segment, now)
        counts[result] += 1
      } catch {
        counts.failed += 1
      }
    }
    return json({ checkedAt: now.toISOString(), scannedSegments: segments.length, counts })
  } catch {
    return json({ error: 'monitoring_run_failed' }, 502)
  }
})