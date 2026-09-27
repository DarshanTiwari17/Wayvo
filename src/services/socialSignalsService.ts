/**
 * Social Signals API client.
 *
 * Talks to the backend GNews proxy. The GNews API key never reaches the
 * browser — it lives only in the backend environment.
 */

const API_BASE = '/api/social-signals'

export type EventType =
  | 'Flood'
  | 'Heavy Rain'
  | 'Cyclone'
  | 'Storm'
  | 'Landslide'
  | 'Road Closure'
  | 'Weather Emergency'
  | 'Travel Disruption'

export type Severity = 'High' | 'Medium' | 'Low'
export type Sentiment = 'Alert' | 'Negative' | 'Neutral' | 'Positive'

export interface SocialSignal {
  title: string
  description: string
  url: string
  source: string
  published_at: string
  image: string
  location: string
  event_type: EventType | string
  severity: Severity
  sentiment: Sentiment
}

export interface SocialSignalsResponse {
  articles: SocialSignal[]
  total: number
  location: string
}

export interface SocialSignalsSummary {
  location: string
  active_events: string[]
  high_severity_count: number
  dominant_event: string | null
  recent_signals: SocialSignal[]
}

export class SocialSignalsError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode = 0) {
    super(message)
    this.name = 'SocialSignalsError'
    this.statusCode = statusCode
  }
}

async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = await response.json()
      if (body.error) message = body.error
    } catch {
      // ignore JSON parse errors
    }
    throw new SocialSignalsError(message, response.status)
  }

  return response.json() as Promise<T>
}

export async function fetchSocialSignals(
  token: string,
  params: { location?: string; keyword?: string; page?: number; limit?: number },
): Promise<SocialSignalsResponse> {
  const search = new URLSearchParams()
  if (params.location?.trim()) search.set('location', params.location.trim())
  if (params.keyword?.trim()) search.set('keyword', params.keyword.trim())
  if (params.page) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))

  const query = search.toString()
  return request<SocialSignalsResponse>(query ? `?${query}` : '', token)
}

export async function fetchSocialSignalsSummary(token: string, location: string): Promise<SocialSignalsSummary> {
  return request<SocialSignalsSummary>(`/summary?location=${encodeURIComponent(location)}`, token)
}
