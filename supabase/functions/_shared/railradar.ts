export type OperationalStatus =
  | 'running'
  | 'delayed'
  | 'cancelled'
  | 'diverted'
  | 'rescheduled'
  | 'stopped'
  | 'unknown'

export interface OperationalException {
  title: string | null
  detail: string
}

export interface NormalizedTrainStatus {
  trainNumber: string
  trainName: string | null
  status: OperationalStatus
  lastUpdatedAt: string | null
  delayMinutes: number | null
  currentLocation: string | null
  currentStation: string | null
  previousHalt: string | null
  nextHalt: string | null
  expectedArrival: string | null
  expectedDeparture: string | null
  platform: string | null
  cancelled: boolean
  diverted: boolean
  rescheduled: boolean
  exceptions: OperationalException[]
  source: 'railradar'
  providerTimestamp: string | null
}

export interface TrainLookup {
  trainNumber: string
  journeyDate: string
}

export function operationalFingerprint(status: NormalizedTrainStatus): string {
  return JSON.stringify({
    status: status.status,
    delayMinutes: status.delayMinutes,
    cancelled: status.cancelled,
    diverted: status.diverted,
    rescheduled: status.rescheduled,
    expectedArrival: status.expectedArrival,
    expectedDeparture: status.expectedDeparture,
    exceptions: status.exceptions,
  })
}

export function hasOperationalDisruption(status: NormalizedTrainStatus): boolean {
  return status.cancelled || status.diverted || status.rescheduled || status.status === 'stopped' ||
    status.status === 'delayed' || (status.delayMinutes !== null && status.delayMinutes > 0) || status.exceptions.length > 0
}

export function hasMeaningfulOperationalChange(
  previous: NormalizedTrainStatus | null,
  current: NormalizedTrainStatus,
): boolean {
  return previous === null || operationalFingerprint(previous) !== operationalFingerprint(current)
}

export function shouldPersistDisruption(input: {
  status: NormalizedTrainStatus
  isStale: boolean
  changed: boolean
  currentDisruptionId: string | null
}): boolean {
  return !input.isStale && hasOperationalDisruption(input.status) && (input.changed || !input.currentDisruptionId)
}

export function shouldResolveDisruption(input: {
  status: NormalizedTrainStatus
  isStale: boolean
  currentDisruptionId: string | null
}): boolean {
  return !input.isStale && !hasOperationalDisruption(input.status) && input.currentDisruptionId !== null
}

export type RailRadarResult =
  | { ok: true; status: NormalizedTrainStatus }
  | { ok: false; reason: 'unavailable' | 'timeout' | 'error'; message: string }

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function get(source: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const object = record(value)
  if (object) return text(get(object, 'name', 'stationName', 'station_name', 'location'))
  return null
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function timestamp(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function exceptionsFrom(value: unknown): OperationalException[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const entry = record(item)
    if (typeof item === 'string' && item.trim()) return [{ title: null, detail: item.trim() }]
    if (!entry) return []
    const detail = text(get(entry, 'detail', 'description', 'message', 'text', 'name'))
    if (!detail) return []
    return [{ title: text(get(entry, 'title', 'type', 'code')), detail }]
  })
}

