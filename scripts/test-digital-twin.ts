/**
 * Digital twin model tests.
 *
 * These are not smoke tests. The twin's whole value is that its numbers agree
 * with each other, so most of what is asserted here are *invariants* that must
 * hold for every possible input — checked by sweeping the entire input space
 * rather than by picking a few lucky examples.
 *
 * Run with `npm run test:digital-twin`.
 */
import assert from 'node:assert/strict'
import {
  DURATION_RANGE,
  GENERIC_CORRIDORS,
  MAX_DELAY_RATIO,
  SCENARIO_PRESETS,
  TEMPERATURE_RANGE,
  WEATHER_INTENSITY_OPTIONS,
  buildScenarioSummary,
  calculateDigitalTwinSimulation,
  connectionStatusLabel,
  describeCurrentState,
  distributeInteger,
  formatMinutes,
  routeStatusLabel,
  temperatureEffect,
  weatherIntensityTitle,
  type DigitalTwinSimulation,
  type TwinCorridorInput,
  type TwinScenario,
  type WeatherIntensity,
} from '../src/features/digital-twin/digitalTwin'
import { baselineForTrip, minutesBetween, systemBaseline, ESTIMATED_BASELINE_MINUTES } from '../src/features/digital-twin/twinBaseline'
import { sanitiseScenario } from '../src/features/digital-twin/useDigitalTwin'
import { assumedExposureHours, classifyObservation, rainfallRate } from '../src/features/digital-twin/weatherAdapter'
import type { JourneySegment, Trip } from '../src/types/database'

let checks = 0
function check(label: string, run: () => void): void {
  try {
    run()
    checks += 1
  } catch (cause) {
    console.error(`\n  FAIL  ${label}`)
    throw cause
  }
}

const INTENSITIES: WeatherIntensity[] = WEATHER_INTENSITY_OPTIONS.map((option) => option.value)

/** So risk levels can be compared without hard-coding the bands. */
const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const

function run(
  overrides: Partial<{
    baselineTravelMinutes: number
    weatherIntensity: WeatherIntensity
    durationHours: number
    temperatureC: number
    location: string
    corridors: TwinCorridorInput[]
  }> = {},
): DigitalTwinSimulation {
  return calculateDigitalTwinSimulation({
    baselineTravelMinutes: overrides.baselineTravelMinutes ?? 35,
    scenario: {
      weatherIntensity: overrides.weatherIntensity ?? 'heavy',
      durationHours: overrides.durationHours ?? 3,
      temperatureC: overrides.temperatureC ?? 17,
      location: overrides.location ?? 'Central District',
    },
    corridors: overrides.corridors,
  })
}

/* ==========================================================================
   1. The documented headline case
   ========================================================================== */

check('heavy rain for 3h at 17°C matches the reference result', () => {
  const result = run({ baselineTravelMinutes: 35, weatherIntensity: 'heavy', durationHours: 3, temperatureC: 17 })
  assert.equal(result.weatherChange, 'Heavy rain for 3h at 17°C in Central District')
  assert.equal(result.baselineTravelMinutes, 35)
  assert.ok(result.simulatedTravelMinutes > 35, 'simulated time must exceed the baseline')
  assert.equal(result.routeStatus, 'affected')
  assert.equal(result.riskLevel, 'high')
  assert.ok(result.disruptions.length > 0, 'heavy rain must produce disruptions')
})

/* ==========================================================================
   2. Invariants across the entire input space
   ========================================================================== */

const BASELINES = [1, 5, 20, 35, 60, 180, 600, 1440]
const CORRIDOR_SETS: Array<[string, TwinCorridorInput[] | undefined]> = [
  ['generic', undefined],
  [
    'three timed legs',
    [
      { id: 'a', label: 'Lisbon → Porto', baseMinutes: 165, connectionMinutes: 25 },
      { id: 'b', label: 'Porto → Vigo', baseMinutes: 95, connectionMinutes: 15 },
      { id: 'c', label: 'Vigo → Madrid', baseMinutes: 260, connectionMinutes: null },
    ],
  ],
  [
    'many short legs',
    [
      { id: '1', label: 'Walk to stop', baseMinutes: 8, connectionMinutes: null },
      { id: '2', label: 'Bus 12', baseMinutes: 22, connectionMinutes: 5 },
      { id: '3', label: 'Bus 44', baseMinutes: 17, connectionMinutes: 5 },
      { id: '4', label: 'Walk to hotel', baseMinutes: 11, connectionMinutes: null },
      { id: '5', label: 'Overnight ferry', baseMinutes: 600, connectionMinutes: 40 },
    ],
  ],
  [
    'unweighted, untimed legs',
    [
      { id: 'x', label: 'Leg A' },
      { id: 'y', label: 'Leg B' },
    ],
  ],
  ['empty list falls back to the generic network', []],
]

