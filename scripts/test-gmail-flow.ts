/**
 * Tests for the server-side pieces of the Gmail flow: the signed OAuth `state`
 * and the candidate hints. Both are pure functions, so they are verified here
 * rather than only at runtime inside Deno.
 */
import { signState, verifyState, safeReturnTo, base64UrlEncode, base64UrlDecode } from '../supabase/functions/_shared/state.ts'
import { deriveHint, senderName, parseListItem } from '../supabase/functions/_shared/gmail.ts'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`)
}

const SECRET = 'test-service-role-key-not-a-real-one'
const NOW = 1_800_000_000

/* ==========================================================================
 * state: round trip
 * ========================================================================== */
{
  const payload = { p: '11111111-1111-4111-8111-111111111111', r: 'http://localhost:5173/journeys', x: NOW + 600 }
  const state = await signState(payload, SECRET)

  check('state is a payload.signature pair', state.split('.').length === 2)
  check('state contains no raw secret', !state.includes(SECRET))
  // Look for a real JWT shape, not just "eyJ" — that substring is simply how
  // base64 encodes the "{\" at the start of the JSON payload.
  check('state contains no JWT', !/eyJhbGciOi/.test(state))
  check('state contains no dot-separated token', state.split('.').length === 2)

  const verified = await verifyState(state, SECRET, NOW)
  check('valid state verifies', verified.ok)
  if (verified.ok) {
    check('  profile id survives the round trip', verified.payload.p === payload.p, verified.payload.p)
    check('  return url survives the round trip', verified.payload.r === payload.r, verified.payload.r)
  }
}

/* ==========================================================================
 * state: it must actually reject things
 * ========================================================================== */
{
  const payload = { p: 'user-a', r: 'http://localhost:5173/journeys', x: NOW + 600 }
  const state = await signState(payload, SECRET)

  const wrongKey = await verifyState(state, 'a-different-secret', NOW)
  check('state signed with another key is rejected', !wrongKey.ok && wrongKey.reason === 'bad_signature')

  const expired = await verifyState(state, SECRET, NOW + 601)
  check('expired state is rejected', !expired.ok && expired.reason === 'expired', expired.ok ? 'accepted!' : expired.reason)

  const tamperedPayload = await verifyState(
    `${Buffer.from(JSON.stringify({ ...payload, p: 'victim' })).toString('base64url')}.${state.split('.')[1]}`,
    SECRET,
    NOW,
  )
  check('state with a swapped profile id is rejected', !tamperedPayload.ok, tamperedPayload.ok ? 'accepted!' : tamperedPayload.reason)

  const malformed = await verifyState('not-a-state', SECRET, NOW)
  check('malformed state is rejected', !malformed.ok && malformed.reason === 'malformed')

  const noSignature = await verifyState('abc', SECRET, NOW)
  check('state without a signature is rejected', !noSignature.ok)

  // A different user must not be able to authorise their own account with
  // someone else's profile id.
  const attackerState = await signState({ p: 'attacker', r: 'http://localhost:5173/journeys', x: NOW + 600 }, 'guessed-key')
  const attacker = await verifyState(attackerState, SECRET, NOW)
  check('state signed with a guessed key is rejected', !attacker.ok, attacker.ok ? 'accepted!' : attacker.reason)
}

/* ==========================================================================
 * state: base64url
 * ========================================================================== */
{
  const bytes = new Uint8Array([251, 255, 0, 1, 128, 64])
  const encoded = base64UrlEncode(bytes)
  check('base64url uses no + or / or padding', !/[+/=]/.test(encoded), encoded)
  const decoded = base64UrlDecode(encoded)
  check('base64url round trips', decoded.length === bytes.length && decoded.every((b, i) => b === bytes[i]))
}

/* ==========================================================================
 * Open redirect protection
 * ========================================================================== */
{
  const allowed = 'http://localhost:5173,https://app.wayvo.com'
  check('allowed origin is kept', safeReturnTo('https://app.wayvo.com/journeys', allowed) === 'https://app.wayvo.com/journeys')
  check('localhost is kept', safeReturnTo('http://localhost:5173/journeys', allowed).startsWith('http://localhost:5173'))
  check(
    'attacker origin is replaced with the fallback',
    safeReturnTo('https://evil.example.com/steal', allowed) === 'http://localhost:5173',
    safeReturnTo('https://evil.example.com/steal', allowed),
  )
  check('a missing value falls back', safeReturnTo(undefined, allowed) === 'http://localhost:5173')
  check('garbage falls back', safeReturnTo('javascript:alert(1)', allowed) === 'http://localhost:5173')
  check(
    'a path on an allowed origin is kept',
    safeReturnTo('https://app.wayvo.com/journeys?gmail=connected', allowed) === 'https://app.wayvo.com/journeys?gmail=connected',
  )
}

/* ==========================================================================
 * Candidate hints
 * ========================================================================== */
{
  const train = deriveHint('IRCTC <no-reply@irctc.co.in>', 'Your Train Ticket is Confirmed')
  check('train subject is classified as a train', train.kind === 'train', train.kind)
  check('  operator comes from the sender name', train.operator === 'IRCTC', String(train.operator))
  check('  status is read from the subject', train.status === 'Confirmed', String(train.status))

  const flight = deriveHint('IndiGo <noreply@goindigo.in>', 'Flight booking confirmed - 6E 2145')
  check('flight subject is classified as a flight', flight.kind === 'flight', flight.kind)

  const hotel = deriveHint('Booking.com <confirm@booking.com>', 'Your hotel reservation in Lisbon is confirmed')
  check('hotel subject is classified as a hotel', hotel.kind === 'hotel', hotel.kind)

  const unknown = deriveHint('someone@example.com', 'Hello there')
  check('unrecognised mail falls back to "booking"', unknown.kind === 'booking', unknown.kind)
  check('unrecognised mail invents no status', unknown.status === null, String(unknown.status))

  check('a quoted sender name is cleaned up', senderName('"IRCTC" <x@y.com>') === 'IRCTC', senderName('"IRCTC" <x@y.com>'))
  check('a bare address is left alone', senderName('noreply@goindigo.in') === 'noreply@goindigo.in')
}

/* ==========================================================================
 * parseListItem must not invent a route from the envelope
 * ========================================================================== */
{
  const item = parseListItem('msg-1', {
    headers: [
      { name: 'From', value: 'IRCTC <no-reply@irctc.co.in>' },
      { name: 'Subject', value: 'Train ticket confirmed' },
      { name: 'Date', value: 'Mon, 28 Sep 2026 10:00:00 +0530' },
    ],
    snippet: '   Your ticket   for tomorrow  ',
    labelIds: ['INBOX', 'ATTACHMENT'],
  })

  check('id is preserved', item.id === 'msg-1')
  check('snippet is trimmed and shortened', item.snippet === 'Your ticket for tomorrow', item.snippet)
  check('attachment flag is read', item.hasAttachment === true)
  check('hint is attached', item.hint.kind === 'train')
  check('no route is invented in the list', !('route' in item) && !('origin' in item))
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.name))
}
process.exit(failed.length ? 1 : 0)
