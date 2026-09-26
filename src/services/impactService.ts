import type { Disruption, JourneySegment, PassengerTravelStatus } from '../types/database.ts'

export type ImpactConnectionStatus =
  | 'connection_safe'
  | 'connection_at_risk'
  | 'connection_missed'
  | 'insufficient_information'

export type ImpactSegment = Pick<JourneySegment, 'id' | 'departure_at' | 'arrival_at' | 'fare_amount' | 'fare_currency' | 'booking_status' | 'passenger_travel_status'>
export type ImpactDisruption = Pick<
  Disruption,
  | 'id'
  | 'segment_id'
  | 'trip_id'
  | 'kind'
  | 'delay_minutes'
  | 'original_departure_at'
  | 'original_arrival_at'
  | 'revised_departure_at'
  | 'revised_arrival_at'
  | 'cancellation_at'
  | 'reported_at'
>

export interface ImpactConnection {
  nextSegmentId: string | null
  status: ImpactConnectionStatus
  originalMinutes: number | null
  projectedMinutes: number | null
  missingInformation: string[]
}

export interface ImpactResult {
  status: 'no_disruption' | 'calculated' | 'insufficient_information'
  disruptionId: string | null
  disruptionKind: Disruption['kind'] | null
  affectedSegmentId: string | null
  originalDepartureAt: string | null
  originalArrivalAt: string | null
  revisedDepartureAt: string | null
  revisedArrivalAt: string | null
  delayMinutes: number | null
  connectionAfterDisruption: ImpactConnection
  downstreamAffectedSegmentIds: string[]
  originalFinalArrivalAt: string | null
  projectedFinalArrivalAt: string | null
  disruptedSegmentIsFinal: boolean
  missingInformation: string[]
  lossInput: {
    affectedSegmentId: string | null
    fareAmount: number | null
    fareCurrency: string | null
    bookingStatus: string | null
    disruptionKind: Disruption['kind'] | null
    delayMinutes: number | null
    originalDepartureAt: string | null
    originalArrivalAt: string | null
    revisedDepartureAt: string | null
    revisedArrivalAt: string | null
    passengerTravelStatus: PassengerTravelStatus | null
  }
}