let swept = 0
for (const baseline of BASELINES) {
  for (const intensity of INTENSITIES) {
    for (let duration = DURATION_RANGE.min; duration <= DURATION_RANGE.max; duration += DURATION_RANGE.step) {
      for (let temperature = TEMPERATURE_RANGE.min; temperature <= TEMPERATURE_RANGE.max; temperature += 3) {
        for (const [setName, corridors] of CORRIDOR_SETS) {
          const result = run({ baselineTravelMinutes: baseline, weatherIntensity: intensity, durationHours: duration, temperatureC: temperature, corridors })
          swept += 1

          // -- the headline figure is a real increase, never a decrease
          assert.ok(
            result.simulatedTravelMinutes >= result.baselineTravelMinutes,
            `travel time went backwards (${setName}, baseline ${baseline}, ${intensity}, ${duration}h, ${temperature}C)`,
          )
          assert.equal(
            result.simulatedTravelMinutes,
            result.baselineTravelMinutes + result.delayMinutes,
            'simulated time must be baseline + delay',
          )

          // -- the breakdown must sum to the headline delay, exactly
          const corridorTotal = result.corridors.reduce((sum, corridor) => sum + corridor.delayMinutes, 0)
          assert.equal(
            corridorTotal,
            result.delayMinutes,
            `corridor delays (${corridorTotal}) must sum to the headline delay (${result.delayMinutes}) — ${setName}, baseline ${baseline}, ${intensity}, ${duration}h, ${temperature}C`,
          )

          // -- every corridor is internally consistent
          for (const corridor of result.corridors) {
            assert.equal(corridor.simulatedMinutes, corridor.baseMinutes + corridor.delayMinutes, 'corridor time must be base + delay')
            assert.ok(corridor.delayMinutes >= 0, 'corridor delay must never be negative')
            assert.ok(corridor.status === 'normal' || corridor.delayMinutes > 0, 'a delayed corridor must carry a delay')
          }

          // -- disruptions only ever cite delay that actually exists
          for (const disruption of result.disruptions) {
            assert.ok(disruption.delayMinutes > 0, 'a disruption must quote a positive delay')
            assert.ok(
              result.corridors.some((corridor) => corridor.delayMinutes >= disruption.delayMinutes),
              'a disruption delay must be covered by some corridor',
            )
          }
          assert.equal(result.disruptions.length, result.disruptionCount, 'disruptionCount must match the list')

          // -- risk and status agree with each other
          if (result.riskLevel === 'critical') assert.equal(result.routeStatus, 'critical', 'critical risk must be a critical network')
          if (result.riskLevel === 'low') assert.equal(result.routeStatus, 'normal', 'low risk must be a normal network')

          // -- resilience is the documented complement of risk
          assert.equal(result.resilienceScore, Math.max(0, Math.min(100, Math.round(100 - result.riskScore))), 'resilience must be 100 - risk')
          assert.ok(result.riskScore >= 0 && result.riskScore <= 100, 'risk score must be 0-100')

          // -- connections
          const atRisk = result.corridors.filter((c) => c.connectionStatus === 'at-risk' || c.connectionStatus === 'broken')
          assert.equal(result.atRiskConnections, atRisk.length, 'atRiskConnections must match the corridors')
          assert.equal(
            result.brokenConnections,
            result.corridors.filter((c) => c.connectionStatus === 'broken').length,
            'brokenConnections must match the corridors',
          )
          for (const corridor of result.corridors) {
            if (corridor.connectionStatus === 'broken') {
              assert.ok(corridor.delayMinutes >= (corridor.connectionMinutes ?? 0), 'a lost connection must be fully eaten')
            }
          }

          // -- nothing is emitted while the network is genuinely fine
          if (result.delayMinutes === 0) {
            assert.equal(result.disruptions.length, 0, 'no delay must mean no disruptions')
            assert.equal(result.riskLevel, 'low', 'no delay must mean low risk')
            assert.equal(result.routeStatus, 'normal', 'no delay must mean a normal network')
            assert.ok(result.resilienceScore >= 83, 'a hazard-only risk score must still leave most of the resilience intact')
            assert.ok(
              result.recommendedBufferMinutes === 0 || result.hazards.length > 0,
              'a buffer with no delay is only allowed when a hazard justifies it',
            )
            for (const corridor of result.corridors) {
              assert.equal(corridor.status, 'normal', 'a corridor with no delay can never be affected or critical')
            }
          }

          // -- buffer never exceeds the delay it is meant to absorb by much
          if (result.delayMinutes > 0) {
            assert.ok(result.recommendedBufferMinutes > 0, 'a delayed trip needs a buffer')
            assert.ok(
              result.recommendedBufferMinutes <= result.delayMinutes + 40,
              'the recommended buffer must stay in proportion to the delay',
            )
          }

          // -- always actionable
          assert.ok(result.actions.length > 0, 'every scenario must produce at least one action')
          assert.ok(result.impactSummary.length > 0, 'every scenario needs an impact summary')
          assert.ok(result.alternativeRoute.length > 0, 'every scenario needs a route adaptation')
          assert.ok(result.recoveryPlan.length > 0, 'every scenario needs a recovery plan')

          // -- copy-pasteable summary stays in step with the model
          const summary = buildScenarioSummary(result, 'test scope')
          assert.ok(summary.includes(routeStatusLabel(result.routeStatus)), 'summary must state the route status')
          assert.ok(summary.includes(String(result.resilienceScore)), 'summary must state the resilience score')
          assert.ok(summary.includes(result.weatherChange), 'summary must state the scenario')
        }
      }
    }
  }
}
console.log(`  swept ${swept.toLocaleString('en-GB')} scenario/corridor combinations`)

