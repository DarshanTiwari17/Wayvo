import { Bus, Car, Hotel, Plane, Ship, TrainFront, Route } from 'lucide-react'
import type { TransportMode } from '../../lib/bookingParser'

export const TRANSPORT_LABEL: Record<TransportMode, string> = {
  train: 'Train',
  flight: 'Flight',
  bus: 'Bus',
  car: 'Car',
  ferry: 'Ferry',
  hotel: 'Stay',
  other: 'Other',
}

export const TRANSPORT_ICON: Record<TransportMode, typeof TrainFront> = {
  train: TrainFront,
  flight: Plane,
  bus: Bus,
  car: Car,
  ferry: Ship,
  hotel: Hotel,
  other: Route,
}

/** Shown on a journey card. Falls back to a neutral glyph for manual journeys. */
export function TransportGlyph({ mode }: { mode: TransportMode | null }) {
  if (!mode) {
    return <Route size={15} strokeWidth={2} aria-hidden="true" />
  }
  const Icon = TRANSPORT_ICON[mode]
  return <Icon size={15} strokeWidth={2} aria-hidden="true" />
}
