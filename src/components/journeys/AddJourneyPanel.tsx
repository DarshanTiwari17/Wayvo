import { useEffect, useRef, useState } from 'react'
import { Check, Mail, Paperclip, RefreshCw, ScanText, Upload } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { extractJourneyFromText, isUsableJourney } from '../../lib/bookingParser'
import { readDocument, releaseOcr, describeAccepted, validateFile } from '../../services/documentReader'
import { attachDocumentToTrip, uploadTravelDocument, type UploadedDocument } from '../../services/documentService'
import { draftFromExtraction, findPotentialDuplicates, saveJourney, type JourneyDraft, type PotentialDuplicate } from '../../services/importService'
import {
  attachmentToFile,
  beginGmailConnect,
  disconnectGmail,
  extractFromEmail,
  getGmailConnection,
  GmailError,
  searchGmail,
  type GmailCandidateKind,
  type GmailConnection,
  type GmailEmailSummary,
} from '../../services/gmailService'
import { Banner, Button, Pill } from '../app/Primitives'
import { JourneyReview } from './JourneyReview'

/**
 * The "Add a journey" panel.
 *
 * Two real paths into the same review screen:
 *   • Upload  → file picker → Supabase Storage → text extraction → review
 *   • Gmail   → Google consent → Gmail search → pick an email → review
 *
 * Gmail is a completely separate authorisation from Supabase's Google *login*.
 * A Wayvo account created with Google says nothing about Gmail access, so the
 * traveller is asked for `gmail.readonly` explicitly, on the server, and can
 * revoke it in their own Google account at any time.
 *
 * Nothing is written to `trips` until the traveller confirms.
 */

type Stage =
  | { kind: 'choose' }
  | { kind: 'reading'; fileName: string; progress: number | null }
  | { kind: 'gmail-connecting' }
  | { kind: 'gmail-list'; emails: GmailEmailSummary[]; loading: boolean; error: string | null }
  | { kind: 'gmail-reading'; subject: string }
  | {
      kind: 'review'
      draft: JourneyDraft
      warnings: string[]
      confidence: number
      sourceLabel: string
      documentName: string | null
      document: UploadedDocument | null
      duplicates: PotentialDuplicate[]
    }

type Props = { onClose: () => void; onSaved: () => void }