/* ==========================================================================
   3. Monotonicity — more of anything should never make things better
   ========================================================================== */

check('more rain never reduces the delay', () => {
  let previous = -1
  for (const intensity of INTENSITIES) {
    const delay = run({ weatherIntensity: intensity }).delayMinutes
    assert.ok(delay >= previous, `delay fell going from the previous intensity to ${intensity}`)
    previous = delay
  }
})

check('longer exposure never reduces the delay', () => {
  let previous = -1
  for (let duration = DURATION_RANGE.min; duration <= DURATION_RANGE.max; duration += 1) {
    const delay = run({ weatherIntensity: 'moderate', durationHours: duration }).delayMinutes
    assert.ok(delay >= previous, `delay fell at ${duration}h`)
    previous = delay
  }
})

check('exposure saturates instead of growing without limit', () => {
  const hour1 = run({ weatherIntensity: 'extreme', durationHours: 1 }).delayMinutes
  const hour12 = run({ weatherIntensity: 'extreme', durationHours: 12 }).delayMinutes
  assert.ok(hour1 > 0, 'extreme rain must cost something after one hour')
  // Eleven extra hours may not be allowed to double a twelve-fold exposure.
  assert.ok(hour12 < hour1 * 2, 'exposure should saturate, not scale linearly')
})

check('clear weather costs nothing however long it lasts', () => {
  for (let duration = DURATION_RANGE.min; duration <= DURATION_RANGE.max; duration += 1) {
    const result = run({ weatherIntensity: 'none', temperatureC: 17, durationHours: duration })
    assert.equal(result.delayMinutes, 0, `12 hours of clear weather must not add delay (checked ${duration}h)`)
  }
})

check('colder and hotter both cost time, the middle does not', () => {
  const cold = run({ weatherIntensity: 'moderate', temperatureC: -8 }).delayMinutes
  const mild = run({ weatherIntensity: 'moderate', temperatureC: 15 }).delayMinutes
  const hot = run({ weatherIntensity: 'moderate', temperatureC: 38 }).delayMinutes
  assert.ok(cold > mild, 'freezing wet roads must be slower than mild ones')
  assert.ok(hot > mild, 'extreme heat must be slower than mild temperatures')
})

check('a longer trip absorbs a longer delay', () => {
  const short = run({ baselineTravelMinutes: 20, weatherIntensity: 'heavy' })
  const long = run({ baselineTravelMinutes: 400, weatherIntensity: 'heavy' })
  assert.ok(long.delayMinutes > short.delayMinutes, 'a 400 minute trip must lose more minutes than a 20 minute one')
  // Delays are whole minutes, so the percentage can wobble by up to a few
  // points on a very short trip. It must not scale with the trip length.
  assert.ok(
    Math.abs(long.delayPercent - short.delayPercent) <= 3,
    `the percentage penalty must not depend on the length of the trip (${short.delayPercent}% vs ${long.delayPercent}%)`,
  )
})

/* ==========================================================================
   4. Clear conditions
   ========================================================================== */

check('no rain and a mild temperature changes nothing at all', () => {
  const result = run({ weatherIntensity: 'none', temperatureC: 17, durationHours: 3 })
  assert.equal(result.delayMinutes, 0)
  assert.equal(result.simulatedTravelMinutes, result.baselineTravelMinutes)
  assert.equal(result.routeStatus, 'normal')
  assert.equal(result.riskLevel, 'low')
  assert.equal(result.resilienceScore, 100)
  assert.equal(result.disruptions.length, 0)
  assert.equal(result.recommendedBufferMinutes, 0)
  assert.ok(result.hazards.length === 0, 'a mild clear day has no hazards')
  assert.equal(result.weatherChange, 'Clear conditions for 3h at 17°C in Central District')
  assert.ok(!result.weatherChange.includes('None rain'), 'never render "None rain"')
  assert.deepEqual(
    result.corridors.map((corridor) => corridor.status),
    result.corridors.map(() => 'normal'),
  )
})

check('a hard freeze still costs time even with no rain falling', () => {
  const result = run({ weatherIntensity: 'none', temperatureC: -10 })
  assert.ok(result.delayMinutes > 0, 'black ice is a real hazard with clear skies')
  assert.ok(result.hazards.includes('ice'), 'the ice hazard must be reported')
  assert.equal(result.riskLevel, 'medium')
})

