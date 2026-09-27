import { extractJourneyFromText, isUsableJourney } from '../src/lib/bookingParser'

const bare = extractJourneyFromText(`
    From: MUMBAI CENTRAL
    To: PANVEL
    Departure: 14-Nov-2026 08:00
    Arrival: 14-Nov-2026 09:15
    Passenger: RAHUL SHARMA
    ₹342
  `)

console.log('origin:', JSON.stringify(bare.fields.origin))
console.log('destination:', JSON.stringify(bare.fields.destination))
console.log('fare:', bare.fields.fare)
console.log('currency:', bare.fields.currency)
console.log('departureDate:', bare.fields.departureDate)
console.log('departureTime:', bare.fields.departureTime)
console.log('mode:', bare.fields.transportMode)
console.log('isUsableJourney:', isUsableJourney(bare))