export function AddJourneyPanel({ onClose, onSaved }: Props) {
  const { user } = useAuth()
  const [stage, setStage] = useState<Stage>({ kind: 'choose' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [connection, setConnection] = useState<GmailConnection | null>(null)
  const [connectionChecked, setConnectionChecked] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => void releaseOcr(), [])

  useEffect(() => {
    void getGmailConnection()
      .then(setConnection)
      .catch(() => setConnection(null))
      .finally(() => setConnectionChecked(true))
  }, [])

  /* ======================================================================
     Upload
     ====================================================================== */

  async function handleFileChosen(file: File | undefined) {
    if (!file || !user) return
    setError(null)

    const invalid = validateFile(file)
    if (invalid) {
      setError(invalid)
      return
    }

    setStage({ kind: 'reading', fileName: file.name, progress: null })

    const outcome = await readDocument(file, (progress) =>
      setStage({ kind: 'reading', fileName: file.name, progress }),
    )

    if (!outcome.ok) {
      setError(outcome.reason)
      setStage({ kind: 'choose' })
      return
    }

    const extraction = extractJourneyFromText(outcome.text)

    if (!isUsableJourney(extraction)) {
      setError("We couldn't find enough travel information in this document.")
      setStage({ kind: 'choose' })
      return
    }

    // Store the document first, so the evidence exists even if the traveller
    // decides not to keep the journey.
    let stored: UploadedDocument | null = null
    try {
      stored = await uploadTravelDocument(user.id, file, extraction, { status: 'processed' }, 'upload')
    } catch (cause) {
      console.warn('Document storage failed:', cause)
    }

    const draft = draftFromExtraction(extraction.fields, extraction.provenance, 'upload')
    const duplicates = await findPotentialDuplicates(user.id, draft)

    setStage({
      kind: 'review',
      draft,
      warnings: extraction.warnings,
      confidence: extraction.confidence,
      sourceLabel: 'Imported from uploaded ticket',
      documentName: file.name,
      document: stored,
      duplicates,
    })
  }

  /* ======================================================================
     Gmail
     ====================================================================== */

  async function handleConnectGmail() {
    setError(null)
    setStage({ kind: 'gmail-connecting' })
    try {
      await beginGmailConnect() // navigates to Google
    } catch (cause) {
      setError(
        cause instanceof GmailError
          ? cause.message
          : 'Gmail could not be connected right now. You can upload a booking instead.',
      )
      setStage({ kind: 'choose' })
    }
  }

  async function handleSearchGmail() {
    setError(null)
    setStage({ kind: 'gmail-list', emails: [], loading: true, error: null })
    try {
      const emails = await searchGmail()
      setStage({ kind: 'gmail-list', emails, loading: false, error: null })
    } catch (cause) {
      const message =
        cause instanceof GmailError
          ? cause.message
          : 'Gmail could not be searched right now. Please try again.'
      setStage({ kind: 'gmail-list', emails: [], loading: false, error: message })
    }
  }

  async function handleDisconnectGmail() {
    await disconnectGmail().catch(() => undefined)
    setConnection(null)
    setStage({ kind: 'choose' })
  }

  async function handlePickEmail(email: GmailEmailSummary) {
    if (!user) return
    setError(null)
    setStage({ kind: 'gmail-reading', subject: email.subject })

    try {
      const extracted = await extractFromEmail(email.id)

      // Prefer an attached ticket: a PDF or image is more reliable than an
      // email body, which is often heavily templated.
      let text = extracted.text
      let documentName: string | null = extracted.subject?.slice(0, 80) ?? null
      let file: File | null = null

      if (extracted.attachment) {
        try {
          file = await attachmentToFile(extracted.attachment)
          documentName = extracted.attachment.fileName
          const outcome = await readDocument(file)
          if (outcome.ok && outcome.text.replace(/[^a-z0-9]/gi, '').length > 24) {
            text = outcome.text
          }
        } catch (cause) {
          console.warn('Attachment could not be read, falling back to the email body:', cause)
        }
      }

      const extraction = extractJourneyFromText(text)

      if (!isUsableJourney(extraction)) {
        setError("We couldn't find enough travel information in this email.")
        setStage({ kind: 'gmail-list', emails: [], loading: false, error: null })
        return
      }

      let stored: UploadedDocument | null = null
      if (file) {
        try {
          stored = await uploadTravelDocument(
            user.id,
            file,
            extraction,
            { status: 'processed' },
            'gmail',
            { messageId: extracted.messageId, attachmentId: extracted.attachments[0]?.attachmentId ?? '' },
          )
        } catch (cause) {
          console.warn('Gmail attachment storage failed:', cause)
        }
      }

      const draft = draftFromExtraction(extraction.fields, extraction.provenance, 'gmail')
      const duplicates = await findPotentialDuplicates(user.id, draft)

      setStage({
        kind: 'review',
        draft,
        warnings: extraction.warnings,
        confidence: extraction.confidence,
        sourceLabel: 'Imported from Gmail',
        documentName,
        document: stored,
        duplicates,
      })
    } catch (cause) {
      setError(cause instanceof GmailError ? cause.message : 'That email could not be read.')
      setStage({ kind: 'choose' })
    }
  }

  /* ======================================================================
     Confirm
     ====================================================================== */

  async function handleConfirm(draft: JourneyDraft, document: UploadedDocument | null) {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      const trip = await saveJourney(user.id, draft)
      if (document) await attachDocumentToTrip(document.id, trip.id)
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That journey could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  /* ======================================================================
     Render
     ====================================================================== */

  if (stage.kind === 'review') {
    return (
      <div className="mb-6">
        {error && (
          <div className="mb-4">
            <Banner tone="danger">{error}</Banner>
          </div>
        )}

        {stage.duplicates.length > 0 && (
          <div className="mb-4">
            <Banner tone="warn">
              <p className="font-semibold">This journey may already exist in Wayvo.</p>
              <p className="mt-1">
                We found{' '}
                {stage.duplicates
                  .map((duplicate) => `"${duplicate.trip.title}" (${duplicate.reason})`)
                  .join(', ')}
                .
              </p>
              <p className="mt-1.5">You can import it anyway, or close this and open the existing journey.</p>
            </Banner>
          </div>
        )}

        <JourneyReview
          draft={stage.draft}
          warnings={stage.warnings}
          confidence={stage.confidence}
          sourceLabel={stage.sourceLabel}
          documentName={stage.documentName}
          saving={saving}
          saveError={null}
          onChange={(draft) =>
            setStage((current) => (current.kind === 'review' ? { ...current, draft } : current))
          }
          onEdit={(draft) =>
            setStage((current) =>
              current.kind === 'review' ? { ...current, draft, provenance: current.draft.provenance } : current,
            )
          }
          onConfirm={() => handleConfirm(stage.draft, stage.document)}
          onCancel={onClose}
        />
      </div>
    )
  }

  return (
    <section className="wva-card wva-card--pad mb-6">
      <header className="mb-5">
        <h2 className="wva-h2">Add a journey</h2>
        <p className="wva-body mt-1.5">
          Bring in a booking confirmation and Wayvo will read the travel details for you. You can check everything before
          it is saved.
        </p>
      </header>

      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {stage.kind === 'reading' && (
        <div className="mb-4">
          <Banner tone="info">
            <span className="font-semibold">Reading {stage.fileName}</span>
            <span className="mt-1 block">
              {stage.progress === null
                ? 'Working out what is on this document…'
                : `Reading the text — ${Math.round(stage.progress * 100)}%`}
            </span>
          </Banner>
        </div>
      )}

      {stage.kind === 'gmail-connecting' && (
        <div className="mb-4">
          <Banner tone="info">Opening Google&rsquo;s consent screen…</Banner>
        </div>
      )}

      {stage.kind === 'gmail-reading' && (
        <div className="mb-4">
          <Banner tone="info">Reading &ldquo;{stage.subject}&rdquo;…</Banner>
        </div>
      )}

      {/* ---- gmail results ------------------------------------------------ */}
      {stage.kind === 'gmail-list' && (
        <div className="mb-5">
          {stage.loading && <p className="wva-body">Looking for booking emails…</p>}

          {stage.error && <Banner tone="warn">{stage.error}</Banner>}

          {!stage.loading && !stage.error && stage.emails.length === 0 && (
            <Banner tone="warn">We couldn&rsquo;t find any recent travel bookings in your Gmail.</Banner>
          )}

          {!stage.loading && stage.emails.length > 0 && (
            <>
              <h3 className="wva-h3 mb-1">Travel bookings found</h3>
              <p className="wva-meta mb-3">
                {stage.emails.length} recent {stage.emails.length === 1 ? 'email' : 'emails'} matched. Only the sender,
                subject and date are shown &mdash; Wayvo reads the full message only when you choose one.
              </p>
              <ul className="flex flex-col gap-2.5">
                {stage.emails.map((email) => (
                  <li key={email.id}>
                    <EmailRow email={email} onImport={() => handlePickEmail(email)} />
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setStage({ kind: 'choose' })}>
              Back
            </Button>
          </div>
        </div>
      )}

      {/* ---- the two import options --------------------------------------- */}
      {stage.kind === 'choose' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="wva-card wva-card--interactive flex flex-col items-start gap-2 px-4 py-5 text-left"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-app-accent-soft text-app-accent">
              <Upload size={17} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="wva-h3">Upload Ticket / PDF</span>
            <span className="text-[13px] leading-relaxed text-app-text-muted">
              A train ticket, flight ticket, hotel booking or itinerary. {describeAccepted()}.
            </span>
          </button>

          <button
            type="button"
            onClick={connection ? handleSearchGmail : handleConnectGmail}
            disabled={connectionChecked && !connection && false}
            className="wva-card wva-card--interactive flex flex-col items-start gap-2 px-4 py-5 text-left"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-app-accent-soft text-app-accent">
              {connection ? (
                <RefreshCw size={17} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Mail size={17} strokeWidth={2} aria-hidden="true" />
              )}
            </span>
            <span className="wva-h3">Import from Gmail</span>
            <span className="text-[13px] leading-relaxed text-app-text-muted">
              {connection
                ? `Connected as ${connection.gmail_address ?? 'your account'}. Wayvo will look for booking emails.`
                : 'Connect Gmail to let Wayvo find travel booking confirmations and itineraries.'}
            </span>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {connection && (
                <Pill tone="success">
                  <Check size={12} strokeWidth={3} aria-hidden="true" />
                  Connected
                </Pill>
              )}
              {/* The scope is restated once connected, not just before. */}
              <Pill tone="neutral">Read-only access</Pill>
            </div>
          </button>
        </div>
      )}

      {stage.kind === 'choose' && connection && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-app-text-subtle">
            Wayvo can read your booking emails. It cannot send, delete or change anything.
          </p>
          <Button variant="ghost" size="sm" onClick={handleDisconnectGmail}>
            Disconnect
          </Button>
        </div>
      )}

      {stage.kind === 'choose' && (
        <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-app-text-subtle">
          <ScanText size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          Wayvo reads these details with you, then asks you to confirm. You can correct anything before it is saved, and
          you can also add a journey by hand below.
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void handleFileChosen(file)
        }}
      />
    </section>
  )
}

/* -------------------------------------------------------------------------- */

const KIND_LABEL: Record<GmailCandidateKind, string> = {
  train: 'Train booking',
  flight: 'Flight booking',
  bus: 'Bus booking',
  hotel: 'Hotel booking',
  itinerary: 'Travel itinerary',
  booking: 'Booking email',
}

const KIND_ICON: Record<GmailCandidateKind, string> = {
  train: '🚆',
  flight: '✈️',
  bus: '🚌',
  hotel: '🏨',
  itinerary: '🧳',
  booking: '📄',
}

function EmailRow({ email, onImport }: { email: GmailEmailSummary; onImport: () => void }) {
  const kind = email.hint?.kind ?? 'booking'

  return (
    <article className="wva-card wva-card--interactive px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-app-text">
            <span aria-hidden="true">{KIND_ICON[kind]}</span>
            <span className="truncate">{KIND_LABEL[kind]}</span>
            {email.hasAttachment && (
              <span title="Has a PDF or image attachment" className="inline-flex text-app-text-subtle">
                <Paperclip size={13} strokeWidth={2} aria-label="Has an attachment" />
              </span>
            )}
          </p>

          <p className="mt-1 truncate text-[13px] text-app-text-muted">{email.subject}</p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-app-text-subtle">
            <span>{email.hint?.operator || email.from}</span>
            <span aria-hidden="true">·</span>
            <span>{shortDate(email.date)}</span>
            {email.hint?.status && (
              <>
                <span aria-hidden="true">·</span>
                <span>{email.hint.status}</span>
              </>
            )}
          </p>
        </div>

        <Button size="sm" onClick={onImport}>
          Import journey
        </Button>
      </div>
    </article>
  )
}

function shortDate(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
