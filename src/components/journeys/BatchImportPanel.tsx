import { useState } from 'react'
import { Check, CircleDashed, TriangleAlert, Upload } from 'lucide-react'
import { Banner, Button, Pill } from '../app/Primitives'
import { BATCH_STEPS, importBatch, type BatchProgress, type BatchResult } from '../../services/batchImport'
import { useAuth } from '../../hooks/useAuth'

/**
 * "Upload tickets and bookings" — the multi-file half of "+ Add Trip".
 *
 * Accepts any number of PDFs and images. Each one becomes a booking on the
 * current trip, and the itinerary is rebuilt once for the whole set.
 *
 * Every step shown corresponds to work that actually ran. Nothing here
 * fabricates a result: if a file could not be read, it says so by name.
 */

type Props = {
  tripId: string
  tripName: string
  onClose: () => void
  /** Fired after each booking is saved, and once at the end. */
  onChanged: () => void | Promise<void>
}

export function BatchImportPanel({ tripId, tripName, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function handleFiles(files: File[]) {
    if (!user || files.length === 0 || busy) return

    setError(null)
    setResult(null)
    setBusy(true)

    try {
      const outcome = await importBatch(user.id, tripId, files, async () => {
        // Refresh as each booking lands, so the trip list is never stale.
        await onChanged()
      }, setProgress)

      await onChanged()
      setResult(outcome)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those documents could not be read. Please try again.')
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  /* ------------------------------------------------------------------ */

  if (busy || progress) {
    return (
      <section className="wva-card wva-card--pad mb-6" aria-busy="true">
        <h2 className="wva-h2 mb-1">Reading your bookings</h2>
        <p className="wva-meta mb-5">
          {progress
            ? `${progress.fileName} — file ${progress.index + 1} of ${progress.total}`
            : 'Working out what is on each document…'}
        </p>

        <ol className="flex flex-col gap-2.5">
          {BATCH_STEPS.map((step, index) => {
            const current = progress ? indexOfPhase(progress.phase) : -1
            const done = current > index
            const active = current === index
            return (
              <li key={step} className="flex items-center gap-2.5 text-[13px]">
                {done ? (
                  <Check size={15} strokeWidth={2.8} className="shrink-0 text-app-success" aria-hidden="true" />
                ) : active ? (
                  <CircleDashed size={15} strokeWidth={2.2} className="shrink-0 text-app-accent" aria-hidden="true" />
                ) : (
                  <CircleDashed size={15} strokeWidth={1.8} className="shrink-0 text-app-text-subtle" aria-hidden="true" />
                )}
                <span className={done || active ? 'text-app-text' : 'text-app-text-subtle'}>{step}</span>
                {done && <span className="sr-only">done</span>}
              </li>
            )
          })}
        </ol>
      </section>
    )
  }

  if (result) {
    return (
      <section className="wva-card wva-card--pad mb-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="wva-h2">
              {result.saved === 0
                ? 'No bookings could be read'
                : `${result.saved} ${result.saved === 1 ? 'booking' : 'bookings'} added`}
            </h2>
            {result.saved > 0 && (
              <p className="wva-meta mt-1">
                Wayvo has ordered them into {tripName}. Check the itinerary below.
              </p>
            )}
          </div>
        </header>

        {/* Real counts, straight from the extraction. */}
        {result.saved > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill tone="neutral">
              {result.withLocations} of {result.saved} with a full route
            </Pill>
            <Pill tone={result.withDates === result.saved ? 'success' : 'warn'}>
              {result.withDates} of {result.saved} with dates
            </Pill>
            {result.itineraryOrdered && (
              <Pill tone="success">
                <Check size={12} strokeWidth={3} aria-hidden="true" />
                Ordered into your itinerary
              </Pill>
            )}
            {result.needsReview > 0 && (
              <Pill tone="warn">
                {result.needsReview} to confirm
              </Pill>
            )}
          </div>
        )}

        {result.failed > 0 && (
          <div className="mb-4">
            <Banner tone="warn">
              <p className="font-semibold">
                {result.failed} {result.failed === 1 ? 'file was' : 'files were'} not added.
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {result.outcomes
                  .filter((o): o is Extract<typeof o, { ok: false }> => !o.ok)
                  .map((o) => (
                    <li key={o.fileName} className="text-[12px]">
                      <span className="font-medium">{o.fileName}</span> — {o.reason}
                    </li>
                  ))}
              </ul>
            </Banner>
          </div>
        )}

        <ul className="mb-5 flex flex-col gap-2">
          {result.outcomes.map((outcome) => (
            <li
              key={outcome.fileName}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-app-border pb-2 last:border-0"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                {outcome.ok ? (
                  <Check size={14} strokeWidth={2.6} className="shrink-0 text-app-success" aria-hidden="true" />
                ) : (
                  <TriangleAlert size={14} strokeWidth={2.2} className="shrink-0 text-app-warn" aria-hidden="true" />
                )}
                <span className="truncate font-medium text-app-text">{outcome.fileName}</span>
              </span>
              <span className="text-[12px] text-app-text-subtle">{outcome.ok ? outcome.note : outcome.reason}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onClose}>View itinerary</Button>
          <Button variant="secondary" onClick={() => setResult(null)}>
            Add more documents
          </Button>
        </div>
      </section>
    )
  }

  /* ------------------------------------------------------------------ */

  return (
    <section className="wva-card wva-card--pad mb-6">
      <header className="mb-4">
        <h2 className="wva-h2">Add bookings to your trip</h2>
        <p className="wva-body mt-1.5">
          Upload all the tickets and bookings for {tripName} at once — PDFs, photos, or a mix. Wayvo reads each one,
          then works out the order for you.
        </p>
      </header>

      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFiles(Array.from(event.dataTransfer.files))
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-app-accent bg-app-accent-soft' : 'border-app-border-strong bg-app-surface-alt'
        }`}
      >
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-app-accent-soft text-app-accent">
          <Upload size={19} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="wva-h3">Upload Tickets / Bookings</span>
        <span className="max-w-sm text-[13px] leading-relaxed text-app-text-muted">
          Choose as many as your trip needs. Train, bus and flight tickets, hotel confirmations — PDF or image.
        </span>
        <input
          type="file"
          className="sr-only"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void handleFiles(files)
          }}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-app-text-subtle">
          Every booking you add is checked against the ones already in this trip, so nothing is imported twice.
        </p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Where the current work sits in the step list.
 *
 * `readDocument` reports a percentage while it works, so the phase is matched on
 * a prefix. Anything unrecognised falls back to the first step rather than
 * jumping ahead and marking work as done that has not happened.
 */
function indexOfPhase(phase: string): number {
  const exact = BATCH_STEPS.indexOf(phase as (typeof BATCH_STEPS)[number])
  if (exact >= 0) return exact
  const prefix = BATCH_STEPS.findIndex((candidate) => phase.startsWith(candidate))
  return prefix >= 0 ? prefix : 0
}
