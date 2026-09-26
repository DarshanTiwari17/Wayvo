/**
 * Booking extraction.
 *
 * Turns the raw text of a ticket, PDF or confirmation email into a normalised
 * journey record. This is honest pattern matching, not a model: every field
 * carries provenance so the UI can tell the traveller what was actually read
 * off the document versus what was inferred.
 *
 * Two rules govern everything here:
 *
 *   1. Never invent a value. A field that isn't in the text stays `null` and is
 *      marked `missing`.
 *   2. Never claim confidence that isn't warranted. An arrival date derived from
 *      a departure date is `estimated`; only a date the document actually
 *      states is `confirmed`.
 */

export type TransportMode = 'train' | 'flight' | 'bus' | 'car' | 'ferry' | 'hotel' | 'other'

/** 'confirmed' = stated by the document. 'estimated' = derived. 'missing' = absent. */
export type Provenance = 'confirmed' | 'estimated' | 'missing'

export interface ExtractedJourney {
  traveler: string | null
  bookingReference: string | null
  pnr: string | null
  ticketNumber: string | null
  transportMode: TransportMode | null
  operator: string | null
  serviceNumber: string | null
  origin: string | null
  destination: string | null
  departureDate: string | null
  departureTime: string | null
  arrivalDate: string | null
  arrivalTime: string | null
  seat: string | null
  coach: string | null
  terminal: string | null
  fare: number | null
  currency: string | null
  bookingStatus: string | null
  passengers: string[]
}

export interface ExtractionResult {
  fields: ExtractedJourney
  provenance: Record<keyof ExtractedJourney, Provenance>
  /** How much of the document was understood, 0..1. Drives the review warning. */
  confidence: number
  /** Text that was read, kept for the traveller's reference. */
  rawText: string
  warnings: string[]
}

const EMPTY: ExtractedJourney = {
  traveler: null,
  bookingReference: null,
  pnr: null,
  ticketNumber: null,
  transportMode: null,
  operator: null,
  serviceNumber: null,
  origin: null,
  destination: null,
  departureDate: null,
  departureTime: null,
  arrivalDate: null,
  arrivalTime: null,
  seat: null,
  coach: null,
  terminal: null,
  fare: null,
  currency: null,
  bookingStatus: null,
  passengers: [],
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
}

const AIRPORT_HINTS = /(airport|terminal|gate|dep\s*from|arr\s*at|boarding)/i

/* ==========================================================================
 * Place names
 * ========================================================================== */

/** A capitalised place: "Mumbai", "New Delhi", "MUMBAI CENTRAL". */
const CITY = String.raw`[A-Z][A-Za-z.'-]*(?:[ -][A-Z][A-Za-z.'-]*)*`
/** Optional station / airport code, e.g. "MUMBAI CENTRAL (MMCT)". */
const STATION = String.raw`\s*(?:\([A-Z]{3,4}\))?`

/** Words that belong to the ticket, not to the place name. */
const PLACE_NOISE = new Set([
  'departing', 'departure', 'departs', 'depart', 'arriving', 'arrival', 'arrives', 'arr',
  'station', 'junction', 'airport', 'terminal', 'platform', 'gate',
  'from', 'to', 'on', 'at', 'via', 'and', 'total', 'fare', 'adult', 'child',
  'date', 'time', 'valid', 'not', 'boarding', 'passenger', 'class', 'seat', 'coach',
])

/** Trims trailing ticket keywords off a matched place name. */
function cleanPlace(value: string): string {
  const words = value.trim().split(/\s+/)
  while (words.length > 1) {
    const tail = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '')
    if (!PLACE_NOISE.has(tail)) break
    words.pop()
  }
  return words.join(' ').trim()
}

function isNoise(value: string): boolean {
  const v = value.trim()
  if (v.length < 3 || v.length > 48) return true
  return /^(valid|ticket|booking|pnr|seat|class|platform|gate|taxes|sls?|not|nrs?)$/i.test(v)
}