export function normalizeRailRadarResponse(payload: unknown, requestedTrainNumber: string): NormalizedTrainStatus {
  const root = record(payload) ?? {}
  const data = record(get(root, 'data', 'train', 'live')) ?? root
  const statusValue = (text(get(data, 'status', 'running_status', 'runningStatus')) ?? '').toLowerCase()
  const exceptions = exceptionsFrom(get(data, 'exceptions', 'announcements', 'alerts'))
  const exceptionText = exceptions.map((exception) => `${exception.title ?? ''} ${exception.detail}`).join(' ').toLowerCase()
  const cancelled = bool(get(data, 'cancelled', 'canceled', 'is_cancelled', 'isCancelled')) || /cancel+ed/.test(statusValue) || /cancel+ed/.test(exceptionText)
  const diverted = bool(get(data, 'diverted', 'is_diverted', 'isDiverted')) || /divert/.test(statusValue) || /divert/.test(exceptionText)
  const rescheduled = bool(get(data, 'rescheduled', 'is_rescheduled', 'isRescheduled')) || /reschedul/.test(statusValue) || /reschedul/.test(exceptionText)
  const delayMinutes = numeric(get(data, 'delay_minutes', 'delayMinutes', 'delay'))
  const status: OperationalStatus = cancelled
    ? 'cancelled'
    : diverted
      ? 'diverted'
      : rescheduled
        ? 'rescheduled'
        : delayMinutes !== null && delayMinutes > 0 || /delay/.test(statusValue)
          ? 'delayed'
          : /stop/.test(statusValue)
            ? 'stopped'
            : /run|on time|ontime/.test(statusValue)
              ? 'running'
              : 'unknown'
  const providerTimestamp = timestamp(get(data, 'provider_timestamp', 'providerTimestamp', 'last_updated_at', 'lastUpdatedAt', 'updated_at', 'updatedAt', 'timestamp'))
  const current = record(get(data, 'current_station', 'currentStation', 'current_location', 'currentLocation'))
  const previous = record(get(data, 'previous_halt', 'previousHalt', 'previous_station', 'previousStation'))
  const next = record(get(data, 'next_halt', 'nextHalt', 'next_station', 'nextStation'))
  const currentStationCode = text(get(current ?? {}, 'stationCode', 'station_code', 'code'))
  const currentStationName = routeStationName(data, currentStationCode)

  return {
    trainNumber: text(get(data, 'train_number', 'trainNumber', 'number')) ?? requestedTrainNumber,
    trainName: text(get(data, 'train_name', 'trainName', 'name')),
    status,
    lastUpdatedAt: providerTimestamp,
    delayMinutes,
    currentLocation: text(get(data, 'current_location', 'currentLocation', 'current_position', 'currentPosition')) ?? text(get(current ?? {}, 'name', 'station_name', 'stationName', 'location')) ?? currentStationName ?? currentStationCode,
    currentStation: text(get(data, 'current_station', 'currentStation')) ?? text(get(current ?? {}, 'name', 'station_name', 'stationName')) ?? currentStationName ?? currentStationCode,
    previousHalt: text(get(data, 'previous_halt', 'previousHalt', 'previous_station', 'previousStation')) ?? text(get(previous ?? {}, 'name', 'station_name', 'stationName', 'code')),
    nextHalt: text(get(data, 'next_halt', 'nextHalt', 'next_station', 'nextStation')) ?? text(get(next ?? {}, 'name', 'station_name', 'stationName', 'code')),
    expectedArrival: timestamp(get(data, 'expected_arrival', 'expectedArrival', 'expected_arrival_at', 'expectedArrivalAt')),
    expectedDeparture: timestamp(get(data, 'expected_departure', 'expectedDeparture', 'expected_departure_at', 'expectedDepartureAt')),
    platform: text(get(data, 'platform', 'platform_number', 'platformNumber')),
    cancelled,
    diverted,
    rescheduled,
    exceptions,
    source: 'railradar',
    providerTimestamp,
  }
}

function routeStationName(data: JsonRecord, stationCode: string | null): string | null {
  if (!stationCode) return null
  const route = get(data, 'route')
  if (!Array.isArray(route)) return null
  for (const item of route) {
    const stop = record(item)
    if (text(get(stop ?? {}, 'stationCode', 'station_code', 'code')) !== stationCode) continue
    return text(get(stop ?? {}, 'stationName', 'station_name', 'name'))
  }
  return null
}

export async function fetchRailRadarStatus(
  lookup: TrainLookup,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<RailRadarResult> {
  const trainNumber = lookup.trainNumber.trim()
  if (!trainNumber) return { ok: false, reason: 'error', message: 'Train number is missing.' }

  try {
    const url = new URL(`https://api.railradar.in/v1/trains/${encodeURIComponent(trainNumber)}/live`)
    url.searchParams.set('date', lookup.journeyDate)
    const response = await fetcher(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { ok: false, reason: 'unavailable', message: `RailRadar returned HTTP ${response.status}.` }
    return { ok: true, status: normalizeRailRadarResponse(await response.json(), trainNumber) }
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return {
      ok: false,
      reason: timeout ? 'timeout' : 'error',
      message: timeout ? 'RailRadar request timed out.' : 'RailRadar could not be reached.',
    }
  }
}

export function isOperationalStatusStale(
  status: Pick<NormalizedTrainStatus, 'providerTimestamp'>,
  now = Date.now(),
  staleAfterSeconds = 600,
): boolean {
  if (!status.providerTimestamp) return true
  const providerTime = Date.parse(status.providerTimestamp)
  return Number.isNaN(providerTime) || now - providerTime > staleAfterSeconds * 1000 || providerTime > now
}