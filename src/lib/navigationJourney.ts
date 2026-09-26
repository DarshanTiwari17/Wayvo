import type { Trip } from '../types/database'
import type { DeviceLocation, RecoveryNavigationData } from '../types/recoveryNavigation'
import { formatDateRange, formatRoute } from '../services/travelService'

export function buildJourneyNavigationData(trip: Trip, currentLocation?: DeviceLocation | null): RecoveryNavigationData {
  const usingLiveLocation = Boolean(currentLocation)
  return {
    id: trip.id,
    kind: 'journey',
    title: trip.title,
    summary: `${formatRoute(trip)} · ${formatDateRange(trip.starts_on, trip.ends_on)}`,
    steps: [{
      id: `${trip.id}-route`,
      stepNumber: 1,
      title: `Travel from ${usingLiveLocation ? 'your current location' : trip.origin || 'your starting point'}`,
      description: 'Follow the selected route to your journey destination.',
      from: usingLiveLocation ? 'Your current location' : trip.origin || 'Starting point',
      to: trip.destination || 'Destination',
      mode: 'drive',
      status: 'current',
    }],
  }
}