/* ==========================================================================
   5. Risk bands
   ========================================================================== */

check('risk rises with the modelled outcome, not just the weather dial', () => {
  const brief = run({ weatherIntensity: 'heavy', durationHours: 1 })
  const long = run({ weatherIntensity: 'heavy', durationHours: 12 })
  assert.ok(long.riskScore > brief.riskScore, 'a 12 hour storm must outscore a 1 hour one')
  assert.ok(
    long.riskLevel === 'critical' || long.riskLevel === 'high',
    'a 12 hour heavy storm must be high or critical',
  )
})

check('threatened connections raise the risk score', () => {
  const roomy = run({ corridors: [{ id: 'a', label: 'A', baseMinutes: 120, connectionMinutes: 240 }] })
  const tight = run({ corridors: [{ id: 'a', label: 'A', baseMinutes: 120, connectionMinutes: 4 }] })
  assert.ok(tight.riskScore > roomy.riskScore, 'a 4 minute changeover must be riskier than a 4 hour one')
  assert.equal(roomy.atRiskConnections, 0, 'a 4 hour changeover survives')
  assert.ok(tight.brokenConnections > 0, 'a 4 minute changeover is lost')
})

check('the headline scenarios land in the documented bands', () => {
  assert.equal(run({ weatherIntensity: 'none', temperatureC: 17 }).riskLevel, 'low')
  assert.equal(run({ weatherIntensity: 'light', temperatureC: 17 }).riskLevel, 'medium')
  assert.equal(run({ weatherIntensity: 'moderate', temperatureC: 17 }).riskLevel, 'medium')
  assert.equal(run({ weatherIntensity: 'heavy', temperatureC: 17 }).riskLevel, 'high')
  assert.equal(run({ weatherIntensity: 'extreme', temperatureC: 17 }).riskLevel, 'critical')
})

/* ==========================================================================
   6. Graceful degradation — bad input must not produce NaN
   ========================================================================== */

check('nonsense input degrades to a usable simulation instead of NaN', () => {
  const result = calculateDigitalTwinSimulation({
    baselineTravelMinutes: Number.NaN,
    scenario: {
      weatherIntensity: 'apocalyptic' as WeatherIntensity,
      durationHours: 9_999,
      temperatureC: -900,
      location: '   ',
    },
  })
  for (const value of [result.simulatedTravelMinutes, result.delayMinutes, result.delayPercent, result.riskScore, result.resilienceScore]) {
    assert.ok(Number.isFinite(value), 'every headline number must be finite')
  }
  assert.ok(result.baselineTravelMinutes > 0, 'the baseline must never collapse to zero')
  assert.equal(result.scenario.weatherIntensity, 'heavy', 'an unknown intensity falls back to the default')
  assert.equal(result.scenario.durationHours, DURATION_RANGE.max, 'an absurd duration clamps to the maximum')
  assert.equal(result.scenario.temperatureC, TEMPERATURE_RANGE.min, 'an absurd temperature clamps to the minimum')
  assert.equal(result.scenario.location, 'Central District', 'a blank location falls back to the default')
  assert.ok(result.corridors.length > 0, 'there is always at least one corridor to report')
  assert.equal(result.corridors.length, GENERIC_CORRIDORS.length, 'a missing corridor set falls back to the generic network')
})

check('a zero-length baseline is still modelled', () => {
  const result = run({ baselineTravelMinutes: 0 })
  assert.equal(result.baselineTravelMinutes, 1, 'the baseline is floored at one minute so percentages stay finite')
  assert.ok(Number.isFinite(result.delayPercent), 'the percentage must be a number, not Infinity')
  assert.ok(result.delayPercent <= 100 * MAX_DELAY_RATIO + 100, 'the percentage must stay bounded')
  assert.ok(Number.isFinite(result.riskScore))
  assert.equal(
    result.corridors.reduce((sum, corridor) => sum + corridor.delayMinutes, 0),
    result.delayMinutes,
    'a one minute baseline must still be internally consistent',
  )
})

check('corridors with unusable data are dropped, not rendered blank', () => {
  const result = run({ corridors: [{ id: '', label: 'broken' }, { id: 'ok', label: 'Real leg', baseMinutes: 60 }] })
  assert.equal(result.corridors.length, 1, 'an entry with no id is not a corridor')
  assert.equal(result.corridors[0].label, 'Real leg')
})

/* ==========================================================================
   7. Integer distribution
   ========================================================================== */

