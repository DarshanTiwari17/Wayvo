export interface RailRadarStation {
  code: string
  name: string
  city: string | null
}

export interface TrainCandidate {
  trainNumber: string
  trainName: string
  departure: string | null
  arrival: string | null
  arrivalDayOffset: number | null
  originCode: string
  originName: string
  destinationCode: string
  destinationName: string
}

export interface TrainIdentificationEvidence {
  trainNumber?: string | null
  providerTrainNumber?: string | null
  pnr?: string | null
  trainName?: string | null
  departureAt?: string | null
  arrivalAt?: string | null
}

export type TrainIdentification =
  | { status: 'identified'; candidate: TrainCandidate; candidates: TrainCandidate[]; source: 'booking_import' | 'railradar' }
  | { status: 'ambiguous'; candidates: TrainCandidate[] }
  | { status: 'not_found'; candidates: [] }
  | { status: 'unavailable'; candidates: []; message: string }

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function value(recordValue: JsonRecord | null, ...keys: string[]): unknown {
  if (!recordValue) return undefined
  for (const key of keys) {
    if (recordValue[key] !== undefined && recordValue[key] !== null) return recordValue[key]
  }
  return undefined
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function envelopeData(payload: unknown): unknown {
  const root = record(payload)
  if (!root || root.success === false) return null
  return root.data
}

export function normalizeStationText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(junction|jn|railway station|rail station|station)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeRailRadarStations(payload: unknown): RailRadarStation[] | null {
  const data = envelopeData(payload)
  if (!data || !Array.isArray(data)) return null
  return data.flatMap((entry) => {
    const station = record(entry)
    const code = string(value(station, 'code'))
    const name = string(value(station, 'name'))
    if (!code || !name) return []
    return [{ code, name, city: string(value(station, 'city')) }]
  })
}

export function findImportedTrainNumber(payload: unknown): string | null {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findImportedTrainNumber(item)
      if (found) return found
    }
    return null
  }
  const source = record(payload)
  if (!source) return null
  for (const [key, entry] of Object.entries(source)) {
    if (/^(train|service)(number|no)$/i.test(key.replace(/[_\s-]/g, ''))) {
      const found = string(entry)
      if (found) return found
    }
  }
  for (const entry of Object.values(source)) {
    if (entry && typeof entry === 'object') {
      const found = findImportedTrainNumber(entry)
      if (found) return found
    }
  }
  return null
}

export function existingJourneyTrainNumber(
  serviceNumber: string | null,
  serviceNumberSource: 'booking_import' | 'railradar' | 'manual_clarification' | null,
  importPayload: unknown,
): { trainNumber: string; source: 'booking_import' | 'railradar' | 'manual_clarification' | null; recoveredFromPayload: boolean } | null {
  const existing = serviceNumber?.trim()
  if (existing) return { trainNumber: existing, source: serviceNumberSource, recoveredFromPayload: false }
  const imported = findImportedTrainNumber(importPayload)
  return imported ? { trainNumber: imported, source: 'booking_import', recoveredFromPayload: true } : null
}

export function resolveRailRadarStations(query: string, stations: RailRadarStation[]): RailRadarStation[] {
  const code = query.match(/\(([a-z0-9]{1,10})\)/i)?.[1] ?? query.trim()
  const codeMatches = stations.filter((station) => station.code.toLowerCase() === code.toLowerCase())
  if (codeMatches.length > 0) return uniqueStations(codeMatches)
  const normalized = normalizeStationText(query.replace(/\s*\([^)]*\)/g, ''))
  if (!normalized) return []
  const exactName = stations.filter((station) => normalizeStationText(station.name) === normalized)
  if (exactName.length > 0) return uniqueStations(exactName)
  return uniqueStations(stations.filter((station) => station.city && normalizeStationText(station.city) === normalized))
}

function uniqueStations(stations: RailRadarStation[]): RailRadarStation[] {
  return [...new Map(stations.map((station) => [station.code, station])).values()]
}

export function normalizeTrainsBetween(payload: unknown, origin: RailRadarStation, destination: RailRadarStation): TrainCandidate[] | null {
  const data = record(envelopeData(payload))
  if (!data || !Array.isArray(data.trains)) return null
  return data.trains.flatMap((entry) => {
    const train = record(value(record(entry), 'train'))
    const number = string(value(train, 'number', 'trainNumber', 'train_number'))
    if (!number) return []
    const from = record(value(record(entry), 'from'))
    const to = record(value(record(entry), 'to'))
    const fromDay = numericValue(value(from, 'day'))
    const toDay = numericValue(value(to, 'day'))
    return [{
      trainNumber: number,
      trainName: string(value(train, 'name', 'trainName', 'train_name')) ?? '',
      departure: string(value(from, 'departure')),
      arrival: string(value(to, 'arrival')),
      originCode: origin.code,
      originName: origin.name,
      destinationCode: destination.code,
      destinationName: destination.name,
      arrivalDayOffset: fromDay !== null && toDay !== null ? toDay - fromDay : null,
    }]
  })
}

function journeyTime(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/(?:T|\s)(\d{2}:\d{2})/)
  return match?.[1] ?? null
}

function journeyDayOffset(departureAt: string | null | undefined, arrivalAt: string | null | undefined): number | null {
  const departureDate = departureAt?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  const arrivalDate = arrivalAt?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  if (!departureDate || !arrivalDate) return null
  return Math.round((Date.parse(`${arrivalDate}T00:00:00Z`) - Date.parse(`${departureDate}T00:00:00Z`)) / 86_400_000)
}

