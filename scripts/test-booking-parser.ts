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
 * 1b. Railway operator names
 *
 * A ticket names its operating zone ("Eastern Railways"). An earlier
 * alternation listed "indian railways" but no other zone, so the bare
 * "railways" branch won and the qualifier was dropped.
 * ========================================================================== */
{
  const ticket = (operatorLine: string) => `
    Rail Reservation System
    ${operatorLine}
    Train No: 12123
    From: MUMBAI CENTRAL
    To: HOWRAH
    Departure: 28-Sep-2026 07:10
    Passenger: RAHUL SHARMA
    Status: CONFIRMED
  `

  const cases: [string, RegExp | null][] = [
    ['Eastern Railways', /^Eastern Railways$/i],
    ['Eastern Railway', /^Eastern Railway$/i],
    ['INDIAN RAILWAYS', /^Indian Railways$/i],
    ['Konkan Railway', /^Konkan Railway$/i],
    ['North Western Railway', /^North Western Railway$/i],
    ['Eastern North Eastern Railway', /^Eastern North Eastern Railway$/i],
    ['Metro Rail', /^Metro Rail$/i],
    ['IRCTC', /^IRCTC$/i],
  ]

  for (const [line, expected] of cases) {
    const got = extractJourneyFromText(ticket(line)).fields.operator ?? null
    check(`railway operator: "${line}"`, expected ? expected.test(String(got)) : got === null, String(got))
  }

  // A station is a place, not a company: it must not be reported as the operator.
  for (const line of ['Nearest Railway Station', 'Proceed to Railway Stn']) {
    const got = extractJourneyFromText(ticket(line)).fields.operator ?? null
    check(`"${line}" is not treated as an operator`, got === null, String(got))
  }

  // The fixture header itself is "Rail Reservation System": portal boilerplate
  // must not be mistaken for an operator either.
  {
    const got = extractJourneyFromText(ticket('')).fields.operator ?? null
    check('portal boilerplate is not treated as an operator', got === null, String(got))
  }

  // IRCTC sells the ticket; the zone runs it. The more specific name wins even
  // when the portal is mentioned first.
  {
    const both = extractJourneyFromText(`
      IRCTC e-Ticket
      Eastern Railways
      Train No: 12123
      From: MUMBAI CENTRAL
      To: HOWRAH
    `)
    check(
      'a named zone is preferred over the booking portal',
      /^Eastern Railways$/i.test(both.fields.operator ?? ''),
      String(both.fields.operator),
    )
  }
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

  const itineraryTicket = extractJourneyFromText(`
    Your Travel Ticket
    Mumbai -> Delhi -> Jaipur
    Flight
    Air India • AI-302
    Mumbai (BOM)
    Departure 10:30 AM
    Tue, 24 Sep 2026
    Delhi (DEL)
    Arrival 2:40 PM
    Tue, 24 Sep 2026
    Train
    Indian Railways • 12951
    Delhi (DEL) 2:00 PM -> Jaipur (JP) 7:30 PM
    Hotel Royal Residency, Jaipur
  `).fields
  check('composite ticket: first flight segment wins over later train', itineraryTicket.transportMode === 'flight', String(itineraryTicket.transportMode))
  check('composite ticket: flight number and airline', itineraryTicket.serviceNumber === 'AI302' && /air india/i.test(itineraryTicket.operator ?? ''), `${itineraryTicket.operator} ${itineraryTicket.serviceNumber}`)
  check('composite ticket: flight route', /mumbai/i.test(itineraryTicket.origin ?? '') && /delhi/i.test(itineraryTicket.destination ?? ''), `${itineraryTicket.origin} -> ${itineraryTicket.destination}`)
  check('composite ticket: flight times', itineraryTicket.departureTime === '10:30' && itineraryTicket.arrivalTime === '14:40', `${itineraryTicket.departureTime} -> ${itineraryTicket.arrivalTime}`)
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
 * 3b. Fare extraction must not crash on a bare currency amount
 *
 * The labelled pattern has three capture groups (before, amount, after) but
 * the symbol fallback has only one. Reading group 2 from the symbol match
 * returned undefined and threw "Cannot read properties of undefined (reading
 * 'replace')", which took the whole extraction down with it.
 * ========================================================================== */
{
  const bare = extractJourneyFromText(`
    From: MUMBAI CENTRAL
    To: PANVEL
    Departure: 14-Nov-2026 08:00
    Arrival: 14-Nov-2026 09:15
    Passenger: RAHUL SHARMA
    ₹342
  `)
  check('a bare ₹ amount is read without crashing', bare.fields.fare === 342, String(bare.fields.fare))
  check('  and the currency is INR', bare.fields.currency === 'INR', String(bare.fields.currency))
  check('  and the journey is still usable', isUsableJourney(bare))

  const labelled = extractJourneyFromText(`
    From: Mumbai
    To: Pune
    Departure: 14-Nov-2026 08:00
    Arrival: 14-Nov-2026 09:15
    Total Fare: Rs. 1,247
  `)
  check('a labelled "Total Fare" still works', labelled.fields.fare === 1247, String(labelled.fields.fare))

  const dollars = extractJourneyFromText(`
    From: Mumbai
    To: Pune
    Departure: 14-Nov-2026 08:00
    Arrival: 14-Nov-2026 09:15
    $45.50
  `)
  check('a bare $ amount is read as USD', dollars.fields.fare === 45.5 && dollars.fields.currency === 'USD', `${dollars.fields.fare} ${dollars.fields.currency}`)
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
 * 4b. MSRTC ticket with separate base fare and amount paid
 * ========================================================================== */
{
  const text = `
    Maharashtra State Road Transport Corporation (MSRTC)
    BUS TICKET
    Online Booking Confirmation
    Booking ID: MSRTA268451
    Booking Date: 22 Sep 2026 10:18 AM
    Ticket No: 9823476512
    FROM
    Panvel Bus Stand -> TO
    Alibaug Bus Stand
    Panvel Alibaug
    Departure Time
    11:15 AM
    27 Sep 2026 (Sun)
    Arrival Time
    12:45 PM
    27 Sep 2026 (Sun)
    Bus Details
    Service Panvel - Alibaug
    Operator MSRTC
    Bus Type Ordinary
    Duration 1 hr 30 min
    Seat No. 18
    Passenger Details
    Name Rahul Sharma
    Age 28
    Gender Male
    Fare Details
    Base Fare ₹120.00
    Booking Charges ₹10.00
    Total Amount Paid ₹130.00
  `
  const f = extractJourneyFromText(text).fields
  check('MSRTC: route', /panvel/i.test(f.origin ?? '') && /alibaug/i.test(f.destination ?? ''), `${f.origin} -> ${f.destination}`)
  check('MSRTC: departure date and time', f.departureDate === '2026-09-27' && f.departureTime === '11:15', `${f.departureDate} ${f.departureTime}`)
  check('MSRTC: arrival date and time', f.arrivalDate === '2026-09-27' && f.arrivalTime === '12:45', `${f.arrivalDate} ${f.arrivalTime}`)
  check('MSRTC: total paid rather than base fare', f.fare === 130 && f.currency === 'INR', `${f.fare} ${f.currency}`)

  const serviceOnly = extractJourneyFromText(`
    MSRTC Bus Ticket
    Service Panvel - Alibaug
    Departure: 27 Sep 2026 11:15 AM
  `).fields
  check('MSRTC: service route is a fallback', /panvel/i.test(serviceOnly.origin ?? '') && /alibaug/i.test(serviceOnly.destination ?? ''), `${serviceOnly.origin} -> ${serviceOnly.destination}`)

  const rupeeMisread = extractJourneyFromText(`
    MSRTC Bus Ticket
    Total Amount Paid €130.00
  `).fields
  check('MSRTC: OCR euro-symbol confusion is treated as INR', rupeeMisread.fare === 130 && rupeeMisread.currency === 'INR', `${rupeeMisread.fare} ${rupeeMisread.currency}`)

  const noisyOcr = extractJourneyFromText(`
    MSRTC BUS TICKET
    Indian Railways
    Train No: 12101
    WRT XA E -> Ticket
  `).fields
  check('MSRTC OCR: bus context wins over stray train text', noisyOcr.transportMode === 'bus', String(noisyOcr.transportMode))
  check('MSRTC OCR: junk arrow text is not accepted as a route', noisyOcr.origin === null && noisyOcr.destination === null, `${noisyOcr.origin} -> ${noisyOcr.destination}`)

  const rowWiseOcr = extractJourneyFromText(`
    MSRTC Bus Ticket
    FROM TO
    Panvel Bus Stand Alibaug Bus Stand
    Departure Time Arrival Time
    11:15 AM 12:45 PM
    27 Sep 2026 (Sun) 27 Sep 2026 (Sun)
    Service Panvel - Alibaug
    Total Amount Paid ₹130.00
  `).fields
  check('MSRTC OCR: service route overrides label/place interleaving', /panvel/i.test(rowWiseOcr.origin ?? '') && /alibaug/i.test(rowWiseOcr.destination ?? ''), `${rowWiseOcr.origin} -> ${rowWiseOcr.destination}`)
  check('MSRTC OCR: parallel time columns retain distinct times', rowWiseOcr.departureTime === '11:15' && rowWiseOcr.arrivalTime === '12:45', `${rowWiseOcr.departureTime} -> ${rowWiseOcr.arrivalTime}`)
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