check('distributeInteger always sums to the total', () => {
  const cases: Array<[number, number[]]> = [
    [0, [1, 1, 1]],
    [1, [1, 1, 1]],
    [2, [1, 1, 1]],
    [7, [0.2, 0.3, 0.25, 0.25]],
    [100, [1, 1, 1]],
    [101, [1, 1, 1]],
    [37, [5, 3, 1]],
    [12, [0, 0, 1]],
    [9, [0, 0]],
  ]
  for (const [total, weights] of cases) {
    const parts = distributeInteger(total, weights)
    assert.equal(parts.reduce((a, b) => a + b, 0), Math.max(0, total), `parts must sum to ${total} for weights ${JSON.stringify(weights)}`)
    for (const part of parts) {
      assert.ok(Number.isInteger(part) && part >= 0, 'parts must be whole, non-negative minutes')
    }
  }

  // No weights means there is nothing to distribute into. Returning an empty
  // list (rather than inventing a single bucket) keeps the caller in control.
  assert.deepEqual(distributeInteger(45, []), [])
})

check('distributeInteger is deterministic', () => {
  const first = distributeInteger(101, [1, 1, 1, 1, 1, 1, 1])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.deepEqual(distributeInteger(101, [1, 1, 1, 1, 1, 1, 1]), first, 'ties must break the same way every time')
  }
})

/* ==========================================================================
   8. Presentation helpers
   ========================================================================== */

check('durations are never shown as bare minutes', () => {
  assert.equal(formatMinutes(0), '0m')
  assert.equal(formatMinutes(45), '45m')
  assert.equal(formatMinutes(60), '1h')
  assert.equal(formatMinutes(135), '2h 15m')
  assert.equal(formatMinutes(1440), '24h')
  assert.equal(formatMinutes(-5), '0m')
  assert.equal(formatMinutes(Number.NaN), '0m')
  assert.equal(formatMinutes(Number.POSITIVE_INFINITY), '0m')
})

check('scenario sentences read as English', () => {
  for (const intensity of INTENSITIES) {
    const sentence = run({ weatherIntensity: intensity }).weatherChange
    assert.ok(!/\bNone rain\b/.test(sentence), `"None rain" must never be rendered (got "${sentence}")`)
    assert.ok(!sentence.includes('undefined'), 'no sentence may contain "undefined"')
    assert.ok(!sentence.includes('NaN'), 'no sentence may contain "NaN"')
  }
  assert.equal(weatherIntensityTitle('none'), 'Clear conditions')
  assert.equal(weatherIntensityTitle('extreme'), 'Extreme rain')
  assert.equal(routeStatusLabel('normal'), 'Normal')
  assert.equal(routeStatusLabel('critical'), 'Critical')
  assert.equal(connectionStatusLabel('none'), 'No changeover')
  assert.equal(connectionStatusLabel('ok'), 'Connection holds')
})

check('the temperature hint agrees with the model', () => {
  for (let temperature = TEMPERATURE_RANGE.min; temperature <= TEMPERATURE_RANGE.max; temperature += 1) {
    for (const intensity of INTENSITIES) {
      const hint = temperatureEffect(temperature, intensity)
      const hazards = run({ weatherIntensity: intensity, temperatureC: temperature }).hazards
      assert.equal(hint.heat, hazards.includes('heat'), `heat hint mismatch at ${temperature}C / ${intensity}`)
      assert.equal(hint.icing, hazards.includes('ice'), `ice hint mismatch at ${temperature}C / ${intensity}`)
    }
  }
})

check('every preset produces a distinct, valid scenario', () => {
  const seen = new Set<string>()
  for (const preset of SCENARIO_PRESETS) {
    const key = JSON.stringify(preset.scenario)
    assert.ok(!seen.has(key), `duplicate preset scenario: ${preset.id}`)
    seen.add(key)
    assert.ok(INTENSITIES.includes(preset.scenario.weatherIntensity), `preset ${preset.id} has an unknown intensity`)
    assert.ok(preset.scenario.durationHours >= DURATION_RANGE.min && preset.scenario.durationHours <= DURATION_RANGE.max)
    assert.ok(preset.scenario.temperatureC >= TEMPERATURE_RANGE.min && preset.scenario.temperatureC <= TEMPERATURE_RANGE.max)
    // Every preset must actually do something, or it is a dead control.
    const result = run({ ...preset.scenario })
    assert.ok(result.actions.length > 0, `preset ${preset.id} produces no action`)
  }
})

/* ==========================================================================
   9. The real-data bridge
   ========================================================================== */

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    profile_id: 'user-1',
    title: 'Portugal run',
    origin: 'Lisbon',
    destination: 'Madrid',
    status: 'booked',
    starts_on: '2026-04-02',
    ends_on: '2026-04-06',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    transport_mode: 'train',
    operator_name: null,
    service_number: null,
    departure_at: null,
    arrival_at: null,
    booking_reference: null,
    pnr: null,
    ticket_number: null,
    passenger_name: null,
    seat: null,
    coach: null,
    terminal: null,
    fare_amount: null,
    fare_currency: null,
    booking_status: null,
    source: 'manual',
    field_provenance: null,
    import_payload: null,
    itinerary_built_at: null,
    segment_count: 0,
    ...overrides,
  } as Trip
}

