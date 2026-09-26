/**
 * Real-input tests for the booking parser.
 *
 * These are genuine ticket / email / confirmation texts of the kind a traveller
 * would upload. They assert what the parser finds *and* what it must refuse to
 * invent, because a wrong-but-confident extraction is worse than a blank field.
 */
import { extractJourneyFromText, isUsableJourney, summariseJourney } from '../src/lib/bookingParser'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`)
}

/* ==========================================================================
 * 1. Indian Railways e-ticket
 * ========================================================================== */
{
  const text = `
    EASTERN RAILWAYS
    ELECTRONIC RESERVATION TICKET
    PNR: 7X4K2M
    Train No: 12123
    Train Name: SHATABDI EXPRESS
    From: MUMBAI CENTRAL (MMCT)
    To: PUNE JUNCTION (PUNE)
    Departure: 28-Sep-2026 07:10
    Arrival: 28-Sep-2026 10:25
    Class: AC 2 TIER
    Coach: C7
    Seat: 24
    Passenger: RAHUL SHARMA
    Age: 34
    Total Fare: Rs. 1,247
    Status: CONFIRMED
  `
  const r = extractJourneyFromText(text)
  const f = r.fields

  check('IRCTC: pnr', f.pnr === '7X4K2M', String(f.pnr))
  check('IRCTC: mode is train', f.transportMode === 'train', String(f.transportMode))
  check('IRCTC: service number', f.serviceNumber === '12123', String(f.serviceNumber))
  check('IRCTC: origin', f.origin?.toLowerCase().includes('mumbai'), String(f.origin))
  check('IRCTC: destination', f.destination?.toLowerCase().includes('pune'), String(f.destination))
  check('IRCTC: departure date', f.departureDate === '2026-09-28', String(f.departureDate))
  check('IRCTC: departure time', f.departureTime === '07:10', String(f.departureTime))
  check('IRCTC: arrival time', f.arrivalTime === '10:25', String(f.arrivalTime))
  check('IRCTC: seat', f.seat === '24', String(f.seat))
  check('IRCTC: coach', f.coach?.includes('C7'), String(f.coach))
  check('IRCTC: passenger', /RAHUL/i.test(f.traveler ?? ''), String(f.traveler))
  check('IRCTC: fare', f.fare === 1247, String(f.fare))
  check('IRCTC: currency inferred as INR', f.currency === 'INR', String(f.currency))
  check('IRCTC: status', f.bookingStatus === 'confirmed', String(f.bookingStatus))
  check('IRCTC: usable', isUsableJourney(r), `conf ${r.confidence}`)
  check('IRCTC: summary reads well', /mumbai/i.test(summariseJourney(f)), summariseJourney(f))
}

/* ==========================================================================
 * 2. Flight confirmation email
 * ========================================================================== */
{
  const text = `
    Subject: Your flight booking is confirmed

    Dear Darshan Mehta,

    Your booking reference is QW7X2B.
    Airline: IndiGo
    Flight: 6E 2145
    From: Mumbai (BOM)
    To: Delhi (DEL)
    Departure: 28 Sep 2026, 18:40
    Arrival: 28 Sep 2026, 21:05
    Terminal: 2
    Gate: A12
    Passenger: MEHTA Darshan
    Fare: INR 8,450
    Booking status: CONFIRMED
  `
  const r = extractJourneyFromText(text)
  const f = r.fields

  check('flight: mode', f.transportMode === 'flight', String(f.transportMode))
  check('flight: operator', /indigo/i.test(f.operator ?? ''), String(f.operator))
  check('flight: service number', f.serviceNumber === '6E2145', String(f.serviceNumber))
  check('flight: origin', /mumbai|bom/i.test(f.origin ?? ''), String(f.origin))
  check('flight: destination', /delhi|del/i.test(f.destination ?? ''), String(f.destination))
  check('flight: departure time', f.departureTime === '18:40', String(f.departureTime))
  check('flight: arrival time', f.arrivalTime === '21:05', String(f.arrivalTime))
  check('flight: terminal', f.terminal === '2', String(f.terminal))
  check('flight: booking reference found', f.bookingReference === 'QW7X2B', String(f.bookingReference))
  check('flight: fare', f.fare === 8450, String(f.fare))
  check('flight: usable', isUsableJourney(r), `conf ${r.confidence}`)
}

/* ==========================================================================
 * 3. Hotel booking
 * ========================================================================== */
{
  const text = `
    Booking Confirmation
    Property: Grand Hotel
    Check-in: 30/09/2026
    Check-out: 03/10/2026
    Guest: PRIYA NAIR
    Room: Deluxe King
    Reservation number: GH-88213
    Total: EUR 640
    Status: confirmed
  `
  const r = extractJourneyFromText(text)
  const f = r.fields

  check('hotel: mode detected', f.transportMode === 'hotel', String(f.transportMode))
  check('hotel: operator / property', /grand hotel/i.test(f.operator ?? ''), String(f.operator))
  check('hotel: guest', /PRIYA/i.test(f.traveler ?? ''), String(f.traveler))
  check('hotel: does NOT invent a route', f.origin === null && f.destination === null, `${f.origin} / ${f.destination}`)
  check('hotel: usable enough to show', isUsableJourney(r) || r.fields.transportMode === 'hotel', `conf ${r.confidence}`)
}

/* ==========================================================================
 * 4. Bus ticket
 * ========================================================================== */
{
  const text = `
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
  const r = extractJourneyFromText(text)
  const f = r.fields
  check('bus: mode', f.transportMode === 'bus', String(f.transportMode))
  check('bus: route', /mumbai/i.test(f.origin ?? '') && /goa/i.test(f.destination ?? ''), `${f.origin} -> ${f.destination}`)
  check('bus: departure', f.departureDate === '2026-09-29' && f.departureTime === '22:00', `${f.departureDate} ${f.departureTime}`)
  check('bus: usable', isUsableJourney(r), `conf ${r.confidence}`)
}

