import { Link } from 'react-router-dom'
import { ChevronRight, Mail, PencilLine, Upload } from 'lucide-react'
import type { Trip } from '../../types/database'
import { Pill } from '../app/Primitives'
import { TransportGlyph, TRANSPORT_LABEL } from './transport'
import { formatFare, formatWhen } from './JourneyReview'

const STATUS_TONE = {
  planning: 'neutral',
  booked: 'success',
  active: 'info',
  completed: 'neutral',
  cancelled: 'danger',
} as const

const STATUS_LABEL = {
  planning: 'Planning',
  booked: 'Confirmed',
  active: 'Travelling',
  completed: 'Completed',
  cancelled: 'Cancelled',
} as const

const SOURCE_META = {
  upload: { text: 'Imported from uploaded ticket', icon: Upload },
  gmail: { text: 'Imported from Gmail', icon: Mail },
} as const

/**
 * A single journey.
 *
 * Shows what the traveller needs to recognise and act on it. Import provenance
 * is surfaced so it is clear the details came from a real booking rather than
 * being typed by hand.
 */
export function JourneyCard({ trip }: { trip: Trip }) {
  const route =
    trip.origin && trip.destination
      ? `${trip.origin} → ${trip.destination}`
      : (trip.destination ?? trip.origin ?? trip.title)

  const when = trip.departure_at ?? trip.starts_on
  const source = trip.source !== 'manual' ? SOURCE_META[trip.source] : null

  const details = [
    trip.transport_mode ? `${TRANSPORT_LABEL[trip.transport_mode]}${trip.service_number ? ` ${trip.service_number}` : ''}` : null,
    trip.operator_name,
    trip.pnr ? `PNR ${trip.pnr}` : trip.booking_reference ? `Ref ${trip.booking_reference}` : null,
    trip.seat ? `Seat ${trip.seat}` : null,
    trip.fare_amount !== null ? formatFare(trip.fare_amount, trip.fare_currency) : null,
  ].filter(Boolean) as string[]

  return (
    <article className="wva-card wva-card--interactive px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight text-app-text">
            <TransportGlyph mode={trip.transport_mode} />
            <span className="truncate">{route}</span>
          </p>

          {when && (
            <p className="mt-1 text-[13px] text-app-text-muted">
              {trip.departure_at ? formatWhen(when) : formatDay(when)}
            </p>
          )}

          {details.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-app-text-subtle">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </p>
          )}
        </div>

        <Pill tone={STATUS_TONE[trip.status]}>{STATUS_LABEL[trip.status]}</Pill>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
        {source ? (
          <p className="flex items-center gap-1.5 text-[12px] text-app-text-subtle">
            <source.icon size={13} strokeWidth={2} aria-hidden="true" />
            {source.text}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[12px] text-app-text-subtle">
            <PencilLine size={13} strokeWidth={2} aria-hidden="true" />
            Added manually
          </p>
        )}

        <Link to={`/journeys?open=${trip.id}`} className="wva-btn wva-btn--ghost wva-btn--sm">
          View journey
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