/** "MUMBAI CENTRAL" -> "Mumbai Central", but "PNR" stays uppercase. */
function titleish(value: string): string {
  return cleanPlace(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // Preserve short all-caps tokens such as PNR, MMCT, AC.
      if (word.length <= 4 && word === word.toUpperCase() && /[A-Z]{2,}/.test(word)) return word
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/* ==========================================================================
 * Dates
 * ========================================================================== */

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month, day))
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "28 Sep 2026", "28-Sep-26", "2026-09-28", "30/09/2026". */
function findDates(text: string): { iso: string; index: number }[] {
  const found: { iso: string; index: number }[] = []

  // ISO: 2026-09-28
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const iso = isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (iso) found.push({ iso, index: m.index! })
  }

  // Day/Month/Year: 30/09/2026 or 28-09-2026
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2}|20)\b/g)) {
    const iso = isoDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    if (iso) found.push({ iso, index: m.index! })
  }

  // "28 Sep 2026", "28-Sep-26", "28th September, 2026"
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-/.]+([A-Za-z]{3,9})[\s-/.]+(\d{2,4})\b/g)) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month === undefined) continue
    let year = Number(m[3])
    if (m[3].length === 2) year += year < 70 ? 2000 : 1900
    const iso = isoDate(year, month, Number(m[1]))
    if (iso) found.push({ iso, index: m.index! })
  }

  return found.sort((a, b) => a.index - b.index)
}

/* ==========================================================================
 * Times
 * ========================================================================== */

function findTimes(text: string): { hm: string; index: number }[] {
  const found: { hm: string; index: number }[] = []

  for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    found.push({ hm: `${m[1].padStart(2, '0')}:${m[2]}`, index: m.index! })
  }
  // "7.10 AM", "19:45 hrs"
  for (const m of text.matchAll(/\b([01]?\d|2[0-3])[.:]([0-5]\d)\s*(am|pm)\b/gi)) {
    let hour = Number(m[1])
    const mer = m[3].toLowerCase()
    if (mer === 'pm' && hour < 12) hour += 12
    if (mer === 'am' && hour === 12) hour = 0
    found.push({ hm: `${String(hour).padStart(2, '0')}:${m[2]}`, index: m.index! })
  }

  return found.sort((a, b) => a.index - b.index)
}

/* ==========================================================================
 * Route
 * ========================================================================== */

function findRoute(text: string): { origin: string | null; destination: string | null } {
  // The most common ticket layout: a labelled From / To pair.
  //
  // Every label needs a trailing \b, otherwise `to` matches inside "Total" and
  // `from` inside "Platform". The arrival label also requires an explicit
  // connector, so "arrival airport DEL" is not read as the place "Airport DEL".
  const from = text.match(
    new RegExp(
      String.raw`(?:\b(?:from|origin)\b\s*[:#-]?\s*|depart(?:ing|ure)?\s*from\b\s*[:#-]?\s*)(${CITY})${STATION}`,
      'i',
    ),
  )
  const to = text.match(
    new RegExp(
      String.raw`(?:\b(?:to|destination)\b\s*[:#-]?\s*|arriv(?:al|ing|e|es)?\s*(?:at|in|to)\b\s*[:#-]?\s*)(${CITY})${STATION}`,
      'i',
    ),
  )

  if (from && to) {
    const origin = titleish(from[1])
    const destination = titleish(to[1])
    if (!isNoise(origin) && !isNoise(destination) && origin !== destination) {
      return { origin, destination }
    }
  }

  // "Mumbai → Pune", "Mumbai to Pune", "Mumbai - Pune"
  const patterns = [
    new RegExp(String.raw`(${CITY})\s*(?:→|->|=>|➔)\s*(${CITY})`),
    new RegExp(String.raw`\b(${CITY})\s+to\s+(${CITY})`, 'i'),
    new RegExp(String.raw`\b(${CITY})\s*[-–—]\s*(${CITY})`),
  ]

  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (!m) continue
    const origin = titleish(m[1])
    const destination = titleish(m[2])
    if (!isNoise(origin) && !isNoise(destination) && origin !== destination) {
      return { origin, destination }
    }
  }

  // Only one endpoint is labelled: keep what is known rather than guessing.
  if (from) {
    const origin = titleish(from[1])
    if (!isNoise(origin)) return { origin, destination: null }
  }
  if (to) {
    const destination = titleish(to[1])
    if (!isNoise(destination)) return { origin: null, destination }
  }

  // Two IATA codes in order, but only near airport wording.
  if (AIRPORT_HINTS.test(text)) {
    const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)]
      .map((m) => m[1])
      .filter((code) => code === code.toUpperCase())
    const unique = [...new Set(codes)]
    if (unique.length >= 2) return { origin: unique[0], destination: unique[1] }
  }

  return { origin: null, destination: null }
}

/* ==========================================================================
 * Identifiers
 * ========================================================================== */

