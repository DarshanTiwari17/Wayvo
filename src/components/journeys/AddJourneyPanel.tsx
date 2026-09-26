import { useEffect, useRef, useState } from 'react'
import { Mail, RefreshCw, ScanText, Upload } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { extractJourneyFromText, isUsableJourney } from '../../lib/bookingParser'
import { readDocument, releaseOcr, describeAccepted, validateFile } from '../../services/documentReader'
import { attachDocumentToTrip, uploadTravelDocument, type UploadedDocument } from '../../services/documentService'
import { draftFromExtraction, findPotentialDuplicates, saveJourney, type JourneyDraft, type PotentialDuplicate } from '../../services/importService'
import {
  attachmentToFile,
  beginGmailConnect,
  extractFromEmail,
  getGmailConnection,
  GmailError,
  searchGmail,
  type GmailConnection,
  type GmailEmailSummary,
} from '../../services/gmailService'
import { Banner, Button, Pill } from '../app/Primitives'
import { JourneyReview } from './JourneyReview'

/**
 * The "Add a journey" panel.
 *
 * Two real paths into the same review screen:
 *   • Upload   → file picker → Supabase Storage → text extraction → review
 *   • Gmail    → Google consent → Gmail search → pick an email → review
 *
 * Nothing is written to `trips` until the traveller confirms, and the original
 * document is stored before extraction so it is never lost even if the parse
 * fails.
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
  const fileInput = useRef<HTMLInputElement>(null)

  // Free the OCR worker when the panel goes away.
  useEffect(() => () => void releaseOcr(), [])

  useEffect(() => {
    void getGmailConnection().then(setConnection).catch(() => setConnection(null))
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
      // A storage failure should not block a journey the traveller can see.
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
      await beginGmailConnect() // navigates away
    } catch (cause) {
      setError(cause instanceof GmailError ? cause.message : 'Gmail could not be connected right now.')
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
      const message = cause instanceof GmailError ? cause.message : 'Gmail could not be searched right now.'
      setStage({ kind: 'gmail-list', emails: [], loading: false, error: message })
    }
  }

  async function handlePickEmail(email: GmailEmailSummary) {
    if (!user) return
    setError(null)
    setStage({ kind: 'gmail-reading', subject: email.subject })

    try {
      const extracted = await extractFromEmail(email.id)

      // Prefer the attached ticket: a PDF or image is more reliable than an
      // email body, which is often heavily templated.
      let text = extracted.text
      let documentName: string | null = `${extracted.subject || 'booking'}`.slice(0, 80)
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
                {stage.duplicates.map((duplicate) => `"${duplicate.trip.title}" (${duplicate.reason})`).join(', ')}.
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
          onChange={(draft) => setStage((current) => (current.kind === 'review' ? { ...current, draft } : current))}
          onEdit={(draft) =>
            setStage((current) => {
              if (current.kind !== 'review') return current
              return { ...current, draft, provenance: current.draft.provenance }
            })
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

      {/* ---- busy states -------------------------------------------------- */}
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
              <h3 className="wva-h3 mb-3">Travel bookings found</h3>
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
            className="wva-card wva-card--interactive flex flex-col items-start gap-2 px-4 py-5 text-left"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-app-accent-soft text-app-accent">
              {connection ? <RefreshCw size={17} strokeWidth={2} aria-hidden="true" /> : <Mail size={17} strokeWidth={2} aria-hidden="true" />}
            </span>
            <span className="wva-h3">Import from Gmail</span>
            <span className="text-[13px] leading-relaxed text-app-text-muted">
              {connection
                ? `Connected as ${connection.gmail_address ?? 'your account'}. Wayvo will look for booking emails.`
                : 'Connect Gmail to let Wayvo find travel booking confirmations and itineraries. Read-only access.'}
            </span>
            {connection && <Pill tone="success">Connected</Pill>}
          </button>
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

function EmailRow({ email, onImport }: { email: GmailEmailSummary; onImport: () => void }) {
  const sender = email.from.replace(/<[^>]+>/, '').trim()
  const kind = classifyEmail(email.subject, sender)

  return (
    <article className="wva-card wva-card--interactive px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-app-text">
            <span aria-hidden="true">{kind.icon}</span>
            <span className="truncate">{kind.label}</span>
          </p>
          <p className="mt-1 truncate text-[13px] text-app-text-muted">{email.subject}</p>
          <p className="mt-0.5 text-[12px] text-app-text-subtle">
            {sender} · {shortDate(email.date)}
            {email.snippet ? ` · ${email.snippet.slice(0, 90)}` : ''}
          </p>
        </div>
        <Button size="sm" onClick={onImport}>
          Import journey
        </Button>
      </div>
    </article>
  )
}

const CLASSIFIERS: { test: RegExp; label: string; icon: string }[] = [
  { test: /(train|railway|irctc|rail)/i, label: 'Train booking', icon: '🚆' },
  { test: /(flight|airline|air|boarding pass|check-?in)/i, label: 'Flight booking', icon: '✈️' },
  { test: /(bus|coach|volvo)/i, label: 'Bus booking', icon: '🚌' },
  { test: /(hotel|resort|reservation|room|stay)/i, label: 'Hotel booking', icon: '🏨' },
  { test: /(itinerary|travel details|e-?ticket)/i, label: 'Travel itinerary', icon: '🧳' },
]

function classifyEmail(subject: string, sender: string): { label: string; icon: string } {
  const haystack = `${subject} ${sender}`
  for (const classifier of CLASSIFIERS) {
    if (classifier.test.test(haystack)) return { label: classifier.label, icon: classifier.icon }
  }
  return { label: 'Booking email', icon: '📄' }
}

function shortDate(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