function segment(overrides: Partial<JourneySegment> = {}): JourneySegment {
  return {
    id: 'seg-1',
    trip_id: 'trip-1',
    seq: 1,
    origin: 'Lisbon',
    destination: 'Porto',
    departure_at: '2026-04-02T08:00:00Z',
    arrival_at: '2026-04-02T10:45:00Z',
    transport_mode: 'train',
    operator_name: 'Alfa Pendular',
    service_number: 'AP 120',
    booking_reference: null,
    pnr: null,
    seat: null,
    coach: null,
    terminal: null,
    ticket_number: null,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    document_id: null,
    passenger_name: null,
    fare_amount: null,
    fare_currency: null,
    booking_status: null,
    source: 'manual',
    confidence: 1,
    field_provenance: null,
    import_payload: null,
    status: 'booked',
    connection_minutes: 25,
    needs_review: false,
    review_note: null,
    sequence_confirmed: true,
    ...overrides,
  } as JourneySegment
}

check('minutesBetween refuses to guess', () => {
  assert.equal(minutesBetween('2026-04-02T08:00:00Z', '2026-04-02T10:45:00Z'), 165)
  assert.equal(minutesBetween(null, '2026-04-02T10:45:00Z'), null, 'a missing start is not zero minutes')
  assert.equal(minutesBetween('2026-04-02T08:00:00Z', null), null, 'a missing end is not zero minutes')
  assert.equal(minutesBetween('2026-04-02T10:00:00Z', '2026-04-02T08:00:00Z'), null, 'an arrival before departure is unusable')
  assert.equal(minutesBetween('2026-04-02T08:00:00Z', '2026-04-02T08:00:00Z'), null, 'a zero length leg is unusable')
  assert.equal(minutesBetween('not a date', 'also not a date'), null)
  assert.equal(minutesBetween(undefined, undefined), null)
})

check('a trip with real timed legs is measured, not estimated', () => {
  const result = baselineForTrip(trip(), [
    segment({ id: 'a', seq: 1, departure_at: '2026-04-02T08:00:00Z', arrival_at: '2026-04-02T10:45:00Z' }), // 165
    segment({ id: 'b', seq: 2, departure_at: '2026-04-02T11:10:00Z', arrival_at: '2026-04-02T12:45:00Z' }), // 95
    segment({ id: 'c', seq: 3, departure_at: '2026-04-03T09:00:00Z', arrival_at: '2026-04-03T13:20:00Z' }), // 260
  ])
  assert.equal(result.source, 'measured')
  assert.equal(result.minutes, 165 + 95 + 260)
  assert.equal(result.legCount, 3)
  assert.equal(result.hasLegTimings, true)
  assert.equal(result.corridors.length, 3)
  assert.equal(result.corridors[0].baseMinutes, 165)
  assert.equal(result.corridors[0].connectionMinutes, 25)
  assert.ok(result.label.includes('real itinerary'), `label should say it is real, got "${result.label}"`)
  assert.deepEqual(result.notes, [], 'a fully timed trip needs no caveats')
})

check('the trip-wide window is used when the legs have no times', () => {
  const result = baselineForTrip(
    trip({ departure_at: '2026-04-02T08:00:00Z', arrival_at: '2026-04-02T18:00:00Z' }),
    [segment({ departure_at: null, arrival_at: null })],
  )
  assert.equal(result.source, 'measured')
  assert.equal(result.minutes, 600)
  assert.equal(result.corridors.length, 1, 'one real duration means one corridor, not a fabricated split')
})

check('a trip with nothing usable is estimated and says so', () => {
  const result = baselineForTrip(trip(), [])
  assert.equal(result.source, 'estimated')
  assert.equal(result.minutes, ESTIMATED_BASELINE_MINUTES)
  assert.equal(result.hasLegTimings, false)
  assert.equal(result.corridors.length, GENERIC_CORRIDORS.length, 'it falls back to the generic network')
  assert.ok(result.notes.length > 0, 'an estimate must be disclosed')
  assert.ok(result.label.includes('estimated'), `label must say estimated, got "${result.label}"`)
})

check('untimed legs are kept as corridors and disclosed', () => {
  const result = baselineForTrip(trip(), [
    segment({ id: 'a', seq: 1, departure_at: '2026-04-02T08:00:00Z', arrival_at: '2026-04-02T10:00:00Z' }),
    segment({ id: 'b', seq: 2, origin: 'Porto', destination: 'Vigo', departure_at: null, arrival_at: null, connection_minutes: 15 }),
  ])
  assert.equal(result.minutes, 120, 'only the timed leg contributes minutes')
  assert.equal(result.corridors.length, 2, 'both legs are still visible')
  assert.equal(result.corridors[1].baseMinutes, null, 'the untimed leg is not given a made-up duration')
  assert.equal(result.corridors[1].connectionMinutes, 15, 'its real changeover is preserved')
  assert.ok(result.notes.some((note) => note.includes('1 of 2 bookings')), `expected a caveat about the untimed leg, got ${JSON.stringify(result.notes)}`)

  // And it must still run.
  const simulation = calculateDigitalTwinSimulation({
    baselineTravelMinutes: result.minutes,
    scenario: { weatherIntensity: 'extreme', durationHours: 8, temperatureC: 19, location: 'Coastal Approach' },
    corridors: result.corridors,
  })
  assert.equal(
    simulation.corridors.reduce((sum, corridor) => sum + corridor.delayMinutes, 0),
    simulation.delayMinutes,
    'a mixed-measurement baseline must still be internally consistent',
  )
})

