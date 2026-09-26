import { getSupabase } from '../../lib/supabase'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function askTravelAssistant(messages: ChatMessage[]): Promise<string> {
  const { data, error } = await getSupabase().functions.invoke('wayvo-travel-chat', {
    body: { messages },
  })

  if (error) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String(data.error)
      : 'Could not reach the travel assistant. Check your connection and try again.'
    throw new Error(message)
  }

  if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
    throw new Error('The travel assistant returned an empty response. Please try again.')
  }
  return data.reply.trim()
}