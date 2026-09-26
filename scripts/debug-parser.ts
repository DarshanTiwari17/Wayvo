import { extractJourneyFromText } from '../src/lib/bookingParser'

const bus = `
    VOLVO BUS TICKET
    Booking Ref: VB9043211
    From: MUMBAI
    To: GOA
    Bus No: VB 2211
    Departure: 29-Sep-2026 22:00
    Seat: 12
    Passenger: ANIL KUMAR
    Fare: 1200
    Status: confirmed
`
const flight = `
    Flight: 6E 2145
    From: Mumbai (BOM)
    To: Delhi (DEL)
    Departure: 28 Sep 2026, 18:40
`
const fare = `
    Total Fare: Rs. 1,247
`

console.log('--- BUS ---')
const rb = extractJourneyFromText(bus)
console.log('origin', JSON.stringify(rb.fields.origin), 'dest', JSON.stringify(rb.fields.destination))

const CITY = String.raw`[A-Z][A-Za-z.'-]*(?:[ -][A-Z][A-Za-z.'-]*)*`
const STATION = String.raw`\s*\([A-Z]{3,4}\)?`
const fromRe = new RegExp(String.raw`\b(?:from|origin|depart(?:ing|ure)?\s*from)\s*[:#-]?\s*(${CITY})${STATION}`, 'i')
const toRe = new RegExp(String.raw`\b(?:to|destination|arriv(?:ing|al)?\s*(?:at|in|to)?)\s*[:#-]?\s*(${CITY})${STATION}`, 'i')
console.log('fromRe ->', JSON.stringify(bus.match(fromRe)?.slice(0, 2)))
console.log('toRe   ->', JSON.stringify(bus.match(toRe)?.slice(0, 2)))

console.log('\n--- FLIGHT ---')
const rf = extractJourneyFromText(flight)
console.log('mode', rf.fields.transportMode, 'service', JSON.stringify(rf.fields.serviceNumber))
console.log('fromRe ->', JSON.stringify(flight.match(fromRe)?.slice(0, 2)))
console.log('toRe   ->', JSON.stringify(flight.match(toRe)?.slice(0, 2)))
const labelled = flight.match(/\bflight\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z]{2})\s*-?\s*(\d{3,4})\b/i)
console.log('labelled flight ->', JSON.stringify(labelled?.slice(0, 3)))

console.log('\n--- FARE ---')
const amount = String.raw`([\d,]+(?:\.\d{1,2})?)`
const tail = String.raw`\s*(₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?`
const labelledFare = fare.match(
  new RegExp(
    String.raw`\b(?:grand\s*total|total\s*(?:fare|amount|price)?|amount|fare|price|paid)\s*[:#-]?\s*` +
      String.raw`(?:₹|\$|€|£|INR|USD|EUR|GBP|Rs\.?)?\s*` +
      amount +
      tail,
    'i',
  ),
)
console.log('labelledFare ->', JSON.stringify(labelledFare))
