/**
 * Imports several documents into one trip at once.
 *
 * This is the "Add Trip" path. Each file is read, extracted, stored and saved as
 * its own booking on the trip, and only then is the itinerary rebuilt once for
 * the whole set — so the order reflects every document together rather than the
 * order they happened to be selected in.
 *
 * One unreadable file does not abandon the rest. Each result is reported
 * individually, because a traveller who selected six tickets and got five
 * bookings plus one clear reason is better served than one who got an error.
 */
import { extractJourneyFromText, isUsableJourney, type ExtractionResult } from '../lib/bookingParser'
import { readDocument, releaseOcr } from './documentReader'
import { uploadTravelDocument } from './documentService'
import { draftFromExtraction, rebuildItinerary, saveSegment } from './importService'
import type { JourneyDraft } from './importService'

/** The phases the traveller is shown. Each is driven by real work below. */
export const BATCH_STEPS = [
  'Reading documents',
  'Extracting booking information',
  'Identifying locations',
  'Identifying dates and times',
  'Matching journey segments',
  'Ordering the itinerary',
  'Checking connections',
  'Building your itinerary',
] as const

export type FileOutcome =
  | { fileName: string; ok: true; draft: JourneyDraft; note: string }
  | { fileName: string; ok: false; reason: string }

export interface BatchResult {
  outcomes: FileOutcome[]
  saved: number
  failed: number
  /** With a readable origin and destination. */
  withLocations: number
  /** With at least one readable date. */
  withDates: number
  segmentCount: number
  /** True when the whole set was successfully ordered into an itinerary. */
  itineraryOrdered: boolean
  /** Bookings whose connection time could actually be worked out. */
  connectionsChecked: number
  /** Bookings whose position Wayvo is not certain about. */
  needsReview: number
}

export interface BatchProgress {
  /** Index of the file currently being worked on. */
  index: number
  total: number
  fileName: string
  phase: string
}

export type ProgressFn = (progress: BatchProgress) => void

/**
 * Runs the whole batch.
 *
 * `onSaved` is called after each successful save, so the caller can refresh the
 * itinerary view while the remaining files are still being read.
 */
export async function importBatch(
  profileId: string,
  tripId: string,
  files: File[],
  onSaved?: () => void | Promise<void>,
  onProgress?: ProgressFn,
): Promise<BatchResult> {
  const outcomes: FileOutcome[] = []
  let withLocations = 0
  let withDates = 0
  let saved = 0

  try {
    for (const [index, file] of files.entries()) {
      onProgress?.({ index, total: files.length, fileName: file.name, phase: BATCH_STEPS[0] })

      // --- read -----------------------------------------------------------
      const read = await readDocument(file, (fraction) => {
        onProgress?.({
          index,
          total: files.length,
          fileName: file.name,
          phase: fraction === null ? BATCH_STEPS[0] : `${BATCH_STEPS[0]} — ${Math.round(fraction * 100)}%`,
        })
      })

      if (!read.ok) {
        outcomes.push({ fileName: file.name, ok: false, reason: read.reason })
        continue
      }

      // --- extract --------------------------------------------------------
      onProgress?.({ index, total: files.length, fileName: file.name, phase: BATCH_STEPS[1] })
      const extraction = extractJourneyFromText(read.text)

      if (!isUsableJourney(extraction)) {
        outcomes.push({
          fileName: file.name,
          ok: false,
          reason: "We couldn't find enough travel information in this document.",
        })
        continue
      }

      // Counted here, because these are read out of the extraction, not assumed.
      if (extraction.fields.origin && extraction.fields.destination) withLocations += 1
      if (extraction.fields.departureDate || extraction.fields.arrivalDate) withDates += 1

      // --- store the document, then the booking --------------------------
      onProgress?.({ index, total: files.length, fileName: file.name, phase: BATCH_STEPS[4] })

      let documentId: string | null = null
      try {
        const stored = await uploadTravelDocument(
          profileId,
          file,
          extraction as ExtractionResult,
          { status: 'processed' },
          'upload',
        )
        documentId = stored.id
      } catch (cause) {
        // The booking still matters more than the file copy.
        console.warn('Document storage failed for', file.name, cause)
      }

      const draft = draftFromExtraction(extraction.fields, extraction.provenance, 'upload', extraction.confidence)

      try {
        await saveSegment(tripId, draft, documentId)
        saved += 1
        outcomes.push({
          fileName: file.name,
          ok: true,
          draft,
          note: describeExtraction(extraction, draft),
        })
        await onSaved?.()
      } catch (cause) {
        outcomes.push({
          fileName: file.name,
          ok: false,
          reason: cause instanceof Error ? cause.message : 'That booking could not be saved.',
        })
      }
    }
  } finally {
    // Tesseract keeps a worker and a language model alive; release it whether
    // the batch finished or threw.
    await releaseOcr()
  }

  // Order the whole set together, now that every document has been read. This
  // is the step that turns several bookings into one itinerary, so it is done
  // here rather than left for the caller to remember.
  let itineraryOrdered = false
  let connectionsChecked = 0
  let needsReview = 0

  if (saved > 0) {
    onProgress?.({
      index: files.length,
      total: files.length,
      fileName: '',
      phase: BATCH_STEPS[5],
    })

    try {
      const itinerary = await rebuildItinerary(tripId)
      itineraryOrdered = true
      connectionsChecked = itinerary.segments.filter((s) => s.connectionMinutes !== null).length
      needsReview = itinerary.segments.filter((s) => s.needsReview).length
      onProgress?.({
        index: files.length,
        total: files.length,
        fileName: '',
        phase: BATCH_STEPS[7],
      })
    } catch (cause) {
      // The bookings are saved; only the ordering failed, and the caller will
      // rebuild again when the trip is opened.
      console.warn('Itinerary could not be built after the batch:', cause)
    }
  }

  return {
    outcomes,
    saved,
    failed: outcomes.length - saved,
    withLocations,
    withDates,
    segmentCount: saved,
    itineraryOrdered,
    connectionsChecked,
    needsReview,
  }
}

/** A one-line, honest summary of what was read out of one document. */
function describeExtraction(extraction: ExtractionResult, draft: JourneyDraft): string {
  const parts: string[] = []

  if (draft.origin && draft.destination) parts.push(`${draft.origin} → ${draft.destination}`)
  else if (draft.origin) parts.push(`From ${draft.origin}`)
  else if (draft.operator) parts.push(draft.operator)
  else parts.push('Booking')

  const when = draft.departureAt ?? draft.startsOn
  if (when) parts.push(new Date(when).toLocaleDateString())

  // Anything inferred is called out rather than presented as read.
  const guessed = Object.entries(extraction.provenance).filter(([, how]) => how === 'estimated')
  if (guessed.length > 0) parts.push(`${guessed.length} detail(s) inferred`)

  return parts.join(' · ')
}
