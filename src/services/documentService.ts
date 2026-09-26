/**
 * Uploads travel documents to Supabase Storage and records their metadata.
 *
 * Storage path: `travel-documents/<profile uuid>/<uuid>.<ext>`
 * The leading folder is the caller's own UUID, which is what the bucket's RLS
 * policies check. A different user cannot list, read or overwrite it.
 */
import { getSupabase } from '../lib/supabase'
import { ACCEPTED_MIME, validateFile } from './documentReader'
import type { Json } from '../types/database'
import type { ExtractionResult } from '../lib/bookingParser'

export const BUCKET = 'travel-documents'

export type DocumentOrigin = 'upload' | 'gmail'

export interface UploadedDocument {
  id: string
  storagePath: string
  fileName: string
  mimeType: string
  byteSize: number
  createdAt: string
}

export class DocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentError'
  }
}

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function extensionFor(file: File): string {
  const fromMime = EXTENSION[file.type]
  if (fromMime) return fromMime
  const match = file.name.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : 'bin'
}

/**
 * Uploads the file, then writes the metadata row.
 *
 * The row is created up front (status `pending`) so a failed extraction still
 * leaves an auditable record, then updated to the real outcome.
 */
export async function uploadTravelDocument(
  profileId: string,
  file: File,
  extraction: ExtractionResult | null,
  outcome: { status: 'processed' | 'unreadable' | 'no_travel_data' },
  origin: DocumentOrigin = 'upload',
  gmail?: { messageId: string; attachmentId: string },
): Promise<UploadedDocument> {
  const invalid = validateFile(file)
  if (invalid) throw new DocumentError(invalid)

  const supabase = getSupabase()
  const objectName = `${crypto.randomUUID()}.${extensionFor(file)}`
  const storagePath = `${profileId}/${objectName}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    // The user is already authenticated; RLS in the bucket authorises this path.
    upsert: false,
  })

  if (uploadError) {
    const message = uploadError.message
    throw new DocumentError(
      /bucket not found|no such bucket/i.test(message)
        ? 'Document storage is not set up on this project yet. An administrator needs to run the 0003_journey_import.sql migration.'
        : /row-level security|permission/i.test(message)
          ? 'We couldn\'t store that document. Please sign in again and retry.'
          : 'That file could not be uploaded. Please try again.',
    )
  }

  const { data, error: rowError } = await supabase
    .from('journey_documents')
    .insert({
      profile_id: profileId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      byte_size: file.size,
      origin,
      gmail_message_id: gmail?.messageId ?? null,
      gmail_attachment_id: gmail?.attachmentId ?? null,
      extraction_status: outcome.status,
      extracted: extraction
        ? (JSON.parse(JSON.stringify({ fields: extraction.fields, confidence: extraction.confidence })) as Json)
        : null,
    })
    .select('id, storage_path, file_name, mime_type, byte_size, created_at')
    .single()

  if (rowError) {
    // Don't leave an orphaned file behind if the metadata write failed.
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw new DocumentError('The document uploaded but could not be recorded. Please try again.')
  }

  return {
    id: data.id,
    storagePath: data.storage_path,
    fileName: data.file_name,
    mimeType: data.mime_type,
    byteSize: data.byte_size ?? file.size,
    createdAt: data.created_at,
  }
}

/** Marks the document as belonging to a journey once the traveller confirms. */
export async function attachDocumentToTrip(documentId: string, tripId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.from('journey_documents').update({ trip_id: tripId }).eq('id', documentId)
  if (error) {
    // Non-fatal: the journey is already saved, the link can be retried later.
    console.warn('Could not link the document to the journey:', error.message)
  }
}

/**
 * A short-lived signed URL for the owner to re-open their own document.
 * RLS still applies, so this cannot be used to reach another user's file.
 */
export async function createDocumentUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds)
  if (error) return null
  return data?.signedUrl ?? null
}

export async function deleteTravelDocument(documentId: string, storagePath: string): Promise<void> {
  const supabase = getSupabase()
  await supabase.storage.from(BUCKET).remove([storagePath])
  await supabase.from('journey_documents').delete().eq('id', documentId)
}

export { ACCEPTED_MIME }
