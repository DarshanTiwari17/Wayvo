/**
 * Reproduce the three reported problems against the CURRENT code, so the fix is
 * aimed at a confirmed cause rather than a guess.
 */
import { extractJourneyFromText, isUsableJourney } from '../src/lib/bookingParser'
import { buildItinerary, type SegmentInput } from '../src/lib/itineraryBuilder'

const results = []
const check = (n, p, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`)
}

/* ==========================================================================
 * PROBLEM 1 — a hotel confirmation must not yield a route
 * ====================================================================== */
{
  const hotelText = `
    SAVANI RESORTS
    Booking Confirmation

    Dear Guest,

    Your booking is confirmed. We look forward to welcoming you.

    Property: Alibaug Beach Resort
    Location: Alibaug

    Guest Details
    Guest: RAHUL SHARMA

    Check-in: 27 Sep 2026, 01:45 PM
    Check-out: 28 Sep 2026, 11:00 AM

    Rooms: 1
    Total Amount: Rs. 4,500
    Status: CONFIRMED
  `

  const r = extractJourneyFromText(hotelText)
  const f = r.fields

  console.log('  hotel extraction:', JSON.stringify({
    mode: f.transportMode, operator: f.operator,
    origin: f.origin, destination: f.destination,
    dep: f.departureDate + ' ' + f.departureTime,
    arr: f.arrivalDate + ' ' + f.arrivalTime,
  }))

  check('a hotel is classified as a hotel', f.transportMode === 'hotel', String(f.transportMode))
  check('  the property name is read', /alibaug beach resort/i.test(f.operator ?? ''), String(f.operator))
  check('  it has NO origin', f.origin === null, String(f.origin))
  check('  it has NO destination', f.destination === null, String(f.destination))
  check('  "welcoming you" was not read as a place', !/welcom/i.test(f.origin ?? '') && !/welcom/i.test(f.destination ?? ''))
  check('  check-in became the start', f.departureTime === '13:45', String(f.departureTime))
  check('  check-out became the end', f.arrivalTime === '11:00', String(f.arrivalTime))
  check('  it is still usable', isUsableJourney(r), `conf ${r.confidence}`)
}

/* ==========================================================================
 * PROBLEM 2 — the Alibaug example, uploaded hotel-first
 * ====================================================================== */
{
  const seg = (o: Partial<SegmentInput>): SegmentInput => ({
    id: Math.random().toString(36).slice(2),
    origin: null, destination: null, departureAt: null, arrivalAt: null,
    transportMode: null, operator: null, serviceNumber: null,
    bookingReference: null, pnr: null, passengerName: null, seat: null,
    coach: null, terminal: null, fareAmount: null, fareCurrency: null,
    bookingStatus: null, source: 'upload', confidence: 0.9, ...o,
  })

  // Hotel uploaded FIRST, then train, then bus — the exact reported symptom.
  const input = [
    seg({ transportMode: 'hotel', operator: 'Alibaug Beach Resort', departureAt: '2026-09-27T13:45:00', arrivalAt: '2026-09-28T11:00:00' }),
    seg({ origin: 'Mumbai Central', destination: 'Panvel', transportMode: 'train', departureAt: '2026-09-27T08:00:00', arrivalAt: '2026-09-27T09:15:00' }),
    seg({ origin: 'Panvel', destination: 'Alibaug', transportMode: 'bus', departureAt: '2026-09-27T11:15:00', arrivalAt: '2026-09-27T12:45:00' }),
  ]

  const r = buildItinerary(input)
  const order = r.segments.map((s) => `${s.transportMode}:${s.origin ?? s.operator}`).join(' | ')
  console.log('  order:', order)

  check('train is first', r.segments[0].transportMode === 'train', order)
  check('bus is second', r.segments[1].transportMode === 'bus', order)
  check('hotel is third', r.segments[2].transportMode === 'hotel', order)
  check('  bus→hotel gap is 60 min', r.segments[2].connectionMinutes === 60, String(r.segments[2].connectionMinutes))
  check('  train→bus gap is 120 min', r.segments[1].connectionMinutes === 120, String(r.segments[1].connectionMinutes))
}

/* ==========================================================================
 * PROBLEM 3 — does a manual reorder survive a rebuild?
 * ====================================================================== */
{
  const seg = (o: Partial<SegmentInput>): SegmentInput => ({
    id: Math.random().toString(36).slice(2),
    origin: null, destination: null, departureAt: null, arrivalAt: null,
    transportMode: null, operator: null, serviceNumber: null,
    bookingReference: null, pnr: null, passengerName: null, seat: null,
    coach: null, terminal: null, fareAmount: null, fareCurrency: null,
    bookingStatus: null, source: 'upload', confidence: 0.9, ...o,
  })

  const train = seg({ origin: 'Mumbai Central', destination: 'Panvel', transportMode: 'train', departureAt: '2026-09-27T08:00:00', arrivalAt: '2026-09-27T09:15:00' })
  const bus = seg({ origin: 'Panvel', destination: 'Alibaug', transportMode: 'bus', departureAt: '2026-09-27T11:15:00', arrivalAt: '2026-09-27T12:45:00' })
  const hotel = seg({ transportMode: 'hotel', operator: 'Alibaug Beach Resort', departureAt: '2026-09-27T13:45:00', arrivalAt: '2026-09-28T11:00:00' })

  // Automatic order
  const auto = buildItinerary([train, bus, hotel])
  console.log('  auto order:', auto.segments.map((s) => s.transportMode).join(','))

  // Traveller moves the hotel to the END and confirms. saveSegmentOrder marks
  // every moved row sequence_confirmed = true.
  const manual = auto.segments.map((s) => ({ ...s, sequenceConfirmed: true }))
  // simulate the reorder: train, bus, hotel -> train, bus, hotel is already
  // last, so instead move the BUS below the hotel: train, hotel, bus
  const reordered = [manual[0], manual[2], manual[1]]

  // A rebuild reads the confirmed rows back. Does it keep the manual order?
  const rebuilt = buildItinerary(reordered.map((s) => ({ ...s })))
  console.log('  after rebuild:', rebuilt.segments.map((s) => s.transportMode).join(','))

  check('a confirmed manual order survives the rebuild',
    rebuilt.segments.map((s) => s.transportMode).join(',') === 'train,hotel,bus',
    rebuilt.segments.map((s) => s.transportMode).join(','))
}

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.n))
}
