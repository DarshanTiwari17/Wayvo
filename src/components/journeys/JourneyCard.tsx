import { Link } from 'react-router-dom'
import { ChevronRight, Layers } from 'lucide-react'
import type { Trip } from '../../types/database'
import { Pill } from '../app/Primitives'
import { formatDateRange, formatRoute } from '../../services/travelService'

const STATUS_TONE = {
  planning: 'neutral',
  booked: 'success',
  active: 'info',
  completed: 'neutral',
  cancelled: 'danger',
} as const

const STATUS_LABEL = {
  planning: 'Planning',
  booked: 'Booked',
  active: 'Travelling',
  completed: 'Completed',
  cancelled: 'Cancelled',
} as const

/**
 * One trip in the list.
 *
 * A trip is a container, so this shows what it spans and how many bookings it
 * holds rather than one journey's seat and fare. Opening it takes you to the
 * itinerary.
 */
export function JourneyCard({ trip }: { trip: Trip }) {
  // Prefer the derived summary; a trip created by hand has neither yet.
  const route = trip.origin || trip.destination ? formatRoute(trip) : null
  const count = trip.segment_count ?? 0

  return (
    <article className="wva-card wva-card--interactive px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight text-app-text">
            <Layers size={17} strokeWidth={2} className="shrink-0 text-app-text-subtle" aria-hidden="true" />
            <span className="truncate">{trip.title}</span>
          </p>

          <p className="mt-1 text-[13px] text-app-text-muted">{formatDateRange(trip.starts_on, trip.ends_on)}</p>

          {route && <p className="mt-0.5 text-[12px] text-app-text-subtle">{route}</p>}
        </div>

        <Pill tone={STATUS_TONE[trip.status]}>{STATUS_LABEL[trip.status]}</Pill>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
        <p className="text-[12px] text-app-text-subtle">
          {count === 0
            ? 'No bookings yet'
            : `${count} ${count === 1 ? 'booking' : 'bookings'} · ${
                count === 1 ? '1 journey' : `${count} journeys`
              }`}
        </p>

        <Link to={`/journeys/${trip.id}`} className="wva-btn wva-btn--ghost wva-btn--sm">
          Open trip
          <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
