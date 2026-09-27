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
    return "This file type isn't supported. Please upload a PDF or image of your booking."
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
  if (/invalid|corrupt|structure/i.test(message)) return "We couldn't read this document. Try uploading a clearer image or PDF."
  if (/network|fetch|load/i.test(message)) return 'The text reader failed to load. Check your connection and try again.'
  return fallback
}

/* -------------------------------------------------------------------------- */

interface PositionedPdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** Rebuild page text by position so PDF item order and missing spaces don't corrupt fields. */
export function reconstructPdfPageText(items: readonly PositionedPdfTextItem[]): string {
  const rows: { y: number; items: PositionedPdfTextItem[] }[] = []

  for (const item of items) {
    if (!item.str.trim() || item.transform.length < 6) continue
    const x = item.transform[4]
    const y = item.transform[5]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue

    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2)
    if (!row) {
      row = { y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(({ items: rowItems }) => {
      const ordered = rowItems.sort((a, b) => a.transform[4] - b.transform[4])
      let line = ''
      let previous: PositionedPdfTextItem | null = null

      for (const item of ordered) {
        const gap = previous ? item.transform[4] - (previous.transform[4] + previous.width) : 0
        const spaceThreshold = Math.max(1.5, Math.min(item.height, previous?.height ?? item.height) * 0.15)
        if (previous && gap > spaceThreshold && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' '
        line += item.str
        previous = item
      }

      return line.trim()
    })
    .filter(Boolean)
    .join('\n')
}

type OcrWorker = {
  recognize: (source: File | HTMLCanvasElement) => Promise<{ data: { text: string } }>
  terminate: () => Promise<void>
}

let ocrWorker: OcrWorker | null = null
let ocrProgressCallback: ((percent: number) => void) | undefined

async function getOcrWorker(): Promise<OcrWorker> {
  if (!ocrWorker) {
    const { default: Tesseract } = await import('tesseract.js')
    ocrWorker = (await Tesseract.createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') ocrProgressCallback?.(m.progress)
      },
    })) as unknown as OcrWorker
  }
  return ocrWorker
}

async function readPdf(file: File, onProgress?: (percent: number) => void): Promise<ReadOutcome> {
  let destroyDocument: (() => Promise<void>) | null = null
  try {
    const pdfjs = await import('pdfjs-dist')
    // Use the bundled worker so this works offline and from any origin.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

    const data = new Uint8Array(await file.arrayBuffer())
    const loadingTask = pdfjs.getDocument({ data })
    const pdfDocument = await loadingTask.promise
    destroyDocument = () => loadingTask.destroy()

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber)
      const content = await page.getTextContent()
      const textItems = content.items.flatMap((item) => {
        if (
          !('str' in item) ||
          typeof item.str !== 'string' ||
          !Array.isArray(item.transform) ||
          typeof item.width !== 'number' ||
          typeof item.height !== 'number'
        ) {
          return []
        }
        return [{ str: item.str, transform: item.transform, width: item.width, height: item.height }]
      })
      pages.push(reconstructPdfPageText(textItems))
    }

    const text = pages.join('\n\n').replace(/[ \t]{2,}/g, ' ').trim()
    if (text.replace(/[^a-z0-9]/gi, '').length >= 12) {
      return { ok: true, text, method: 'pdf-text' }
    }

    // Scanned PDFs have no embedded text layer, so render their pages and OCR them.
    ocrProgressCallback = onProgress
    try {
      const worker = await getOcrWorker()
      const ocrPages: string[] = []
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber)
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = Math.min(2, 4096 / Math.max(baseViewport.width, baseViewport.height))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not create a canvas for PDF text recognition.')

        await page.render({ canvas, canvasContext: context, viewport }).promise
        ocrPages.push((await worker.recognize(canvas)).data.text)
      }

      const ocrText = ocrPages.join('\n\n').replace(/[ \t]{2,}/g, ' ').trim()
      if (ocrText.replace(/[^a-z0-9]/gi, '').length >= 12) return { ok: true, text: ocrText, method: 'ocr' }
      return { ok: false, reason: "We couldn't find readable text in that PDF. Try a clearer scan of the ticket." }
    } finally {
      ocrProgressCallback = undefined
    }
  } catch (error) {
    return { ok: false, reason: humanError(error, "We couldn't read this document. Try uploading a clearer image or PDF.") }
  } finally {
    await destroyDocument?.().catch(() => undefined)
  }
}

async function prepareImageForOcr(file: File): Promise<File | HTMLCanvasElement> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(3, 4096 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(bitmap.width * scale))
    canvas.height = Math.max(1, Math.ceil(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return file

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.filter = 'grayscale(100%) contrast(1.2)'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

async function readImage(file: File, onProgress?: (percent: number) => void): Promise<ReadOutcome> {
  try {
    ocrProgressCallback = onProgress
    const worker = await getOcrWorker()
    const result = await worker.recognize(await prepareImageForOcr(file))

    const text = result.data.text.replace(/[ \t]{2,}/g, ' ').trim()
    if (text.replace(/[^a-z0-9]/gi, '').length < 12) {
      return {
        ok: false,
        reason: "We couldn't find any readable text in that image. Try a sharper, better-lit photo of the ticket.",
      }
    }
    return { ok: true, text, method: 'ocr' }
  } catch (error) {
    return {
      ok: false,
      reason: humanError(error, "We couldn't read this image. Try a clearer, better-lit photo of the ticket."),
    }
  } finally {
    ocrProgressCallback = undefined
  }
}

/** Frees the OCR worker. Called when the import panel closes. */
export async function releaseOcr(): Promise<void> {
  if (!ocrWorker) return
  try {
    await ocrWorker.terminate()
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
  return isPdf ? readPdf(file, onProgress) : readImage(file, onProgress)
}
