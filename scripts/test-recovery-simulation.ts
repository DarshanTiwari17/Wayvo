import assert from 'node:assert/strict'
import {
  MAX_SIMULATION_DURATION_MS,
  MIN_SIMULATION_DURATION_MS,
  SIMULATED_DELAY_MINUTES,
  planRealisticDisruption,
  simulationDurationMs,
} from '../src/components/recovery/simulationModel'

const leg = (overrides: Partial<{
  transport_mode: string | null
  departure_at: string | null
  booking_status: string | null
  connection_minutes: number | null
}> = {}) => ({
  transport_mode: 'train',
  departure_at: '2026-09-27T08:00:00Z',
  booking_status: 'confirmed',
  connection_minutes: null,
  ...overrides,
})

assert.equal(simulationDurationMs(0), 0)
assert.ok(simulationDurationMs(1) >= MIN_SIMULATION_DURATION_MS)
assert.ok(simulationDurationMs(1) <= MAX_SIMULATION_DURATION_MS)
assert.equal(simulationDurationMs(10), MAX_SIMULATION_DURATION_MS)
assert.equal(simulationDurationMs(100), MAX_SIMULATION_DURATION_MS)

assert.equal(planRealisticDisruption([leg({ transport_mode: 'hotel' })]), null)
assert.equal(planRealisticDisruption([leg({ departure_at: null })]), null)

assert.deepEqual(planRealisticDisruption([leg()]), {
  segmentIndex: 0,
  kind: 'delay',
  delayMinutes: SIMULATED_DELAY_MINUTES,
})

assert.deepEqual(planRealisticDisruption([
  leg(),
  leg({ connection_minutes: 15, transport_mode: 'flight' }),
]), {
  segmentIndex: 0,
  kind: 'missed connection',
  delayMinutes: SIMULATED_DELAY_MINUTES,
})

assert.deepEqual(planRealisticDisruption([
  leg({ booking_status: 'cancelled' }),
]), {
  segmentIndex: 0,
  kind: 'cancellation',
  delayMinutes: null,
})

assert.deepEqual(planRealisticDisruption([
  leg(),
  leg({ connection_minutes: 60, transport_mode: 'flight' }),
]), {
  segmentIndex: 0,
  kind: 'delay',
  delayMinutes: SIMULATED_DELAY_MINUTES,
})

console.log('PASS  realistic scenarios are data-based, valid, and the full run is bounded to 10-20 seconds')