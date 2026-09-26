export type RecoveryTransportMode = 'walk' | 'drive' | 'transit' | 'flight'

export type RecoveryStepStatus = 'locked' | 'current' | 'completed'

export type NavigationJourneyKind = 'journey' | 'recovery'

export interface RecoveryCoordinate {
  lat: number
  lng: number
}

export interface RecoveryNavigationStep {
  id: string
  stepNumber: number
  title: string
  description: string
  from: string
  to: string
  mode: RecoveryTransportMode
  distanceMeters?: number
  durationMinutes?: number
  origin?: RecoveryCoordinate
  destination?: RecoveryCoordinate
  status: RecoveryStepStatus
}

export interface RecoveryNavigationData {
  id: string
  kind: NavigationJourneyKind
  title: string
  summary?: string
  steps: RecoveryNavigationStep[]
  routeGeometry?: RecoveryRouteGeometry
}

export interface RecoveryRouteGeometry {
  points: RecoveryCoordinate[]
  origin?: RecoveryCoordinate
  destination?: RecoveryCoordinate
  distanceMeters?: number
  durationMinutes?: number
}

export interface DeviceLocation extends RecoveryCoordinate {
  accuracyMeters: number
  timestamp: number
}