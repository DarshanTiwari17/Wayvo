import { AlertTriangle, ArrowDown, Check, Clock, MapPin } from 'lucide-react'
import type { JourneySegment } from '../../types/database'
import { Button, Pill } from '../app/Primitives'
import { TransportGlyph, TRANSPORT_LABEL } from './transport'
import type { Itinerary } from '../../lib/itineraryBuilder'
import { formatFare } from './JourneyReview'

/**
 * The rebuilt itinerary for one trip.
 *
 * Renders the order Wayvo worked out, the wait between each booking, and — where
 * the order was a guess — what the traveller needs to check. Nothing here
 * invents a value: an unknown time is shown as unknown.
 */

type Props = {
  tripId: string
  rows: JourneySegment[]
  itinerary: Itinerary
  onConfirmOrder: () => void
  onMove: (segmentId: string, direction: -1 | 1) => void
  confirming: boolean
  onRemove?: (segment: JourneySegment) => void
}

export function ItineraryView({ tripId, rows, itinerary, onConfirmOrder, onMove, confirming, onRemove }: Props) {
  const { segments, notes, confident } = itinerary
  const byId = new Map(rows.map((row) => [row.id, row]))
  const flagged = segments.filter((segment) => segment.needsReview)

  if (segments.length === 0) return null

  return (
    <section aria-labelledby={`itinerary-${tripId}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`itinerary-${tripId}`} className="wva-h2">
          Your itinerary
        </h2>
        {flagged.length > 0 ? (
          <Pill tone="warn">
            <AlertTriangle size={12} strokeWidth={2.4} aria-hidden="true" />
            {flagged.length === 1 ? '1 booking to check' : `${flagged.length} bookings to check`}
          </Pill>
        ) : (
          <Pill tone="success">
            <Check size={12} strokeWidth={3} aria-hidden="true" />
            Order confirmed
          </Pill>
        )}
      </div>

      {notes.length > 0 && (
        <div className="mb-4">
          {notes.map((note) => (
            <p key={note} className="wva-meta">
              {note}
            </p>
          ))}
        </div>
      )}

      <ol className="flex flex-col">
        {segments.map((segment, index) => {
          const row = byId.get(segment.id)
          if (!row) return null

          const isLast = index === segments.length - 1
          const connection = segment.connectionMinutes

          return (
            <li key={segment.id} className="flex flex-col">
              <article
                className={`wva-card px-4 py-4 sm:px-5 ${segment.needsReview ? 'border-l-2 border-l-app-warn' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight text-app-text">
                      <TransportGlyph mode={segment.transportMode} />
                      <span className="truncate">
                        {segment.origin ?? 'Origin not read'}
                        {segment.destination ? ` → ${segment.destination}` : ''}
                      </span>
                    </p>

                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-app-text-muted">
                      {segment.transportMode && <span>{TRANSPORT_LABEL[segment.transportMode]}</span>}
                      {segment.operator && <span>· {segment.operator}</span>}
                      {segment.serviceNumber && <span>· {segment.serviceNumber}</span>}
                    </p>

                    <TimingRow segment={segment} />
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {row.booking_status && (
                      <Pill tone={row.booking_status === 'cancelled' ? 'danger' : 'neutral'}>{row.booking_status}</Pill>
                    )}
                    {segment.source !== 'manual' && (
                      <span className="text-[11px] text-app-text-subtle">
                        {segment.source === 'gmail' ? 'From Gmail' : 'From ticket'}
                      </span>
                    )}
                  </div>
                </div>

                {segment.needsReview && segment.reviewNote && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-app-warn-soft px-3 py-2 text-[12px] leading-relaxed text-app-warn">
                    <AlertTriangle size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{segment.reviewNote}</span>
                  </p>
                )}

                <BookingDetails segment={segment} />

                {/* A deliberate order is the traveller's, so let them change it. */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
                  <span className="text-[11px] text-app-text-subtle">Move</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onMove(segment.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${segment.origin ?? 'booking'} earlier`}
                  >
                    Up
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onMove(segment.id, 1)}
                    disabled={isLast}
                    aria-label={`Move ${segment.destination ?? 'booking'} later`}
                  >
                    Down
                  </Button>
                  {onRemove && (
                    <Button variant="ghost" size="sm" onClick={() => onRemove(row)}>
                      Remove
                    </Button>
                  )}
                </div>
              </article>

              {!isLast && <ConnectionMark minutes={connection} />}
            </li>
          )
        })}
      </ol>

      {flagged.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onConfirmOrder} pending={confirming} pendingLabel="Saving…">
            <Check size={14} strokeWidth={2.6} aria-hidden="true" />
            Confirm this order
          </Button>
          <p className="wva-meta max-w-md">
            {confident
              ? 'Confirming tells Wayvo the order is right so a later booking will not rearrange it.'
              : 'Check the flagged bookings above, then confirm. You can still change the order afterwards.'}
          </p>
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function TimingRow({ segment }: { segment: Itinerary['segments'][number] }) {
  if (!segment.departureAt && !segment.arrivalAt) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-app-text-subtle">
        <Clock size={13} strokeWidth={2} aria-hidden="true" />
        No times were found on this booking
      </p>
    )
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-app-text-muted">
      <Clock size={13} strokeWidth={2} aria-hidden="true" />
      {segment.departureAt && <span>Departs {formatWhen(segment.departureAt)}</span>}
      {segment.departureAt && segment.arrivalAt && <span aria-hidden="true">·</span>}
      {segment.arrivalAt && <span>Arrives {formatWhen(segment.arrivalAt)}</span>}
    </p>
  )
}

function ConnectionMark({ minutes }: { minutes: number | null }) {
  const tight = minutes !== null && minutes < 30
  const impossible = minutes !== null && minutes < 0

  const label =
    minutes === null
      ? 'Connection time unknown'
      : impossible
        ? 'Overlaps the previous booking'
        : minutes === 0
          ? 'No changeover time'
          : `${formatDuration(minutes)} connection`

  return (
    <div className="flex items-center gap-2 py-1.5 pl-6">
      <ArrowDown size={13} strokeWidth={2.2} className="shrink-0 text-app-text-subtle" aria-hidden="true" />
      <span className={`text-[12px] ${impossible || tight ? 'text-app-warn' : 'text-app-text-subtle'}`}>
        {label}
      </span>
    </div>
  )
}

function BookingDetails({ segment }: { segment: Itinerary['segments'][number] }) {
  const details = [
    segment.pnr ? `PNR ${segment.pnr}` : segment.bookingReference ? `Ref ${segment.bookingReference}` : null,
    segment.passengerName,
    segment.coach ? `Coach ${segment.coach}` : null,
    segment.seat ? `Seat ${segment.seat}` : null,
    segment.terminal ? `Terminal ${segment.terminal}` : null,
    segment.fareAmount !== null ? formatFare(segment.fareAmount, segment.fareCurrency) : null,
  ].filter(Boolean) as string[]

  if (details.length === 0) return null

  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-app-text-subtle">
      {details.map((detail) => (
        <span key={detail}>{detail}</span>
      ))}
    </p>
  )
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDuration(minutes: number): string {
  const abs = Math.abs(minutes)
  if (abs < 60) return `${abs} min`
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function ItineraryRouteSummary({ itinerary }: { itinerary: Itinerary }) {
  const { segments } = itinerary
  if (segments.length === 0) return null

  // Walk the chain of stops, collapsing a repeated stop so two bookings that
  // share a junction do not render as "Pune -> Pune".
  const stops: string[] = []
  const push = (stop: string | null | undefined) => {
    if (!stop) return
    const previous = stops[stops.length - 1]
    if (previous && previous.toLowerCase() === stop.toLowerCase()) return
    stops.push(stop)
  }
  for (const segment of segments) {
    if (stops.length === 0) push(segment.origin)
    push(segment.destination)
  }
  if (stops.length === 0) return null

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-app-text-muted">
      <MapPin size={13} strokeWidth={2} aria-hidden="true" />
      {stops.map((stop, index) => (
        <span key={`${stop}-${index}`} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true" className="text-app-text-subtle">→</span>}
          <span>{stop}</span>
        </span>
      ))}
    </p>
  )
}