export function identifyTrainCandidate(
  candidates: TrainCandidate[],
  evidence: TrainIdentificationEvidence,
): TrainIdentification {
  const unique = [...new Map(candidates.map((candidate) => [
    `${candidate.trainNumber}|${candidate.originCode}|${candidate.destinationCode}|${candidate.departure}|${candidate.arrival}`,
    candidate,
  ])).values()]
  if (unique.length === 0) return { status: 'not_found', candidates: [] }

  if (evidence.providerTrainNumber) {
    const numberMatches = unique.filter((candidate) => candidate.trainNumber === evidence.providerTrainNumber)
    if (numberMatches.length === 1) return identified(numberMatches[0], unique, 'railradar')
  }
  if (evidence.trainNumber) {
    const numberMatches = unique.filter((candidate) => candidate.trainNumber === evidence.trainNumber)
    if (numberMatches.length === 1) return identified(numberMatches[0], unique, 'booking_import')
  }

  const trainName = evidence.trainName ? normalizeStationText(evidence.trainName) : ''
  const departure = journeyTime(evidence.departureAt)
  const arrival = journeyTime(evidence.arrivalAt)
  const arrivalDayOffset = journeyDayOffset(evidence.departureAt, evidence.arrivalAt)
  const constrained = unique.filter((candidate) =>
    (!trainName || normalizeStationText(candidate.trainName) === trainName) &&
    (!departure || candidate.departure === departure) &&
    (!arrival || candidate.arrival === arrival) &&
    (arrivalDayOffset === null || candidate.arrivalDayOffset === arrivalDayOffset))
  if (constrained.length === 1) return identified(constrained[0], unique, 'railradar')
  return { status: 'ambiguous', candidates: constrained.length > 1 ? constrained : unique }
}

function identified(candidate: TrainCandidate, candidates: TrainCandidate[], source: 'booking_import' | 'railradar'): TrainIdentification {
  return { status: 'identified', candidate, candidates, source }
}

export async function identifyRailRadarTrain(input: {
  origin: string
  destination: string
  journeyDate: string
  evidence: TrainIdentificationEvidence
  apiKey: string
  fetcher?: Fetcher
}): Promise<TrainIdentification> {
  const fetcher = input.fetcher ?? fetch
  try {
    let providerTrainNumber: string | null = null
    if (input.evidence.pnr && /^\d{10}$/.test(input.evidence.pnr)) {
      try {
        const pnrResponse = await fetcher(`https://api.railradar.in/v1/pnr/${encodeURIComponent(input.evidence.pnr)}`, {
          headers: { authorization: `Bearer ${input.apiKey}`, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        })
        if (pnrResponse.ok) {
          const pnrData = record(envelopeData(await pnrResponse.json()))
          const pnrDate = string(value(record(value(pnrData, 'journey')), 'date'))
          const pnrTrain = record(value(pnrData, 'train'))
          if (pnrDate === input.journeyDate) providerTrainNumber = string(value(pnrTrain, 'number'))
        }
      } catch {
        // A failed PNR lookup does not prevent route and schedule matching.
      }
    }

    const stationsFor = async (query: string): Promise<RailRadarStation[] | null> => {
      const url = new URL('https://api.railradar.in/v1/lookup/search/stations')
      url.searchParams.set('q', query)
      url.searchParams.set('limit', '50')
      const response = await fetcher(url, { headers: { authorization: `Bearer ${input.apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return null
      return normalizeRailRadarStations(await response.json())
    }

    const [originResults, destinationResults] = await Promise.all([
      stationsFor(input.origin),
      stationsFor(input.destination),
    ])
    if (!originResults || !destinationResults) return { status: 'unavailable', candidates: [], message: 'RailRadar station lookup is unavailable.' }
    const origins = resolveRailRadarStations(input.origin, originResults)
    const destinations = resolveRailRadarStations(input.destination, destinationResults)
    if (origins.length === 0 || destinations.length === 0) return { status: 'not_found', candidates: [] }

    const pairs = origins.flatMap((origin) => destinations.map((destination) => ({ origin, destination })))
    if (pairs.length > 100) {
      return { status: 'unavailable', candidates: [], message: 'The station search returned too many route combinations to verify safely.' }
    }

    const routeResults = await Promise.all(pairs.map(async ({ origin, destination }) => {
      const path = `https://api.railradar.in/v1/trains/between/${encodeURIComponent(origin.code)}/${encodeURIComponent(destination.code)}`
      const url = new URL(path)
      url.searchParams.set('date', input.journeyDate)
      url.searchParams.set('live', 'true')
      const response = await fetcher(url, { headers: { authorization: `Bearer ${input.apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return null
      return normalizeTrainsBetween(await response.json(), origin, destination)
    }))
    if (routeResults.some((result) => result === null)) {
      return { status: 'unavailable', candidates: [], message: 'RailRadar train search is unavailable.' }
    }

    return identifyTrainCandidate(routeResults.flatMap((result) => result ?? []), { ...input.evidence, providerTrainNumber })
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError'
    return {
      status: 'unavailable',
      candidates: [],
      message: timeout ? 'RailRadar train identification timed out.' : 'RailRadar train identification could not be completed.',
    }
  }
}