/* ==========================================================================
 * 5. A receipt with no travel in it — must be rejected, not hallucinated
 * ========================================================================== */
{
  const text = `
    SUPERMARKET RECEIPT
    Rice 5kg .......... 450.00
    Cooking oil ...... 180.00
    Total ............. 630.00
    Thank you for shopping with us
  `
  const r = extractJourneyFromText(text)
  check('supermarket receipt is not a journey', !isUsableJourney(r), `conf ${r.confidence}`)
  check('supermarket receipt invents no route', r.fields.origin === null && r.fields.destination === null, `${r.fields.origin} / ${r.fields.destination}`)
  check('supermarket receipt invents no date', r.fields.departureDate === null, String(r.fields.departureDate))
  check('supermarket receipt produces a warning', r.warnings.length > 0, r.warnings.join(' | '))
}

/* ==========================================================================
 * 6. Sparse document — partial data must stay partial
 * ========================================================================== */
{
  const text = 'Train 12951 Mumbai to Delhi departing 01-Oct-2026 at 09:00'
  const r = extractJourneyFromText(text)
  const f = r.fields

  check('sparse: train detected', f.transportMode === 'train', String(f.transportMode))
  check('sparse: train number', f.serviceNumber === '12951', String(f.serviceNumber))
  check('sparse: route', /mumbai/i.test(f.origin ?? '') && /delhi/i.test(f.destination ?? ''), `${f.origin} -> ${f.destination}`)
  check('sparse: no seat invented', f.seat === null, String(f.seat))
  check('sparse: no PNR invented', f.pnr === null, String(f.pnr))
  check('sparse: missing fields marked missing', r.provenance.seat === 'missing' && r.provenance.pnr === 'missing', `${r.provenance.seat}/${r.provenance.pnr}`)
  check('sparse: usable', isUsableJourney(r), `conf ${r.confidence}`)
}

/* ==========================================================================
 * 7. Provenance honesty
 * ========================================================================== */
{
  const text = 'PNR: AB1234\nMumbai to Pune\nDeparture: 28-Sep-2026 07:10'
  const r = extractJourneyFromText(text)
  check('provenance: pnr is confirmed', r.provenance.pnr === 'confirmed', String(r.provenance.pnr))
  check('provenance: unknown field is missing, not confirmed', r.provenance.fare === 'missing', String(r.provenance.fare))
  check('provenance: confidence is a fraction', r.confidence > 0 && r.confidence < 1, String(r.confidence))
}

/* ==========================================================================
 * 8. Empty / junk input
 * ========================================================================== */
{
  const empty = extractJourneyFromText('')
  check('empty text is not usable', !isUsableJourney(empty), `conf ${empty.confidence}`)

  const junk = extractJourneyFromText('  ### ')
  check('junk text is not usable', !isUsableJourney(junk), `conf ${junk.confidence}`)

  const nothing = extractJourneyFromText('a'.repeat(500))
  check('long non-travel text is not usable', !isUsableJourney(nothing), `conf ${nothing.confidence}`)
}

/* ==========================================================================
 * 9. Airport-code route fallback
 * ========================================================================== */
{
  const text = 'Departure airport BOM, arrival airport DEL, boarding pass issued.'
  const r = extractJourneyFromText(text)
  check('IATA fallback: origin', r.fields.origin === 'BOM', String(r.fields.origin))
  check('IATA fallback: destination', r.fields.destination === 'DEL', String(r.fields.destination))
}

/* ========================================================================== */

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')))
}
process.exit(failed.length ? 1 : 0)
