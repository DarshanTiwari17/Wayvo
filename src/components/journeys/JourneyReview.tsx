import { useState } from 'react'
import { AlertTriangle, Check, CircleHelp, Pencil } from 'lucide-react'
import type { ExtractedJourney, Provenance, TransportMode } from '../../lib/bookingParser'
import { summariseJourney } from '../../lib/bookingParser'
import type { JourneyDraft } from '../../services/importService'
import { Banner, Button, Field, Pill } from '../app/Primitives'
import { TRANSPORT_ICON, TRANSPORT_LABEL } from './transport'

/**
 * The review screen shown after extraction.
 *
 * Extraction is pattern matching, so it is never trusted. Every field is
 * editable, every field says where it came from, and nothing is written to
 * Supabase until the traveller presses Confirm.
 */

export type ReviewMode = 'review' | 'edit'

type Props = {
  draft: JourneyDraft
  warnings: string[]
  confidence: number
  sourceLabel: string
  documentName?: string | null
  onConfirm: () => void
  onCancel: () => void
  onEdit: (draft: JourneyDraft) => void
  onChange: (draft: JourneyDraft) => void
  saving: boolean
  saveError: string | null
}

export function JourneyReview({
  draft,
  warnings,
  confidence,
  sourceLabel,
  documentName,
  onConfirm,
  onCancel,
  onEdit,
  onChange,
  saving,
  saveError,
}: Props) {
  const [mode, setMode] = useState<ReviewMode>('review')

  function toggle() {
    if (mode === 'review') {
      onEdit(draft)
      setMode('edit')
    } else {
      onEdit(draft)
      setMode('review')
    }
  }

  const prov = (key: string): Provenance => (draft.provenance as Record<string, Provenance>)[key] ?? 'missing'

  return (
    <section className="wva-card wva-card--pad">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={confidence >= 0.6 ? 'success' : confidence >= 0.3 ? 'warn' : 'danger'}>
            {Math.round(confidence * 100)}% recognised
          </Pill>
          <Pill tone="neutral">{sourceLabel}</Pill>
        </div>

        <h2 className="wva-h1 mt-3">We found your journey</h2>
        <p className="wva-body mt-2">
          {mode === 'review'
            ? 'Check the details below. Nothing is saved until you confirm.'
            : 'Correct anything that looks wrong, then switch back to review.'}
        </p>
        {documentName && <p className="wva-meta mt-1.5">From {documentName}</p>}
      </header>

      {saveError && (
        <div className="mb-5">
          <Banner tone="danger">{saveError}</Banner>
        </div>
      )}

      {warnings.length > 0 && mode === 'review' && (
        <div className="mb-5 flex flex-col gap-2.5">
          {warnings.map((warning) => (
            <Banner key={warning} tone="warn">
              {warning}
            </Banner>
          ))}
        </div>
      )}

      {/* ---- summary ------------------------------------------------------ */}
      {mode === 'review' && (
        <div className="mb-5 rounded-lg border border-app-border bg-app-surface-alt px-4 py-4">
          <p className="font-display text-[20px] leading-tight font-semibold tracking-tight text-app-text">
            {summariseJourney(toExtracted(draft))}
          </p>

          <dl className="mt-3 flex flex-col gap-1.5">
            {draft.transportMode && (
              <Fact label="Transport" value={`${TRANSPORT_LABEL[draft.transportMode]}${draft.serviceNumber ? ` ${draft.serviceNumber}` : ''}`} provenance={prov('transportMode')} />
            )}
            {draft.departureAt && (
              <Fact label="Departs" value={formatWhen(draft.departureAt)} provenance={prov('departureDate')} />
            )}
            {draft.arrivalAt && (
              <Fact label="Arrives" value={formatWhen(draft.arrivalAt)} provenance={prov('arrivalDate')} />
            )}
            {(draft.pnr || draft.bookingReference) && (
              <Fact
                label={draft.pnr ? 'PNR' : 'Booking reference'}
                value={draft.pnr ?? draft.bookingReference ?? ''}
                provenance={prov(draft.pnr ? 'pnr' : 'bookingReference')}
              />
            )}
            {(draft.seat || draft.coach || draft.terminal) && (
              <Fact
                label="Seat"
                value={[draft.coach && `Coach ${draft.coach}`, draft.seat && `Seat ${draft.seat}`, draft.terminal && `Terminal ${draft.terminal}`]
                  .filter(Boolean)
                  .join(' · ')}
                provenance={prov('seat')}
              />
            )}
            {draft.operator && <Fact label="Operator" value={draft.operator} provenance={prov('operator')} />}
            {draft.passengerName && <Fact label="Traveller" value={draft.passengerName} provenance={prov('traveler')} />}
            {draft.fareAmount !== null && (
              <Fact
                label="Fare"
                value={formatFare(draft.fareAmount, draft.fareCurrency)}
                provenance={prov('fare')}
              />
            )}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-app-border pt-3">
            <Legend />
          </div>
        </div>
      )}

      {/* ---- editable form ------------------------------------------------ */}
      {mode === 'edit' && (
        <JourneyForm draft={draft} onChange={onChange} />
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={onConfirm} pending={saving} pendingLabel="Saving…">
          Confirm &amp; add journey
        </Button>
        <Button variant="secondary" onClick={toggle} disabled={saving}>
          <Pencil size={14} strokeWidth={2.2} aria-hidden="true" />
          {mode === 'review' ? 'Edit details' : 'Back to review'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function Fact({ label, value, provenance }: { label: string; value: string; provenance: Provenance }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <dt className="w-32 shrink-0 text-[12px] text-app-text-subtle">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[13px] text-app-text">
        {value}
        <ProvenanceMark value={provenance} />
      </dd>
    </div>
  )
}

function ProvenanceMark({ value }: { value: Provenance }) {
  if (value === 'confirmed') {
    return (
      <span title="Read directly from your document" className="inline-flex text-app-success">
        <Check size={13} strokeWidth={2.8} aria-label="Confirmed from document" />
      </span>
    )
  }
  if (value === 'estimated') {
    return (
      <span title="Assumed by Wayvo — please check" className="inline-flex text-app-warn">
        <AlertTriangle size={13} strokeWidth={2.4} aria-label="Estimated, please check" />
      </span>
    )
  }
  return (
    <span title="Not found in the document" className="inline-flex text-app-text-subtle">
      <CircleHelp size={13} strokeWidth={2.2} aria-label="Not found in document" />
    </span>
  )
}

function Legend() {
  return (
    <p className="wva-meta flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Check size={12} strokeWidth={2.8} className="text-app-success" aria-hidden="true" />
        Confirmed from document
      </span>
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle size={12} strokeWidth={2.4} className="text-app-warn" aria-hidden="true" />
        Estimated — check it
      </span>
    </p>
  )
}

export function JourneyForm({ draft, onChange }: { draft: JourneyDraft; onChange: (next: JourneyDraft) => void }) {
  const set = <K extends keyof JourneyDraft>(key: K, value: JourneyDraft[K]) => onChange({ ...draft, [key]: value })

  return (
    <div className="mb-5 flex flex-col gap-5">
      <Field id="title" label="Journey name">
        <input
          id="title"
          className="wva-input"
          value={draft.title}
          onChange={(event) => {
            set('title', event.target.value)
            // Keep the summary title in step while the traveller types.
            onChange({ ...draft, title: event.target.value })
          }}
          maxLength={120}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="origin" label="From">
          <input id="origin" className="wva-input" value={draft.origin ?? ''} onChange={(e) => set('origin', e.target.value || null)} />
        </Field>
        <Field id="destination" label="To">
          <input id="destination" className="wva-input" value={draft.destination ?? ''} onChange={(e) => set('destination', e.target.value || null)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="transportMode" label="Transport">
          <select
            id="transportMode"
            className="wva-select"
            value={draft.transportMode ?? ''}
            onChange={(e) => set('transportMode', (e.target.value || null) as TransportMode | null)}
          >
            <option value="">Not set</option>
            {Object.entries(TRANSPORT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="serviceNumber" label="Train / flight / bus number">
          <input id="serviceNumber" className="wva-input" value={draft.serviceNumber ?? ''} onChange={(e) => set('serviceNumber', e.target.value || null)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="departureAt" label="Departs">
          <input
            id="departureAt"
            type="datetime-local"
            className="wva-input"
            value={toLocalInput(draft.departureAt)}
            onChange={(e) => set('departureAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
          />
        </Field>
        <Field id="arrivalAt" label="Arrives">
          <input
            id="arrivalAt"
            type="datetime-local"
            className="wva-input"
            value={toLocalInput(draft.arrivalAt)}
            onChange={(e) => set('arrivalAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="pnr" label="PNR">
          <input id="pnr" className="wva-input" value={draft.pnr ?? ''} onChange={(e) => set('pnr', e.target.value || null)} />
        </Field>
        <Field id="bookingReference" label="Booking reference">
          <input
            id="bookingReference"
            className="wva-input"
            value={draft.bookingReference ?? ''}
            onChange={(e) => set('bookingReference', e.target.value || null)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="operator" label="Operator">
          <input id="operator" className="wva-input" value={draft.operator ?? ''} onChange={(e) => set('operator', e.target.value || null)} />
        </Field>
        <Field id="passengerName" label="Traveller">
          <input
            id="passengerName"
            className="wva-input"
            value={draft.passengerName ?? ''}
            onChange={(e) => set('passengerName', e.target.value || null)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Field id="seat" label="Seat">
          <input id="seat" className="wva-input" value={draft.seat ?? ''} onChange={(e) => set('seat', e.target.value || null)} />
        </Field>
        <Field id="coach" label="Coach">
          <input id="coach" className="wva-input" value={draft.coach ?? ''} onChange={(e) => set('coach', e.target.value || null)} />
        </Field>
        <Field id="terminal" label="Terminal">
          <input id="terminal" className="wva-input" value={draft.terminal ?? ''} onChange={(e) => set('terminal', e.target.value || null)} />
        </Field>
        <Field id="fareAmount" label="Fare">
          <input
            id="fareAmount"
            type="number"
            min="0"
            step="0.01"
            className="wva-input"
            value={draft.fareAmount ?? ''}
            onChange={(e) => set('fareAmount', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function toExtracted(draft: JourneyDraft): ExtractedJourney {
  return {
    traveler: draft.passengerName,
    bookingReference: draft.bookingReference,
    pnr: draft.pnr,
    ticketNumber: draft.ticketNumber,
    transportMode: draft.transportMode,
    operator: draft.operator,
    serviceNumber: draft.serviceNumber,
    origin: draft.origin,
    destination: draft.destination,
    departureDate: draft.startsOn,
    departureTime: draft.departureAt ? draft.departureAt.slice(11, 16) : null,
    arrivalDate: draft.endsOn,
    arrivalTime: draft.arrivalAt ? draft.arrivalAt.slice(11, 16) : null,
    seat: draft.seat,
    coach: draft.coach,
    terminal: draft.terminal,
    fare: draft.fareAmount,
    currency: draft.fareCurrency,
    bookingStatus: draft.bookingStatus,
    passengers: [],
  }
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatFare(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount} ${currency ?? ''}`.trim()
  }
}

export { TRANSPORT_ICON }
