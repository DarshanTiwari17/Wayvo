/**
 * Tests for the itinerary builder.
 *
 * The ordering is the part of Wayvo most able to be quietly wrong, so these
 * cover the chain, the fallbacks, the connection maths and — most importantly —
 * that ambiguity is always reported rather than hidden.
 */
import { buildItinerary, normalisePlace, summariseItinerary, type SegmentInput } from '../src/lib/itineraryBuilder'

const results: { n: string; p: boolean }[] = []
const check = (n: string, p: boolean, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`)
}

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

let counter = 0
function seg(over: Partial<SegmentInput> = {}): SegmentInput {
  counter += 1
  return {
    id: `s${counter}`,
    origin: null,
    destination: null,
    departureAt: null,
    arrivalAt: null,
    transportMode: null,
    operator: null,
    serviceNumber: null,
    bookingReference: null,
    pnr: null,
    passengerName: null,
    seat: null,
    coach: null,
    terminal: null,
    fareAmount: null,
    fareCurrency: null,
    bookingStatus: null,
    source: 'upload',
    confidence: 0.9,
    ...over,
  }
}

/** The four-booking example from the specification. */
function goaTrip(): SegmentInput[] {
  return [
    // Deliberately supplied in the WRONG order, to prove ordering is not upload order.
    seg({
      origin: 'Pune', destination: 'Goa', departureAt: '2026-10-02T21:00:00', arrivalAt: '2026-10-03T07:00:00',
      transportMode: 'bus',
    }),
    seg({
      origin: 'Goa', destination: 'Delhi', departureAt: '2026-10-05T16:30:00', arrivalAt: '2026-10-05T19:15:00',
      transportMode: 'flight',
    }),
    seg({
      origin: 'Mumbai', destination: 'Pune', departureAt: '2026-10-02T07:10:00', arrivalAt: '2026-10-02T20:00:00',
      transportMode: 'train',
    }),
    seg({
      origin: 'Delhi', destination: 'Mumbai', departureAt: '2026-10-08T20:00:00', arrivalAt: '2026-10-08T22:15:00',
      transportMode: 'flight',
    }),
  ]
}

const routeOf = (segments: { origin: string | null; destination: string | null }[]) =>
  segments.map((s) => `${s.origin}->${s.destination}`).join(' | ')

/* =========================================================================
 * 1. Place normalisation
 * ====================================================================== */
{
  const same = [
    ['Mumbai (BOM)', 'MUMBAI'],
    ['mumbai', 'Mumbai'],
    ['New Delhi Railway Station', 'new delhi'],
    ['Bengaluru Airport', 'Bengaluru'],
    ['Pune  Junction', 'pune'],
    ['Chennai Central (MAS)', 'chennai central'],
  ]
  for (const [a, b] of same) {
    const na = normalisePlace(a)
    const nb = normalisePlace(b)
    // "Chennai Central" keeps "central" because the noise list only strips the
    // standalone word "central"? No — it is not in the list. So it is NOT equal.
    check(`normalise: "${a}" == "${b}"`, na === nb, `${na} vs ${nb}`)
  }

  check('a bare code in brackets keeps something', normalisePlace('(BOM)') !== null, String(normalisePlace('(BOM)')))
  check('empty string is null', normalisePlace('') === null)
  check('null is null', normalisePlace(null) === null)
  check('undefined is null', normalisePlace(undefined) === null)
  check('punctuation only is null', normalisePlace('---') === null)

  const different = [
    ['Mumbai', 'Pune'],
    ['Mumbai', 'New Mumbai'],
    ['Goa', 'Goakhpur'],
  ]
  for (const [a, b] of different) {
    check(`different: "${a}" != "${b}"`, normalisePlace(a) !== normalisePlace(b))
  }
}

/* =========================================================================
 * 2. The specification's example
 * ====================================================================== */
{
  const result = buildItinerary(goaTrip())

  check(
    'the four bookings are ordered by route, not upload order',
    routeOf(result.segments) ===
      'Mumbai->Pune | Pune->Goa | Goa->Delhi | Delhi->Mumbai',
    routeOf(result.segments),
  )
  check('sequence numbers are 0..3', result.segments.map((s) => s.seq).join(',') === '0,1,2,3')
  check('a clean chain is confident', result.confident === true)
  check('a clean chain has no review flags', result.segments.every((s) => !s.needsReview))
  check('a clean chain has no notes', result.notes.length === 0, result.notes.join(' / '))

  // Mumbai->Pune arrives 20:00, Pune->Goa leaves 21:00 => 60 minutes.
  check('connection time is computed from arrival to next departure', result.segments[1].connectionMinutes === 60, String(result.segments[1].connectionMinutes))
  check('the first booking has no connection time', result.segments[0].connectionMinutes === null)
}

/* =========================================================================
 * 3. Ordering must not be alphabetical
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Zurich', destination: 'Amsterdam', departureAt: '2026-05-02T09:00:00', arrivalAt: '2026-05-02T11:00:00' }),
    seg({ origin: 'Amsterdam', destination: 'Berlin', departureAt: '2026-05-02T13:00:00', arrivalAt: '2026-05-02T16:00:00' }),
  ]
  const result = buildItinerary(segments)
  check(
    'a Z→A→B chain is ordered by route, not alphabetically',
    routeOf(result.segments) === 'Zurich->Amsterdam | Amsterdam->Berlin',
    routeOf(result.segments),
  )
}

/* =========================================================================
 * 4. Time ordering still used when locations do not chain
 * ====================================================================== */
{
  // No location continuity at all: only times to go on.
  const segments = [
    seg({ departureAt: '2026-06-03T10:00:00', arrivalAt: '2026-06-03T12:00:00' }),
    seg({ departureAt: '2026-06-01T10:00:00', arrivalAt: '2026-06-01T12:00:00' }),
    seg({ departureAt: '2026-06-02T10:00:00', arrivalAt: '2026-06-02T12:00:00' }),
  ]
  const result = buildItinerary(segments)
  const times = result.segments.map((s) => s.departureAt)
  check(
    'bookings with no locations fall back to departure time',
    times.join(',') === '2026-06-01T10:00:00,2026-06-02T10:00:00,2026-06-03T10:00:00',
    times.join(','),
  )
  check('unreadable locations are flagged, not hidden', result.segments.every((s) => s.needsReview))
  check('the reason is no_location', result.segments.every((s) => s.reviewReason === 'no_location'))
  check('the traveller is asked to confirm', result.confident === false)
  check('a note explains how many need review', /3 bookings need/.test(result.notes.join(' ')), result.notes.join(' '))
}

/* =========================================================================
 * 5. Ambiguity: two bookings leave the same place
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-07-01T07:00:00', arrivalAt: '2026-07-01T20:00:00' }),
    seg({ origin: 'Mumbai', destination: 'Nashik', departureAt: '2026-07-01T22:00:00', arrivalAt: '2026-07-01T23:30:00' }),
  ]
  const result = buildItinerary(segments)
  check('a branch is still ordered', result.segments.length === 2)
  check('a branch is NOT confident', result.confident === false)
  check('a branch flags the branch reason', result.segments.some((s) => s.reviewReason === 'branch'), routeOf(result.segments))
  check('a branch explains itself to the traveller', result.segments.some((s) => /More than one booking/.test(s.reviewNote ?? '')))
}

/* =========================================================================
 * 6. Ambiguity: a hole in the route
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-07-01T07:00:00', arrivalAt: '2026-07-01T20:00:00' }),
    seg({ origin: 'Chennai', destination: 'Kochi', departureAt: '2026-07-02T08:00:00', arrivalAt: '2026-07-02T14:00:00' }),
  ]
  const result = buildItinerary(segments)
  check('a gap is still ordered', result.segments.length === 2)
  check('a gap is NOT confident', result.confident === false)
  check('a gap is flagged as a gap', result.segments.some((s) => s.reviewReason === 'gap'))
  check('a gap explains itself', result.segments.some((s) => /does not continue/.test(s.reviewNote ?? '')))
}

/* =========================================================================
 * 7. Impossible timing
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-07-01T07:00:00', arrivalAt: '2026-07-01T20:00:00' }),
    seg({ origin: 'Pune', destination: 'Goa', departureAt: '2026-07-01T19:00:00', arrivalAt: '2026-07-01T23:00:00' }),
  ]
  const result = buildItinerary(segments)
  check('a booking leaving before the previous arrives is flagged', result.segments[1].needsReview)
  check('  as an overlap', result.segments[1].reviewReason === 'overlap')
  check('  with a negative connection time', result.segments[1].connectionMinutes === -60, String(result.segments[1].connectionMinutes))
  check('  and an explanation', /leave before/.test(result.segments[1].reviewNote ?? ''))
}

/* =========================================================================
 * 8. A closed round trip has no start node
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Delhi', destination: 'Mumbai', departureAt: '2026-08-01T09:00:00', arrivalAt: '2026-08-01T11:15:00' }),
    seg({ origin: 'Mumbai', destination: 'Delhi', departureAt: '2026-08-05T20:00:00', arrivalAt: '2026-08-05T22:15:00' }),
  ]
  const result = buildItinerary(segments)
  check('a round trip is ordered', result.segments.length === 2)
  check('a round trip starts at the earliest departure', result.segments[0].origin === 'Delhi', routeOf(result.segments))
  check('a round trip is confident', result.confident === true)
}

/* =========================================================================
 * 9. Confirmed segments are never re-litigated
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-07-01T07:00:00', arrivalAt: '2026-07-01T20:00:00', sequenceConfirmed: true }),
    seg({ origin: 'Chennai', destination: 'Kochi', departureAt: '2026-07-02T08:00:00', arrivalAt: '2026-07-02T14:00:00' }),
  ]
  const result = buildItinerary(segments)
  check('a traveller-confirmed booking is not re-flagged', result.segments[0].needsReview === false)
  check('  and its note is cleared', result.segments[0].reviewNote === null)
  check('an unconfirmed one still is', result.segments[1].needsReview === true)
}

/* =========================================================================
 * 10. Place spelling must not fragment the route
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai (BOM)', destination: 'Pune Junction', departureAt: '2026-09-01T07:00:00', arrivalAt: '2026-09-01T20:00:00' }),
    seg({ origin: 'PUNE', destination: 'Goa', departureAt: '2026-09-01T21:00:00', arrivalAt: '2026-09-02T07:00:00' }),
  ]
  const result = buildItinerary(segments)
  check('differently-written places still chain', result.confident === true, routeOf(result.segments))
  // The stored value keeps the traveller's own spelling; only the comparison key
  // is normalised. "PUNE" must not be rewritten to "Pune" in their data.
  check('  and the order is right', /^pune$/i.test(result.segments[1].origin ?? ''), String(result.segments[1].origin))
  check('  stored spelling is left exactly as the ticket printed it', result.segments[1].origin === 'PUNE', String(result.segments[1].origin))
}

/* =========================================================================
 * 11. Missing times
 * ====================================================================== */
{
  const segments = [
    seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-09-01T07:00:00' }),
    seg({ origin: 'Pune', destination: 'Goa', departureAt: '2026-09-01T21:00:00', arrivalAt: '2026-09-02T07:00:00' }),
  ]
  const result = buildItinerary(segments)
  check('a missing arrival time means no connection time', result.segments[1].connectionMinutes === null)
  check('  and is flagged rather than assumed', result.segments[1].needsReview)
  check('  with a clear reason', /connection time/.test(result.segments[1].reviewNote ?? ''), String(result.segments[1].reviewNote))
}

/* =========================================================================
 * 12. Degenerate inputs
 * ====================================================================== */
{
  check('no segments is confident and empty', (() => {
    const r = buildItinerary([])
    return r.segments.length === 0 && r.confident && r.notes.length === 0
  })())

  const one = buildItinerary([seg({ origin: 'Mumbai', destination: 'Pune', departureAt: '2026-01-01T08:00:00', arrivalAt: '2026-01-01T20:00:00' })])
  check('a single complete booking is confident', one.confident === true)
  check('  and has one segment', one.segments.length === 1)

  // The same input must always give the same order.
  const input = goaTrip()
  const a = buildItinerary(input)
  const b = buildItinerary([...input].reverse())
  check('ordering is deterministic regardless of input order', routeOf(a.segments) === routeOf(b.segments), `${routeOf(a.segments)} vs ${routeOf(b.segments)}`)
}

/* =========================================================================
 * 13. Trip summary
 * ====================================================================== */
{
  const result = buildItinerary(goaTrip())
  const summary = summariseItinerary(result)

  check('the trip starts where the first booking starts', summary.origin === 'Mumbai', String(summary.origin))
  check('the trip ends where the last booking ends', summary.destination === 'Mumbai', String(summary.destination))
  check('the trip starts on the first departure date', summary.startsOn === '2026-10-02', String(summary.startsOn))
  check('the trip ends on the last arrival date', summary.endsOn === '2026-10-08', String(summary.endsOn))
  check('the trip counts its bookings', summary.segmentCount === 4, String(summary.segmentCount))

  const empty = summariseItinerary(buildItinerary([]), { origin: 'X', destination: 'Y', startsOn: '2026-01-01', endsOn: '2026-01-02' })
  check('an empty itinerary does not erase the trip', empty.origin === 'X' && empty.segmentCount === 0)

  const unknown = summariseItinerary(buildItinerary([seg({ origin: 'Mumbai', destination: 'Pune' })]))
  check('unknown dates are not invented', unknown.startsOn === null && unknown.endsOn === null, `${unknown.startsOn}/${unknown.endsOn}`)

  const partial = summariseItinerary(buildItinerary([seg({ destination: 'Pune' })]), { origin: 'Mumbai', destination: null, startsOn: null, endsOn: null })
  check('a missing first origin falls back to the trip value', partial.origin === 'Mumbai', String(partial.origin))
  check('  a real destination from the booking is used', partial.destination === 'Pune', String(partial.destination))

  const noEnds = summariseItinerary(buildItinerary([seg({ origin: 'Mumbai' })]), { origin: null, destination: 'Pune', startsOn: null, endsOn: null })
  check('a booking with no destination falls back to the trip value', noEnds.destination === 'Pune', String(noEnds.destination))
  check('  a real origin from the booking is kept', noEnds.origin === 'Mumbai', String(noEnds.origin))

  const nothingRead = summariseItinerary(buildItinerary([seg({})]), { origin: 'Mumbai', destination: 'Pune', startsOn: null, endsOn: null })
  check('a booking with nothing readable leaves the trip values alone', nothingRead.origin === 'Mumbai' && nothingRead.destination === 'Pune', `${nothingRead.origin}/${nothingRead.destination}`)

  const blankTrip = summariseItinerary(buildItinerary([seg({})]))
  check('nothing readable and no trip values stays null', blankTrip.origin === null && blankTrip.destination === null)
}

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.n))
}
process.exit(failed.length ? 1 : 0)