check('segments are ordered by their saved sequence', () => {
  const result = baselineForTrip(trip(), [
    segment({ id: 'late', seq: 9, origin: 'B', destination: 'C' }),
    segment({ id: 'early', seq: 1, origin: 'A', destination: 'B' }),
  ])
  assert.deepEqual(result.corridors.map((corridor) => corridor.id), ['early', 'late'])
})

check('a trip with no origin or destination still labels its corridor', () => {
  const result = baselineForTrip(trip({ origin: null, destination: null, departure_at: '2026-04-02T08:00:00Z', arrival_at: '2026-04-02T09:00:00Z' }), [])
  assert.equal(result.minutes, 60)
  assert.ok(result.corridors[0].label.length > 0, 'a corridor must never be nameless')
})

check('the system baseline is a labelled estimate', () => {
  const result = systemBaseline()
  assert.equal(result.source, 'estimated')
  assert.equal(result.minutes, ESTIMATED_BASELINE_MINUTES)
  assert.equal(result.legCount, 0)
  assert.ok(result.label.includes('System baseline'))
  assert.deepEqual(result.notes, [])
})

/* ==========================================================================
   10. Observed state
   ========================================================================== */

check('the observed state is derived from real disruptions', () => {
  assert.deepEqual(describeCurrentState([]), { disruptionCount: 0, routeStatus: 'normal', riskLevel: 'low' })
  assert.deepEqual(describeCurrentState(undefined), { disruptionCount: 0, routeStatus: 'normal', riskLevel: 'low' })

  const oneCritical = describeCurrentState([{ severity: 'critical' }])
  assert.equal(oneCritical.disruptionCount, 1)
  assert.equal(oneCritical.routeStatus, 'critical')

  const manyInfo = describeCurrentState(Array.from({ length: 10 }, () => ({ severity: 'info' })))
  assert.ok(
    RISK_ORDER[manyInfo.riskLevel] < RISK_ORDER[oneCritical.riskLevel],
    'ten informational alerts must not outrank one cancellation',
  )

  const mixed = describeCurrentState([{ severity: 'warn' }, { severity: 'info' }])
  assert.equal(mixed.riskLevel, 'medium')

  const unknownSeverity = describeCurrentState([{ severity: 'something-new' }])
  assert.equal(unknownSeverity.disruptionCount, 1, 'an unknown severity is still a real disruption')
})

/* ==========================================================================
   11. Live weather -> scenario, without touching the network
   ========================================================================== */

check('rain rate prefers the hourly figure and falls back to a three hour average', () => {
  assert.deepEqual(rainfallRate({ '1h': 4 }), { mm: 4, basis: 'measured over the last hour' })
  assert.deepEqual(rainfallRate({ '3h': 9 }), { mm: 3, basis: 'averaged from the last three hours' })
  assert.deepEqual(rainfallRate({ '1h': 0, '3h': 6 }), { mm: 2, basis: 'averaged from the last three hours' })
  assert.deepEqual(rainfallRate(undefined), { mm: 0, basis: 'no rainfall reported in the last three hours' })
  assert.deepEqual(rainfallRate({ '1h': -5 }), { mm: 0, basis: 'no rainfall reported in the last three hours' }, 'a negative reading is not rainfall')
})

check('observations are classified into the documented rain bands', () => {
  const cases: Array<[number, WeatherIntensity]> = [
    [0, 'none'],
    [0.2, 'none'],
    [0.3, 'light'],
    [2.4, 'light'],
    [2.5, 'moderate'],
    [7.5, 'moderate'],
    [7.6, 'heavy'],
    [25.5, 'heavy'],
    [25.6, 'extreme'],
    [90, 'extreme'],
  ]
  for (const [mm, expected] of cases) {
    const classified = classifyObservation({ main: { temp: 14 }, rain: { '1h': mm } })
    assert.equal(classified.intensity, expected, `${mm} mm/h should read as ${expected}, got ${classified.intensity}`)
  }
})

