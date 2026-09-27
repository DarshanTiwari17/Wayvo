export type SimulatedDisruptionKind = 'delay' | 'cancellation' | 'missed connection'

export type SimulationSegment = {
  transport_mode: string | null
  departure_at: string | null
  booking_status: string | null
  connection_minutes: number | null
}

export type PlannedDisruption = {
  segmentIndex: number
  kind: SimulatedDisruptionKind
  delayMinutes: number | null
}

export const SIMULATED_DELAY_MINUTES = 20
export const MIN_SIMULATION_DURATION_MS = 10_000
export const MAX_SIMULATION_DURATION_MS = 20_000

const TRANSPORT_MODES = new Set(['bus', 'car', 'ferry', 'flight', 'train'])

export function simulationDurationMs(segmentCount: number): number {
  if (!Number.isFinite(segmentCount) || segmentCount <= 0) return 0
  return Math.min(MAX_SIMULATION_DURATION_MS, MIN_SIMULATION_DURATION_MS + Math.min(segmentCount, 10) * 1_000)
}

export function planRealisticDisruption(segments: readonly SimulationSegment[]): PlannedDisruption | null {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment || !segment.transport_mode || !TRANSPORT_MODES.has(segment.transport_mode)) continue
    if (!segment.departure_at || !Number.isFinite(Date.parse(segment.departure_at))) continue

    if (/cancelled|canceled/i.test(segment.booking_status ?? '')) {
      return { segmentIndex: index, kind: 'cancellation', delayMinutes: null }
    }

    const nextSegment = segments[index + 1]
    const connectionMinutes = nextSegment?.connection_minutes
    if (
      nextSegment &&
      nextSegment.transport_mode &&
      TRANSPORT_MODES.has(nextSegment.transport_mode) &&
      typeof connectionMinutes === 'number' &&
      Number.isInteger(connectionMinutes) &&
      connectionMinutes > 0 &&
      connectionMinutes < SIMULATED_DELAY_MINUTES
    ) {
      return { segmentIndex: index, kind: 'missed connection', delayMinutes: SIMULATED_DELAY_MINUTES }
    }

    return { segmentIndex: index, kind: 'delay', delayMinutes: SIMULATED_DELAY_MINUTES }
  }

  return null
}