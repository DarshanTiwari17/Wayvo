import fs from 'node:fs'
import path from 'node:path'
import { fetchRailRadarStatus, hasMeaningfulOperationalChange, hasOperationalDisruption, isOperationalStatusStale, normalizeRailRadarResponse, shouldPersistDisruption, shouldResolveDisruption } from '../supabase/functions/_shared/railradar'
import { calculateImpact } from '../src/services/impactService'
import { evaluateRefundEligibility, type RefundPolicy } from '../src/services/refundPolicyService'
import { existingJourneyTrainNumber, findImportedTrainNumber, identifyRailRadarTrain, identifyTrainCandidate, normalizeRailRadarStations, resolveRailRadarStations, type TrainCandidate } from '../supabase/functions/_shared/railradarIdentification'

const results: { name: string; passed: boolean }[] = []
const check = (name: string, passed: boolean) => {
  results.push({ name, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`)
}

const live = normalizeRailRadarResponse({
  data: {
    train_number: '12951',
    train_name: 'Mumbai Rajdhani',
    status: 'running',
    delay_minutes: 0,
    current_station: { name: 'Ujjain Junction' },
    next_station: { name: 'Bhopal Junction' },
    expected_arrival: '2026-09-27T16:20:00+05:30',
    platform: '2',
    last_updated_at: '2026-09-27T10:00:00Z',
  },
}, '12951')
check('normalizes train identity, station telemetry, expected time, platform, and timestamp',
  live.trainNumber === '12951' && live.trainName === 'Mumbai Rajdhani' && live.currentStation === 'Ujjain Junction' &&
  live.nextHalt === 'Bhopal Junction' && live.expectedArrival === '2026-09-27T10:50:00.000Z' && live.platform === '2' && live.source === 'railradar')
check('normalizes a valid on-time status', live.status === 'running' && live.delayMinutes === 0 && !live.cancelled)
check('normalizes a delayed train without applying policy thresholds', normalizeRailRadarResponse({ delayMinutes: 194 }, '12951').status === 'delayed')
check('normalizes cancellation', normalizeRailRadarResponse({ status: 'cancelled' }, '12951').cancelled)
check('normalizes diversion and factual exceptions', (() => {
  const status = normalizeRailRadarResponse({ status: 'diverted', exceptions: ['Train diverted via Bina'] }, '12951')
  return status.diverted && status.exceptions[0]?.detail === 'Train diverted via Bina'
})())
check('maps documented currentLocation stationCode through RailRadar route names and honors exception types', (() => {
  const status = normalizeRailRadarResponse({
    status: 'running',
    currentLocation: { stationCode: 'ABC' },
    route: [{ stationCode: 'ABC', stationName: 'Provider Station Name' }],
    exceptions: [{ type: 'DIVERTED', message: 'Provider reports route diversion.' }],
  }, 'service-from-test')
  return status.currentLocation === 'Provider Station Name' && status.diverted && status.exceptions[0]?.detail === 'Provider reports route diversion.'
})())
check('missing train number is not invented', (await fetchRailRadarStatus({ trainNumber: ' ', journeyDate: '2026-09-27' }, 'secret')).reason === 'error')
check('provider unavailable is distinct from valid status', (await fetchRailRadarStatus(
  { trainNumber: '12951', journeyDate: '2026-09-27' }, 'secret',
  async () => new Response('{}', { status: 503 }),
)).reason === 'unavailable')
check('provider timeout/error is reported without throwing', (await fetchRailRadarStatus(
  { trainNumber: '12951', journeyDate: '2026-09-27' }, 'secret',
  async () => { throw new DOMException('timed out', 'TimeoutError') },
)).reason === 'timeout')
check('provider timestamps determine staleness', isOperationalStatusStale({ providerTimestamp: '2026-09-27T09:00:00Z' }, Date.parse('2026-09-27T09:20:00Z'), 600))
check('missing provider timestamps are stale', isOperationalStatusStale({ providerTimestamp: null }))
check('same operational state with newer telemetry is not a meaningful event', !hasMeaningfulOperationalChange(live, { ...live, providerTimestamp: '2026-09-27T10:05:00.000Z', currentLocation: 'Between stations' }))
check('changed delay is a meaningful state change', hasMeaningfulOperationalChange(live, normalizeRailRadarResponse({ status: 'delayed', delayMinutes: 65 }, '12951')))
check('on-time state does not create a disruption', !hasOperationalDisruption(live))
check('provider-reported delay creates a factual disruption without a policy cutoff', hasOperationalDisruption(normalizeRailRadarResponse({ delayMinutes: 1 }, '12951')))
check('same disruption state with an open event does not create a duplicate', !shouldPersistDisruption({ status: normalizeRailRadarResponse({ delayMinutes: 20 }, '12951'), isStale: false, changed: false, currentDisruptionId: 'event-1' }))
check('changed operational state updates the existing event', shouldPersistDisruption({ status: normalizeRailRadarResponse({ delayMinutes: 65 }, '12951'), isStale: false, changed: true, currentDisruptionId: 'event-1' }))
check('stale provider data never creates a disruption', !shouldPersistDisruption({ status: normalizeRailRadarResponse({ status: 'cancelled' }, '12951'), isStale: true, changed: true, currentDisruptionId: null }))
check('a fresh return to normal resolves the open event', shouldResolveDisruption({ status: live, isStale: false, currentDisruptionId: 'event-1' }))

const delayedStatus = normalizeRailRadarResponse({ status: 'delayed', delayMinutes: 194 }, '12951')
const impact = calculateImpact([
  { id: 'segment-1', departure_at: '2026-09-27T08:00:00Z', arrival_at: '2026-09-27T10:00:00Z', fare_amount: 1000, fare_currency: 'INR', booking_status: 'confirmed', passenger_travel_status: 'not_travelled' },
], {
  id: 'disruption-1', segment_id: 'segment-1', trip_id: 'trip-1', kind: 'delay', delay_minutes: delayedStatus.delayMinutes,
  original_departure_at: null, original_arrival_at: null, revised_departure_at: null, revised_arrival_at: null,
  cancellation_at: null, reported_at: '2026-09-27T10:00:00Z',
})
check('existing impact engine receives the normalized provider delay', impact.delayMinutes === 194)

const policy: RefundPolicy = {
  id: 'policy-1', transportMode: 'train', provider: 'Railways', name: 'Delay policy', version: '1',
  effectiveFrom: '2026-01-01', source: 'provider policy', status: 'active',
  rules: [{ type: 'min_delay_minutes', value: 180 }],
  amount: { type: 'full_fare' }, claimDeadlineDays: null, requiredEvidence: [], summary: '',
  applicableDisruptionTypes: ['delay'], eligibilityConditions: [], exclusions: [], claimMethod: null,
}
const eligibility = evaluateRefundEligibility({
  segment: { transport_mode: 'train', operator_name: 'Railways', booking_status: 'confirmed', fare_amount: 1000, fare_currency: 'INR', passenger_travel_status: 'not_travelled' },
  disruption: { kind: 'delay', delay_minutes: delayedStatus.delayMinutes, reported_at: '2026-09-27T10:00:00Z', resolved_at: null },
  policy,
  evaluatedAt: '2026-09-27T10:01:00Z',
})
check('existing policy engine determines eligibility from the observed provider fact', eligibility.status === 'eligible' && eligibility.amount === 1000)

const monitoringSource = [
  'supabase/functions/railradar/index.ts',
  'supabase/functions/_shared/railradar.ts',
  'supabase/functions/_shared/railradarEvaluation.ts',
  'supabase/functions/_shared/railradarIdentification.ts',
].map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')).join('\n')
check('monitoring code has no embedded refund-delay threshold', !/(?:delayMinutes|delay_minutes)\s*(?:>=\s*180|>=?\s*3\s*\*\s*60)|3\s*\*\s*60/.test(monitoringSource))

const stationRows = normalizeRailRadarStations({ success: true, data: [
  { code: 'AAA', name: 'Origin Station', city: 'Origin City' },
  { code: 'AAB', name: 'Origin East', city: 'Origin City' },
  { code: 'MUM-C', name: 'Mumbai Central', city: 'Mumbai' },
  { code: 'MUM-B', name: 'Bandra Terminus', city: 'Mumbai' },
] }) ?? []
check('normalizes RailRadar station lookup results', stationRows.length === 4)
check('resolves exact station names and city-wide matches without a hardcoded mapping',
  resolveRailRadarStations('Origin Station', stationRows).map((station) => station.code).join(',') === 'AAA' &&
  resolveRailRadarStations('Origin City', stationRows).length === 2 &&
  resolveRailRadarStations('Mumbai Central', stationRows).map((station) => station.code).join(',') === 'MUM-C' &&
  resolveRailRadarStations('Mumbai', stationRows).length === 2 &&
  resolveRailRadarStations('Origin Station (AAA)', stationRows).map((station) => station.code).join(',') === 'AAA')

const journeyCandidates: TrainCandidate[] = [
  { trainNumber: 'T-A', trainName: 'North Express', departure: '08:10', arrival: '14:20', arrivalDayOffset: 0, originCode: 'AAA', originName: 'Origin Station', destinationCode: 'BBB', destinationName: 'Destination Station' },
  { trainNumber: 'T-B', trainName: 'West Express', departure: '09:10', arrival: '15:20', arrivalDayOffset: 0, originCode: 'AAA', originName: 'Origin Station', destinationCode: 'BBB', destinationName: 'Destination Station' },
]
check('a unique exact departure and arrival safely identifies one candidate',
  identifyTrainCandidate(journeyCandidates, { departureAt: '2026-09-27T08:10:00', arrivalAt: '2026-09-27T14:20:00' }).status === 'identified')
check('multiple unfiltered candidates remain ambiguous', identifyTrainCandidate(journeyCandidates, {}).status === 'ambiguous')
check('no candidates returns not_found', identifyTrainCandidate([], {}).status === 'not_found')
check('booking payload service number is recovered from existing segment data',
  findImportedTrainNumber({ booking: { trainNumber: 'T-A' } }) === 'T-A')
check('existing segment train number takes precedence without searching',
  existingJourneyTrainNumber('T-A', 'booking_import', {}).trainNumber === 'T-A' &&
  !existingJourneyTrainNumber('T-A', 'booking_import', {}).recoveredFromPayload)
check('one train after route/date filtering is identified automatically',
  identifyTrainCandidate([journeyCandidates[0]], {}).status === 'identified')
check('conflicting departure and arrival facts never identify a train',
  identifyTrainCandidate(journeyCandidates, { departureAt: '2026-09-27T08:10:00', arrivalAt: '2026-09-27T15:20:00' }).status === 'ambiguous')
check('overnight service-day offsets participate in deterministic matching',
  identifyTrainCandidate([
    { ...journeyCandidates[0], trainNumber: 'T-C', departure: '22:10', arrival: '05:20', arrivalDayOffset: 0 },
    { ...journeyCandidates[1], trainNumber: 'T-D', departure: '22:10', arrival: '05:20', arrivalDayOffset: 1 },
  ], { departureAt: '2026-09-27T22:10:00', arrivalAt: '2026-09-28T05:20:00' }).status === 'identified')

const discoveryRequests: string[] = []
const discovery = await identifyRailRadarTrain({
  origin: 'Origin Station',
  destination: 'Destination Station',
  journeyDate: '2026-09-27',
  evidence: { departureAt: '2026-09-27T08:10:00', arrivalAt: '2026-09-27T14:20:00' },
  apiKey: 'test-only',
  fetcher: async (input) => {
    const url = String(input)
    discoveryRequests.push(url)
    if (url.includes('/lookup/search/stations')) {
      const query = new URL(url).searchParams.get('q')
      const station = query === 'Origin Station'
        ? { code: 'AAA', name: 'Origin Station', city: 'Origin City' }
        : { code: 'BBB', name: 'Destination Station', city: 'Destination City' }
      return new Response(JSON.stringify({ success: true, data: [station] }))
    }
    return new Response(JSON.stringify({
      success: true,
      data: { trains: journeyCandidates.map((candidate) => ({
        train: { number: candidate.trainNumber, name: candidate.trainName },
        from: { departure: candidate.departure, day: 1 },
        to: { arrival: candidate.arrival, day: (candidate.arrivalDayOffset ?? 0) + 1 },
      })) },
    }))
  },
})
check('discovery resolves stations and filters the train search by date with live status',
  discovery.status === 'identified' && discoveryRequests.some((url) => url.includes('/trains/between/AAA/BBB?date=2026-09-27&live=true')))
check('provider search failure returns unavailable', (await identifyRailRadarTrain({
  origin: 'Origin Station', destination: 'Destination Station', journeyDate: '2026-09-27', evidence: {}, apiKey: 'test-only',
  fetcher: async () => new Response('{}', { status: 503 }),
})).status === 'unavailable')

const pnrRequests: string[] = []
const pnrDiscovery = await identifyRailRadarTrain({
  origin: 'Origin Station', destination: 'Destination Station', journeyDate: '2026-09-27',
  evidence: { pnr: '1234567890' }, apiKey: 'test-only',
  fetcher: async (input) => {
    const url = String(input)
    pnrRequests.push(url)
    if (url.includes('/pnr/')) return new Response(JSON.stringify({ success: true, data: { train: { number: 'T-B' }, journey: { date: '2026-09-27' } } }))
    if (url.includes('/lookup/search/stations')) {
      const query = new URL(url).searchParams.get('q')
      return new Response(JSON.stringify({ success: true, data: [query === 'Origin Station'
        ? { code: 'AAA', name: 'Origin Station', city: 'Origin City' }
        : { code: 'BBB', name: 'Destination Station', city: 'Destination City' }] }))
    }
    return new Response(JSON.stringify({ success: true, data: { trains: journeyCandidates.map((candidate) => ({
      train: { number: candidate.trainNumber, name: candidate.trainName },
      from: { departure: candidate.departure, day: 1 }, to: { arrival: candidate.arrival, day: (candidate.arrivalDayOffset ?? 0) + 1 },
    })) } }))
  },
})
check('provider PNR result is used only when its journey date matches',
  pnrDiscovery.status === 'identified' && pnrDiscovery.status === 'identified' && pnrDiscovery.candidate.trainNumber === 'T-B' && pnrRequests.some((url) => url.includes('/pnr/')))

const mismatchedPnrDiscovery = await identifyRailRadarTrain({
  origin: 'Origin Station', destination: 'Destination Station', journeyDate: '2026-09-27',
  evidence: { pnr: '1234567890', departureAt: '2026-09-27T08:10:00' }, apiKey: 'test-only',
  fetcher: async (input) => {
    const url = String(input)
    if (url.includes('/pnr/')) return new Response(JSON.stringify({ success: true, data: { train: { number: 'T-B' }, journey: { date: '2026-09-28' } } }))
    if (url.includes('/lookup/search/stations')) {
      const query = new URL(url).searchParams.get('q')
      return new Response(JSON.stringify({ success: true, data: [query === 'Origin Station'
        ? { code: 'AAA', name: 'Origin Station', city: 'Origin City' }
        : { code: 'BBB', name: 'Destination Station', city: 'Destination City' }] }))
    }
    return new Response(JSON.stringify({ success: true, data: { trains: journeyCandidates.map((candidate) => ({
      train: { number: candidate.trainNumber, name: candidate.trainName },
      from: { departure: candidate.departure, day: 1 }, to: { arrival: candidate.arrival, day: (candidate.arrivalDayOffset ?? 0) + 1 },
    })) } }))
  },
})
check('PNR train from another travel date is not used',
  mismatchedPnrDiscovery.status === 'identified' && mismatchedPnrDiscovery.candidate.trainNumber === 'T-A')

let liveRequest = ''
await fetchRailRadarStatus({ trainNumber: 'T-A', journeyDate: '2026-09-27' }, 'test-only', async (input) => {
  liveRequest = String(input)
  return new Response(JSON.stringify({ success: true, data: { trainNumber: 'T-A', status: 'running', lastUpdatedAt: '2026-09-27T10:00:00Z' } }))
})
check('live status request includes the existing journey date', new URL(liveRequest).searchParams.get('date') === '2026-09-27')

const identificationSource = fs.readFileSync(path.resolve(process.cwd(), 'supabase/functions/railradar/index.ts'), 'utf8')
check('identified train number is persisted to the existing journey_segments row with provenance',
  /journey_segments\?id=eq/.test(identificationSource) && /service_number_source: source/.test(identificationSource))
check('identified segment immediately enters the existing live-status path', /await fetchRailRadarStatus\(\{ trainNumber, journeyDate: date \}/.test(identificationSource))
check('identification uses no hardcoded train number', !/\b\d{5}\b/.test(identificationSource))

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)