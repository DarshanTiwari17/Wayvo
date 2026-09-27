/**
 * Runs the REAL extraction pipeline (readDocument → extractJourneyFromText) on
 * the fixture PDFs, to see exactly what is and isn't being read.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readDocument } from '../src/services/documentReader'
import { extractJourneyFromText, isUsableJourney, summariseJourney } from '../src/lib/bookingParser'

const FIXTURES = 'C:/Users/Lenovo/AppData/Local/Temp/opencode/shot/fixtures'

async function fileToText(name) {
  const file = new File([fs.readFileSync(path.join(FIXTURES, name))], name, { type: 'application/pdf' })
  return readDocument(file)
}

const names = ['Mumbai-Panvel-train.pdf', 'Panvel-Alibaug-bus.pdf', 'Alibaug-hotel.pdf', 'Alibaug-Mumbai-flight.pdf']

for (const name of names) {
  console.log('\n========================================')
  console.log(name)
  console.log('========================================')
  const outcome = await fileToText(name)
  if (!outcome.ok) {
    console.log('  READ FAILED:', outcome.reason)
    continue
  }
  console.log('  method:', outcome.method)
  console.log('  text (first 400 chars):')
  console.log('  ' + outcome.text.slice(0, 400).replace(/\n/g, '\n  '))

  const extraction = extractJourneyFromText(outcome.text)
  const f = extraction.fields
  console.log('\n  extracted:')
  console.log('   mode:', f.transportMode, '| operator:', f.operator, '| service:', f.serviceNumber)
  console.log('   origin:', f.origin, '| dest:', f.destination)
  console.log('   dep:', f.departureDate, f.departureTime, '| arr:', f.arrivalDate, f.arrivalTime)
  console.log('   pnr:', f.pnr, '| ref:', f.bookingReference, '| traveler:', f.traveler)
  console.log('   seat:', f.seat, '| coach:', f.coach, '| fare:', f.fare, f.currency)
  console.log('   status:', f.bookingStatus)
  console.log('  usable:', isUsableJourney(extraction), '| confidence:', extraction.confidence)
  console.log('  summary:', summariseJourney(f))
  if (extraction.warnings.length) console.log('  warnings:', extraction.warnings)
}
