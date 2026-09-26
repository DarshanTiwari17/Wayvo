import { buildJourneyNavigationData } from '../src/lib/navigationJourney'
import type { Trip } from '../src/types/database'

const trip = {
  id: 'trip-test-1',
  profile_id: 'profile-test-1',
  title: 'Work trip',
  origin: 'Pune',
  destination: 'Mumbai Airport',
  status: 'booked',
  starts_on: '2026-10-01',
  ends_on: '2026-10-02',
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
  transport_mode: 'car',
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
} satisfies Trip

const currentLocation = { lat: 18.5204, lng: 73.8567, accuracyMeters: 63, timestamp: Date.now() }
const navigation = buildJourneyNavigationData(trip, currentLocation)
const step = navigation.steps[0]

function check(name: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`)
  if (!condition) process.exitCode = 1
}

check('uses the saved journey id', navigation.id === trip.id)
check('uses live location as the navigation origin label', step.from === 'Your current location')
check('keeps the saved journey destination', step.to === trip.destination)
check('does not replace GPS with hard-coded coordinates', !('origin' in step && step.origin))