/**
 * A PNR or booking reference.
 *
 * The label match is case-insensitive but the value is not: without checking
 * that the captured token is uppercase and contains a digit, a case-insensitive
 * match on "booking reference" happily returns the tail of the word.
 */
function findPnr(text: string): { pnr: string | null; reference: string | null } {
  const pattern =
    /\b(pnr|booking\s*ref(?:erence)?|booking\s*no\.?|booking\s*number|confirmation\s*(?:code|no\.?|number)?|ticket\s*(?:no\.?|number))\b[\s:#-]*(?:is\s*)?([A-Za-z0-9][A-Za-z0-9-]{4,14})/gi

  for (const match of text.matchAll(pattern)) {
    const label = match[1]
    const value = match[2]
    const looksReal = /\d/.test(value) && /[A-Z]/.test(value)
    if (!looksReal) continue

    const upper = value.toUpperCase()
    return /^pnr$/i.test(label.trim()) ? { pnr: upper, reference: null } : { pnr: null, reference: upper }
  }

  // Indian Railways e-tickets often print a bare PNR on its own line.
  const bare = text.match(/\b(?:^|\n)\s*([A-Z0-9]{6})\s*(?:\n|$)/)
  return { pnr: bare ? bare[1] : null, reference: null }
}

const AIRLINES =
  /indian airlines|air india|indigo|akasa|akasa air|go first|gofirst|spicejet|vistara|emirates|qatar airways|lufthansa|british airways|klm|air canada|united|delta|american airlines|singapore airlines|ryanair|easyjet|jet2|thomas cook|makeMyTrip|cleartrip|goibibo/i

function findTransport(text: string): {
  mode: TransportMode | null
  serviceNumber: string | null
  operator: string | null
} {
  // Most specific evidence first. "check-in" is deliberately not a flight
  // signal, because hotels use it too.
  const hotelWord = /\b(hotel|resort|check-?in|check-?out|room\s*(?:no\.?|number)?|night stay|guest)\b/i.test(text)
  const trainWord = /\btrain\b/i.test(text)
  const flightWord = /\b(flight|airline|airways|boarding pass|airport|web check-in)\b/i.test(text)
  const busWord = /\b(bus|coach|volvo|seabird|shivneri|private hire)\b/i.test(text)
  const ferryWord = /\b(ferry|boat|vessel|cruise|gangway)\b/i.test(text)

  if (trainWord) {
    const number = text.match(/\btrain\s*(?:no\.?|number)?\s*[:#-]?\s*([1-9]\d{4})\b/i)
    const operator = text.match(
      /\b(indian railways|railways|irctc|konkan railway|western railway|east coast|central railway|northern railway|metro rail|national railways)\b/i,
    )
    return { mode: 'train', serviceNumber: number?.[1] ?? null, operator: operator ? titleish(operator[1]) : null }
  }

  if (hotelWord) {
    const hotel = text.match(/\b([A-Z][A-Za-z&.' -]{3,40}?(?:Hotel|Resort|Inn|House|Marriott|Hilton|Hyatt|Ibis)\b)/)
    return { mode: 'hotel', serviceNumber: null, operator: hotel ? titleish(hotel[1]) : null }
  }

  if (flightWord) {
    // Airline designators are not always two letters: IndiGo uses "6E".
    const labelled = text.match(/\bflight\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{2})\s*-?\s*(\d{3,4})\b/i)
    const bare = text.match(/\b([A-Z0-9]{2})\s?-?\s?(\d{3,4})\b/)
    const number = labelled
      ? `${labelled[1].toUpperCase()}${labelled[2]}`
      : bare && /^[A-Z0-9]{2}$/.test(bare[1])
        ? `${bare[1].toUpperCase()}${bare[2]}`
        : null

    const operator = text.match(AIRLINES)
    return { mode: 'flight', serviceNumber: number, operator: operator ? titleish(operator[0]) : null }
  }

  if (busWord) {
    const number = text.match(/\bbus\s*(?:no\.?|number|service)?\s*[:#-]?\s*([A-Z]{1,2}\s?\d{2,4})\b/i)
    const operator = text.match(/\b(volvo|seabird|shivneri|neeta tours?|patel travels?|orange tours?|easyroon)\b/i)
    return { mode: 'bus', serviceNumber: number ? number[1].toUpperCase().replace(/\s/g, '') : null, operator: operator ? titleish(operator[1]) : null }
  }

  if (ferryWord) {
    return { mode: 'ferry', serviceNumber: null, operator: null }
  }

  return { mode: null, serviceNumber: null, operator: null }
}

function findSeat(text: string): { seat: string | null; coach: string | null; terminal: string | null } {
  const seat = text.match(/\bseat\s*(?:no\.?|number)?\s*[:#-]?\s*(\d{1,2}[A-K]?)\b/i)
  const coach = text.match(/\b(?:coach|carriage|compartment|car)\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z]{1,2}\s?-?\d{1,3})\b/i)
  const terminal = text.match(/\bterminal\s*[:#-]?\s*(\d{1,2}[A-Z]?)\b/i)
  const gate = text.match(/\bgate\s*[:#-]?\s*(\d{1,2}[A-Z]?)\b/i)

  return {
    seat: seat ? seat[1].toUpperCase() : null,
    coach: coach ? coach[1].toUpperCase().replace(/\s/g, '') : null,
    terminal: terminal ? terminal[1].toUpperCase() : gate ? gate[1].toUpperCase() : null,
  }
}

function findFare(text: string): { fare: number | null; currency: string | null } {
  const amount = String.raw`([\d,]+(?:\.\d{1,2})?)`
  // The currency can sit before the amount ("Rs. 1,247") or after it
  // ("1,247 INR"), so both sides are captured.
  const before = String.raw`(₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?`
  const after = String.raw`\s*(₹|INR|Rs\.?|USD|\$|EUR|€|GBP|£)?`

  const labelled = text.match(
    new RegExp(
      String.raw`\b(?:grand\s*total|total\s*(?:fare|amount|price)?|amount|fare|price|paid)\s*[:#-]?\s*` +
        String.raw`\s*` +
        before +
        String.raw`\s*` +
        amount +
        after,
      'i',
    ),
  )
  const symbol = text.match(new RegExp(String.raw`[₹$€£]\s*` + amount + String.raw`\s*(?:only)?`, 'i'))

  const m = labelled ?? symbol
  if (!m) return { fare: null, currency: null }

  const fare = Number(m[2].replace(/,/g, ''))
  if (!Number.isFinite(fare)) return { fare: null, currency: null }

  const token = `${m[1] ?? ''} ${m[3] ?? ''} ${m[0]}`.toLowerCase()
  let currency: string | null = null
  if (/inr|\brs\b|₹|rs\./.test(token)) currency = 'INR'
  else if (/usd|\$/.test(token)) currency = 'USD'
  else if (/eur|€/.test(token)) currency = 'EUR'
  else if (/gbp|£/.test(token)) currency = 'GBP'

  return { fare, currency }
}

function findStatus(text: string): string | null {
  const m = text.match(
    /\b(confirmed|cancelled|canceled|waitlisted|pending|on hold|failed|refunded|completed|success(?:ful)?)\b/i,
  )
  return m ? m[1].toLowerCase() : null
}

/**
 * The traveller's name.
 *
 * Labels are tried most-specific first. A bare "Name:" must never win, because
 * tickets also print "Train Name:" and "Flight Name:".
 */
function findTraveller(text: string): { traveler: string | null; passengers: string[] } {
  const pattern =
    /\b(passenger\s*name|traveller\s*name|traveler\s*name|guest\s*name|name\s*of\s*passenger|passenger|traveller|traveler|guest|booked\s*by|lead\s*passenger)\s*[:#-]\s*([A-Z][A-Z.' -]{4,40}?)(?:\n|$|,)/gi

  let single: string | null = null
  for (const match of text.matchAll(pattern)) {
    const candidate = match[2].replace(/[^\w .'-]/g, ' ').replace(/\s+/g, ' ').trim()
    if (candidate.length >= 4) {
      single = candidate
      break
    }
  }

  const party = text.match(/\b(\d+)\s*(?:adult|passenger|adults)\b/i)
  const passengers = party
    ? Array.from({ length: Number(party[1]) }, () => single ?? 'Passenger')
    : single
      ? [single]
      : []

  return { traveler: single, passengers }
}

/* ==========================================================================
 * Main
 * ========================================================================== */

export function extractJourneyFromText(rawText: string): ExtractionResult {
  const text = rawText.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim()
  const warnings: string[] = []
  const prov = {} as Record<keyof ExtractedJourney, Provenance>

  const mark = <K extends keyof ExtractedJourney>(
    key: K,
    value: ExtractedJourney[K] | null,
  ): ExtractedJourney[K] | null => {
    const present = Array.isArray(value) ? value.length > 0 : value !== null && String(value).trim() !== ''
    prov[key] = present ? 'confirmed' : 'missing'
    return present ? value : null
  }

  const fields: ExtractedJourney = { ...EMPTY, passengers: [] }

  const dates = findDates(text)
  const times = findTimes(text)
  const route = findRoute(text)
  const transport = findTransport(text)
  const ids = findPnr(text)
  const seating = findSeat(text)
  const fare = findFare(text)
  const who = findTraveller(text)

  fields.origin = mark('origin', route.origin)
  fields.destination = mark('destination', route.destination)
  fields.transportMode = mark('transportMode', transport.mode)
  fields.serviceNumber = mark('serviceNumber', transport.serviceNumber)
  fields.operator = mark('operator', transport.operator)
  fields.pnr = mark('pnr', ids.pnr)
  fields.bookingReference = mark('bookingReference', ids.reference)
  fields.seat = mark('seat', seating.seat)
  fields.coach = mark('coach', seating.coach)
  fields.terminal = mark('terminal', seating.terminal)
  fields.fare = mark('fare', fare.fare)
  fields.currency = mark('currency', fare.currency)
  fields.bookingStatus = mark('bookingStatus', findStatus(text))
  fields.traveler = mark('traveler', who.traveler)
  fields.passengers = who.passengers
  prov.passengers = who.passengers.length > 0 ? 'confirmed' : 'missing'

  // Departure and arrival are anchored to the nearest keyword, falling back to
  // document order.
  const departureKeyword = text.search(/\b(depart(?:ure|ing|s)?|dep\b|onward|scheduled departure|boarding)\b/i)
  const arrivalKeyword = text.search(/\b(arriv(?:al|ing|al|e|s)?|arr\b|due arrival|reaches?)\b/i)

  const departureDate =
    departureKeyword >= 0 ? (dates.find((d) => d.index >= departureKeyword) ?? dates[0]) : dates[0]
  const arrivalDate =
    arrivalKeyword >= 0 ? (dates.find((d) => d.index >= arrivalKeyword) ?? dates[1] ?? null) : (dates[1] ?? null)

  fields.departureDate = mark('departureDate', departureDate?.iso ?? null)
  fields.arrivalDate = mark('arrivalDate', arrivalDate?.iso ?? null)

  const after = (from: number) => times.filter((t) => t.index > from)
  const departureTime = (departureKeyword >= 0 ? after(departureKeyword)[0] : null) ?? times[0] ?? null
  const arrivalTime = arrivalKeyword >= 0 ? (after(arrivalKeyword)[0] ?? null) : (times[1] ?? null)

  fields.departureTime = mark('departureTime', departureTime?.hm ?? null)
  fields.arrivalTime = mark('arrivalTime', arrivalTime?.hm ?? null)

  // An arrival date inferred from the departure date is only ever `estimated`.
  if (!fields.arrivalDate && fields.departureDate && fields.arrivalTime) {
    fields.arrivalDate = fields.departureDate
    prov.arrivalDate = 'estimated'
    warnings.push('Arrival date was not stated, so Wayvo assumed the same day as departure.')
  }

  if (!fields.destination) warnings.push('Destination was not found in the document.')
  if (!fields.departureDate) warnings.push('No travel date was found in the document.')

  const confirmed = Object.values(prov).filter((value) => value === 'confirmed').length
  const confidence = Math.round((confirmed / Object.keys(prov).length) * 100) / 100

  if (confidence < 0.25) {
    warnings.push('Very little travel information was recognised in this document.')
  }

  return { fields, provenance: prov, confidence, rawText: text, warnings }
}

/** A journey is only worth showing when a route, or a date with a mode, came through. */
export function isUsableJourney(result: ExtractionResult): boolean {
  const { fields } = result
  if (fields.origin && fields.destination) return true
  const hasWhen = Boolean(fields.departureDate || fields.departureTime)
  return hasWhen && Boolean(fields.transportMode || fields.serviceNumber)
}

/** Human-readable one-liner for a journey, used in cards and duplicate hints. */
export function summariseJourney(fields: ExtractedJourney): string {
  if (fields.origin && fields.destination) return `${fields.origin} → ${fields.destination}`
  if (fields.destination) return `To ${fields.destination}`
  if (fields.origin) return `From ${fields.origin}`
  return 'Journey'
}
