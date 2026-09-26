import fs from 'node:fs'
import path from 'node:path'
import { calculateImpact, type ImpactDisruption, type ImpactSegment } from '../src/services/impactService'

const results: { name: string; passed: boolean }[] = []
const check = (name: string, passed: boolean) => {
  results.push({ name, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`)
}

let counter = 0
function segment(departure: string | null, arrival: string | null, overrides: Partial<ImpactSegment> = {}): ImpactSegment {
  counter += 1
  return {
    id: `segment-${counter}`,
    departure_at: departure,
    arrival_at: arrival,
    fare_amount: 100,
    fare_currency: 'INR',
    booking_status: 'confirmed',
    passenger_travel_status: 'unknown',
    ...overrides,
  }
}

function disruption(segmentId: string, overrides: Partial<ImpactDisruption> = {}): ImpactDisruption {
  return {
    id: 'disruption-1',
    segment_id: segmentId,
    trip_id: 'trip-1',
    kind: 'delay',
    delay_minutes: 30,
    original_departure_at: null,
    original_arrival_at: null,
    revised_departure_at: null,
    revised_arrival_at: null,
    cancellation_at: null,
    reported_at: '2026-09-26T10:00:00Z',
    ...overrides,
  }
}

const first = segment('2026-09-26T08:00:00Z', '2026-09-26T10:00:00Z')
const next = segment('2026-09-26T12:00:00Z', '2026-09-26T14:00:00Z')
const final = segment('2026-09-26T16:00:00Z', '2026-09-26T18:00:00Z')

check('no disruption preserves final arrival', calculateImpact([first, next], null).projectedFinalArrivalAt === next.arrival_at)
check('30-minute delay derives revised arrival', calculateImpact([first, next], disruption(first.id)).revisedArrivalAt === '2026-09-26T10:30:00.000Z')
check('large delay reports delay duration', calculateImpact([first, next], disruption(first.id, { delay_minutes: 210 })).delayMinutes === 210)
check('final segment delay is identified', calculateImpact([first], disruption(first.id)).disruptedSegmentIsFinal)
check('delay causing missed connection is detected', calculateImpact([first, next], disruption(first.id, { delay_minutes: 180 })).connectionAfterDisruption.status === 'connection_missed')
check('delay preserving connection is at risk but not missed', calculateImpact([first, next], disruption(first.id)).connectionAfterDisruption.status === 'connection_at_risk')
check(
  'multiple downstream segments are returned',
  calculateImpact([first, next, final], disruption(first.id, { delay_minutes: 180 })).downstreamAffectedSegmentIds.length === 2,
)
check(
  'cancellation affects downstream without inventing arrival',
  calculateImpact([first, next], disruption(first.id, { kind: 'cancellation', delay_minutes: null })).revisedArrivalAt === null &&
    calculateImpact([first, next], disruption(first.id, { kind: 'cancellation', delay_minutes: null })).downstreamAffectedSegmentIds.includes(next.id),
)
check(
  'missing arrival is explicit',
  (() => {
    const missingArrival = segment('2026-09-26T08:00:00Z', null)
    return calculateImpact([missingArrival, next], disruption(missingArrival.id)).missingInformation.includes('original arrival time')
  })(),
)
check(
  'missing next departure is explicit',
  calculateImpact([first, segment(null, '2026-09-26T14:00:00Z')], disruption(first.id)).missingInformation.includes('next departure time'),
)
check(
  'unknown segment relationship is explicit',
  calculateImpact([first, next], disruption('not-in-itinerary')).status === 'insufficient_information',
)

const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0007_disruption_impact.sql'), 'utf8')
check('wrong-user disruption insert is blocked by ownership RLS', /t\.profile_id = \(select auth\.uid\(\)\)/.test(migration))
check('segment and trip ownership is checked by a database trigger', /validate_disruption_ownership/.test(migration) && /segment does not belong to the disruption trip/.test(migration))

const failed = results.filter((result) => !result.passed)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)