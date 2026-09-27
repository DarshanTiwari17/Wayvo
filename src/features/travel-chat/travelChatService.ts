import { getSupabase } from '../../lib/supabase'
import { supabaseAnonKey, supabaseUrl } from '../../lib/supabaseConfig'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function streamTravelAssistant(messages: ChatMessage[], onToken: (token: string) => void): Promise<void> {
  const { data, error } = await getSupabase().auth.getSession()
  if (error) throw error
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('Please sign in to generate the AI brief.')

  const response = await fetch(`${supabaseUrl}/functions/v1/nugen-travel-chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messages, stream: true }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `The AI brief request failed (HTTP ${response.status}).`,
    )
  }

  if (!response.body) throw new Error('The AI response did not include a readable stream.')
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = (await response.json().catch(() => null)) as { reply?: unknown; error?: unknown } | null
    if (typeof payload?.error === 'string') throw new Error(payload.error)
    if (typeof payload?.reply === 'string' && payload.reply.trim()) {
      onToken(payload.reply.trim())
      return
    }
    throw new Error('The deployed Nugen function returned neither a token stream nor a reply.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedText = false

  const readEvent = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) return

    let event: { token?: unknown; error?: unknown }
    try {
      event = JSON.parse(data) as { token?: unknown; error?: unknown }
    } catch {
      return
    }
    if (typeof event.error === 'string') throw new Error(event.error)
    if (typeof event.token === 'string' && event.token) {
      receivedText = true
      onToken(event.token)
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary) {
        readEvent(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
      if (done) {
        if (buffer.trim()) readEvent(buffer)
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!receivedText) throw new Error('Nugen returned an empty response.')
}

export async function askTravelAssistant(messages: ChatMessage[]): Promise<string> {
  const { data, error } = await getSupabase().functions.invoke('wayvo-travel-chat', {
    body: { messages },
  })

  if (error) {
    let message = data && typeof data === 'object' && 'error' in data
      ? String(data.error)
      : 'Could not reach the travel assistant. Check your connection and try again.'

    if (typeof error === 'object' && error !== null && 'context' in error) {
      const context = (error as { context?: unknown }).context
      if (context instanceof Response) {
        try {
          const body = (await context.clone().json()) as { error?: unknown }
          if (typeof body.error === 'string' && body.error.trim()) message = body.error.trim()
        } catch {
          if (context.status) message = `Travel assistant request failed (HTTP ${context.status}). Please try again shortly.`
        }
      }
    }

    throw new Error(message)
  }

  if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
    throw new Error('The travel assistant returned an empty response. Please try again.')
  }
  return data.reply.trim()
}