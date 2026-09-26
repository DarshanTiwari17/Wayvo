import { useEffect, useRef, useState } from 'react'
import { Bot, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { askTravelAssistant, type ChatMessage } from './travelChatService'

const STARTER_QUESTIONS = [
  'What trips do I have coming up?',
  'Do I have any active travel alerts?',
  'Summarize my recovery plans',
]

export function TravelChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending, open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  async function sendMessage(content = input) {
    content = content.trim()
    if (!content || pending) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }]
    setMessages(nextMessages)
    setInput('')
    setError(null)
    setPending(true)
    try {
      const answer = await askTravelAssistant(nextMessages)
      setMessages([...nextMessages, { role: 'assistant', content: answer }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The travel assistant could not reply. Please try again.')
    } finally {
      setPending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="travel-chat">
      {open && (
        <section className="travel-chat__panel" aria-label="Wayvo travel assistant" aria-modal="false" role="dialog">
          <header className="travel-chat__header">
            <span className="travel-chat__avatar"><Bot size={20} aria-hidden="true" /></span>
            <div className="travel-chat__heading">
              <h2>Wayvo assistant</h2>
              <p>Your journeys, in context</p>
            </div>
            <button type="button" className="travel-chat__icon-button" onClick={() => setMessages([])} disabled={!messages.length || pending} aria-label="Clear conversation" title="Clear conversation">
              <Sparkles size={17} aria-hidden="true" />
            </button>
            <button type="button" className="travel-chat__icon-button" onClick={() => setOpen(false)} aria-label="Close chat" title="Close chat">
              <X size={19} aria-hidden="true" />
            </button>
          </header>

          <div className="travel-chat__transcript" ref={transcriptRef} aria-live="polite" aria-relevant="additions text">
            {!messages.length && (
              <div className="travel-chat__welcome">
                <span className="travel-chat__welcome-icon"><Sparkles size={20} aria-hidden="true" /></span>
                <h3>How can I help with your travel?</h3>
                <p>I can answer using the journeys, alerts, and recovery plans saved in your Wayvo account.</p>
                <div className="travel-chat__suggestions">
                  {STARTER_QUESTIONS.map((question) => (
                    <button key={question} type="button" onClick={() => void sendMessage(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <article className={`travel-chat__message travel-chat__message--${message.role}`} key={`${index}-${message.role}`}>
                <p>{message.content}</p>
              </article>
            ))}
            {pending && <div className="travel-chat__typing" role="status"><span /><span /><span /> Thinking</div>}
            {error && <p className="travel-chat__error" role="alert">{error}</p>}
          </div>

          <form className="travel-chat__composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
            <label className="travel-chat__sr-only" htmlFor="travel-chat-input">Message the travel assistant</label>
            <textarea
              id="travel-chat-input"
              ref={inputRef}
              rows={1}
              maxLength={2000}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Ask about your trips..."
              disabled={pending}
            />
            <button type="submit" disabled={pending || !input.trim()} aria-label="Send message" title="Send message">
              <Send size={17} aria-hidden="true" />
            </button>
          </form>
          <p className="travel-chat__privacy">Answers use your Wayvo travel data. Check important details against your booking.</p>
        </section>
      )}

      <button
        type="button"
        className="travel-chat__launcher"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close travel assistant' : 'Open travel assistant'}
        aria-expanded={open}
        title={open ? 'Close travel assistant' : 'Ask Wayvo'}
      >
        {open ? <X size={23} aria-hidden="true" /> : <MessageCircle size={23} aria-hidden="true" />}
      </button>
    </div>
  )
}