function time(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function minutesBetween(start: string | null, end: string | null): number | null {
  const startTime = time(start)
  const endTime = time(end)
  if (startTime === null || endTime === null) return null
  return Math.round((endTime - startTime) / 60000)
}

function addMinutes(value: string | null, minutes: number | null): string | null {
  const timestamp = time(value)
  if (timestamp === null || minutes === null) return null
  return new Date(timestamp + minutes * 60000).toISOString()
}

function baseLossInput(segment: ImpactSegment | null, disruption: ImpactDisruption | null, originalDepartureAt: string | null, originalArrivalAt: string | null, revisedDepartureAt: string | null, revisedArrivalAt: string | null, delayMinutes: number | null) {
  return {
    affectedSegmentId: segment?.id ?? null,
    fareAmount: segment?.fare_amount ?? null,
    fareCurrency: segment?.fare_currency ?? null,
    bookingStatus: segment?.booking_status ?? null,
    disruptionKind: disruption?.kind ?? null,
    delayMinutes,
    originalDepartureAt,
    originalArrivalAt,
    revisedDepartureAt,
    revisedArrivalAt,
    passengerTravelStatus: segment?.passenger_travel_status ?? null,
  }
}

/**
 * Calculates only factual schedule impact. It never changes segments, creates
 * routes, calls providers, evaluates refunds, or uses an LLM.
 */
export function calculateImpact(segments: ImpactSegment[], disruption: ImpactDisruption | null): ImpactResult {
  const originalFinalArrivalAt = segments.at(-1)?.arrival_at ?? null
  const noConnection: ImpactConnection = {
    nextSegmentId: null,
    status: 'insufficient_information',
    originalMinutes: null,
    projectedMinutes: null,
    missingInformation: [],
  }

  if (!disruption) {
    return {
      status: 'no_disruption',
      disruptionId: null,
      disruptionKind: null,
      affectedSegmentId: null,
      originalDepartureAt: null,
      originalArrivalAt: null,
      revisedDepartureAt: null,
      revisedArrivalAt: null,
      delayMinutes: null,
      connectionAfterDisruption: noConnection,
      downstreamAffectedSegmentIds: [],
      originalFinalArrivalAt,
      projectedFinalArrivalAt: originalFinalArrivalAt,
      disruptedSegmentIsFinal: false,
      missingInformation: [],
      lossInput: baseLossInput(null, null, null, null, null, null, null),
    }
  }

  if (!disruption.segment_id) {
    return insufficientResult(disruption, originalFinalArrivalAt, 'affected journey segment')
  }

  const index = segments.findIndex((segment) => segment.id === disruption.segment_id)
  if (index < 0) return insufficientResult(disruption, originalFinalArrivalAt, 'affected journey segment in itinerary')

  const segment = segments[index]
  const nextSegment = segments[index + 1] ?? null
  const originalDepartureAt = disruption.original_departure_at ?? segment.departure_at
  const originalArrivalAt = disruption.original_arrival_at ?? segment.arrival_at
  const delayMinutes = disruption.delay_minutes ?? minutesBetween(originalArrivalAt, disruption.revised_arrival_at)
  const revisedDepartureAt = disruption.kind === 'cancellation'
    ? disruption.revised_departure_at
    : disruption.revised_departure_at ?? originalDepartureAt
  const revisedArrivalAt = disruption.kind === 'cancellation'
    ? null
    : disruption.revised_arrival_at ?? addMinutes(originalArrivalAt, delayMinutes)
  const missingInformation: string[] = []

  if (!originalArrivalAt) missingInformation.push('original arrival time')
  if (disruption.kind === 'delay' && delayMinutes === null) missingInformation.push('delay duration or revised arrival time')

  const connection = calculateConnection(nextSegment, originalArrivalAt, revisedArrivalAt)
  missingInformation.push(...connection.missingInformation.filter((item) => !missingInformation.includes(item)))

  const downstreamAffectedSegmentIds = connection.status === 'connection_missed' || disruption.kind === 'cancellation'
    ? segments.slice(index + 1).map((item) => item.id)
    : []
  const disruptedSegmentIsFinal = index === segments.length - 1
  let projectedFinalArrivalAt: string | null = null
  if (disruptedSegmentIsFinal) {
    projectedFinalArrivalAt = revisedArrivalAt
  } else if (connection.status === 'connection_safe') {
    projectedFinalArrivalAt = originalFinalArrivalAt
  } else {
    missingInformation.push('projected final arrival after the affected connection')
  }

  return {
    status: missingInformation.length > 0 ? 'insufficient_information' : 'calculated',
    disruptionId: disruption.id,
    disruptionKind: disruption.kind,
    affectedSegmentId: segment.id,
    originalDepartureAt,
    originalArrivalAt,
    revisedDepartureAt,
    revisedArrivalAt,
    delayMinutes,
    connectionAfterDisruption: connection,
    downstreamAffectedSegmentIds,
    originalFinalArrivalAt,
    projectedFinalArrivalAt,
    disruptedSegmentIsFinal,
    missingInformation,
    lossInput: baseLossInput(segment, disruption, originalDepartureAt, originalArrivalAt, revisedDepartureAt, revisedArrivalAt, delayMinutes),
  }
}

function calculateConnection(nextSegment: ImpactSegment | null, originalArrivalAt: string | null, revisedArrivalAt: string | null): ImpactConnection {
  if (!nextSegment) {
    return { nextSegmentId: null, status: 'connection_safe', originalMinutes: null, projectedMinutes: null, missingInformation: [] }
  }
  const missingInformation: string[] = []
  if (!nextSegment.departure_at) missingInformation.push('next departure time')
  if (!revisedArrivalAt) missingInformation.push('revised arrival time')
  if (missingInformation.length > 0) {
    return {
      nextSegmentId: nextSegment.id,
      status: 'insufficient_information',
      originalMinutes: minutesBetween(originalArrivalAt, nextSegment.departure_at),
      projectedMinutes: null,
      missingInformation,
    }
  }
  const projectedMinutes = minutesBetween(revisedArrivalAt, nextSegment.departure_at)
  const originalMinutes = minutesBetween(originalArrivalAt, nextSegment.departure_at)
  if (projectedMinutes === null) {
    return { nextSegmentId: nextSegment.id, status: 'insufficient_information', originalMinutes, projectedMinutes, missingInformation: ['connection timestamps'] }
  }
  return {
    nextSegmentId: nextSegment.id,
    status: projectedMinutes < 0
      ? 'connection_missed'
      : originalMinutes !== null && projectedMinutes < originalMinutes
        ? 'connection_at_risk'
        : 'connection_safe',
    originalMinutes,
    projectedMinutes,
    missingInformation: [],
  }
}

function insufficientResult(disruption: ImpactDisruption, originalFinalArrivalAt: string | null, missing: string): ImpactResult {
  return {
    status: 'insufficient_information',
    disruptionId: disruption.id,
    disruptionKind: disruption.kind,
    affectedSegmentId: disruption.segment_id,
    originalDepartureAt: null,
    originalArrivalAt: null,
    revisedDepartureAt: null,
    revisedArrivalAt: null,
    delayMinutes: disruption.delay_minutes,
    connectionAfterDisruption: { nextSegmentId: null, status: 'insufficient_information', originalMinutes: null, projectedMinutes: null, missingInformation: [missing] },
    downstreamAffectedSegmentIds: [],
    originalFinalArrivalAt,
    projectedFinalArrivalAt: null,
    disruptedSegmentIsFinal: false,
    missingInformation: [missing],
    lossInput: baseLossInput(null, disruption, null, null, null, null, disruption.delay_minutes),
  }
}