check('a thunderstorm escalates the band even when the rain field is small', () => {
  const drizzle = classifyObservation({ main: { temp: 14 }, rain: { '1h': 0.4 }, weather: [{ id: 300, description: 'light drizzle' }] })
  assert.equal(drizzle.intensity, 'moderate', 'drizzle escalates one band')

  const storm = classifyObservation({ main: { temp: 14 }, rain: { '1h': 0.4 }, weather: [{ id: 211, description: 'thunderstorm' }] })
  assert.equal(storm.intensity, 'heavy', 'a thunderstorm escalates two bands')

  const severeStorm = classifyObservation({ main: { temp: 14 }, rain: { '1h': 3 }, weather: [{ id: 200, description: 'thunderstorm' }] })
  assert.equal(severeStorm.intensity, 'extreme', 'escalation is applied on top of the measured rate')

  // Escalation must not wrap around below 'none'.
  const dryStorm = classifyObservation({ main: { temp: 14 }, weather: [{ id: 200, description: 'thunderstorm' }] })
  assert.equal(dryStorm.intensity, 'moderate')
})

check('freezing rain is flagged as icing rather than just water', () => {
  const freezing = classifyObservation({ main: { temp: -2 }, rain: { '1h': 3 } })
  assert.ok(freezing.basis.includes('0°C'), `icing should be mentioned, got "${freezing.basis}"`)
  assert.ok(
    temperatureEffect(freezing.temperatureC, freezing.intensity).icing,
    'the model must agree that this reading is an icing scenario',
  )
})

check('an empty or unusable observation still classifies to something renderable', () => {
  const empty = classifyObservation({})
  assert.equal(empty.place, 'Unknown location')
  assert.equal(empty.description, 'No description reported')
  assert.equal(empty.intensity, 'none')
  assert.equal(empty.country, null)
  assert.ok(Number.isFinite(empty.temperatureC))
  assert.ok(Number.isFinite(Date.parse(empty.observedAt)))

  const wild = classifyObservation({ main: { temp: 9999 }, rain: { '1h': Number.NaN } })
  assert.ok(wild.temperatureC <= 60, 'an absurd temperature must be clamped')
})

check('the whole classification feeds straight into a valid scenario', () => {
  for (const mm of [0, 0.5, 3, 10, 40]) {
    for (const temp of [-8, 0, 12, 33]) {
      const classified = classifyObservation({ name: 'Porto', sys: { country: 'PT' }, main: { temp }, rain: { '1h': mm }, weather: [{ id: 500, description: 'rain' }] })
      const scenario: TwinScenario = {
        weatherIntensity: classified.intensity,
        durationHours: assumedExposureHours(classified.intensity, classified.rainfallMm),
        temperatureC: classified.temperatureC,
        location: classified.place,
      }
      // The twin hook is what a real observation ends up going through.
      const repaired = sanitiseScenario(scenario)
      const result = calculateDigitalTwinSimulation({ baselineTravelMinutes: 210, scenario: repaired })
      assert.ok(result.actions.length > 0, 'a live-fed scenario must still produce a response')
      assert.ok(Number.isFinite(result.riskScore), 'a live-fed scenario must produce a finite risk score')
    }
  }
})

check('assumed exposure is always inside the slider bounds', () => {
  for (const intensity of INTENSITIES) {
    for (const mm of [0, 0.5, 1, 4, 9, 20, 60]) {
      const hours = assumedExposureHours(intensity, mm)
      assert.ok(
        hours >= DURATION_RANGE.min && hours <= DURATION_RANGE.max,
        `${hours}h is outside the slider range for ${intensity} / ${mm}mm`,
      )
      assert.ok(Number.isInteger(hours), 'exposure must be a whole number of hours')
    }
  }
})

/* ==========================================================================
   12. Scenario persistence is not trusted
   ========================================================================== */
check('a corrupt stored scenario is repaired rather than crashing the page', () => {
  assert.deepEqual(sanitiseScenario(null), { weatherIntensity: 'heavy', durationHours: 3, temperatureC: 17, location: 'Central District' })
  assert.deepEqual(sanitiseScenario('nonsense'), { weatherIntensity: 'heavy', durationHours: 3, temperatureC: 17, location: 'Central District' })
  assert.deepEqual(sanitiseScenario({}), { weatherIntensity: 'heavy', durationHours: 3, temperatureC: 17, location: 'Central District' })

  const repaired = sanitiseScenario({
    weatherIntensity: 'meteor-shower',
    durationHours: 900,
    temperatureC: -50,
    location: '   ',
  })
  assert.equal(repaired.weatherIntensity, 'heavy')
  assert.equal(repaired.durationHours, DURATION_RANGE.max)
  assert.equal(repaired.temperatureC, TEMPERATURE_RANGE.min)
  assert.equal(repaired.location, 'Central District')

  const kept = sanitiseScenario({ weatherIntensity: 'extreme', durationHours: 7, temperatureC: -4, location: 'West Bypass' })
  assert.deepEqual(kept, { weatherIntensity: 'extreme', durationHours: 7, temperatureC: -4, location: 'West Bypass' })
})

/* ========================================================================== */

console.log(`\n  ${checks} digital twin checks passed\n`)
