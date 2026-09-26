/**
 * Reads travel documents in the browser and produces plain text.
 *
 * Two real code paths:
 *   • PDF  → pdf.js pulls the embedded text layer. E-tickets from airlines and
 *            railways are normally "born digital", so this is accurate and fast.
 *   • Image → Tesseract OCR, loaded lazily so it never costs anything until a
 *            photo is actually uploaded.
 *
 * Nothing is uploaded anywhere by this module. It only turns a File into text;
 * storage and parsing are separate concerns.
 */

export type ReadOutcome = { ok: true; text: string; method: 'pdf-text' | 'ocr' } | { ok: false; reason: string }

export const ACCEPTED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

export const ACCEPTED_EXT = /\.(pdf|jpe?g|png|webp|heic|heif)$/i

export const MAX_BYTES = 10 * 1024 * 1024

export function describeAccepted(): string {
  return 'PDF, JPG, PNG or WEBP, up to 10 MB'
}

export function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME.includes(file.type) && !ACCEPTED_EXT.test(file.name)) {
    return 'This file type isn\'t supported. Please upload a PDF or image of your booking.'
  }
  if (file.size === 0) {
    return 'That file is empty. Please choose the booking confirmation again.'
  }
  if (file.size > MAX_BYTES) {
    return 'That file is larger than 10 MB. Please upload a smaller image or PDF.'
  }
  return null
}

function humanError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/password/i.test(message)) return 'That PDF is password protected. Please upload an unprotected copy.'
  if (/invalid|corrupt|structure/i.test(message)) return 'We couldn\'t read this document. Try uploading a clearer image or PDF.'
  if (/network|fetch|load/i.test(message)) return 'The text reader failed to load. Check your connection and try again.'
  return fallback
}

/* -------------------------------------------------------------------------- */

async function readPdf(file: File): Promise<ReadOutcome> {
  try {
    const pdfjs = await import('pdfjs-dist')
    // Use the bundled worker so this works offline and from any origin.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const data = new Uint8Array(await file.arrayBuffer())
    const doc = await pdfjs.getDocument({ data }).promise

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      // Rebuild reading order: pdf.js items already carry their transform, so
      // grouping by line keeps "Mumbai Pune 07:10" from becoming interleaved.
      const line = content.items
        .map((item) => ('str' in item ? { text: item.str, y: Math.round(item.transform[5]) } : null))
        .filter((item): item is { text: string; y: number } => Boolean(item?.text))
      const grouped = new Map<number, string>()
      for (const item of line) {
        grouped.set(item.y, (grouped.get(item.y) ?? '') + item.text + ' ')
      }
      pages.push([...grouped.entries()].sort((a, b) => b[0] - a[0]).map(([, text]) => text.trim()).join('\n'))
    }

    const text = pages.join('\n\n').replace(/[ \t]{2,}/g, ' ').trim()
    if (text.replace(/[^a-z0-9]/gi, '').length < 12) {
      return {
        ok: false,
        reason:
          'We couldn\'t read this document. If it is a scanned image rather than a text PDF, upload the ticket as a photo instead.',
      }
    }
    return { ok: true, text, method: 'pdf-text' }
  } catch (error) {
    return { ok: false, reason: humanError(error, 'We couldn\'t read this document. Try uploading a clearer image or PDF.') }
  }
}

let ocrWorker: unknown = null

async function readImage(file: File, onProgress?: (percent: number) => void): Promise<ReadOutcome> {
  try {
    const { default: Tesseract } = await import('tesseract.js')

    if (!ocrWorker) {
      ocrWorker = await Tesseract.createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
        },
      })
    }

    const result = (await (ocrWorker as { recognize: (f: File) => Promise<{ data: { text: string } }> }).recognize(
      file,
    )) as { data: { text: string } }

    const text = result.data.text.replace(/[ \t]{2,}/g, ' ').trim()
    if (text.replace(/[^a-z0-9]/gi, '').length < 12) {
      return {
        ok: false,
        reason: 'We couldn\'t find any readable text in that image. Try a sharper, better-lit photo of the ticket.',
      }
    }
    return { ok: true, text, method: 'ocr' }
  } catch (error) {
    return {
      ok: false,
      reason: humanError(error, 'We couldn\'t read this image. Try a clearer, better-lit photo of the ticket.'),
    }
  }
}

/** Frees the OCR worker. Called when the import panel closes. */
export async function releaseOcr(): Promise<void> {
  if (!ocrWorker) return
  try {
    await (ocrWorker as { terminate: () => Promise<void> }).terminate()
  } catch {
    /* the worker is going away regardless */
  }
  ocrWorker = null
}

export function readDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ReadOutcome> {
  const invalid = validateFile(file)
  if (invalid) return Promise.resolve({ ok: false, reason: invalid })

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  return isPdf ? readPdf(file) : readImage(file, onProgress)
}
