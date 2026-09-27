/**
 * GNews API integration for social signal detection.
 *
 * Reads GNEWS_API_KEY from the environment. Never exposes the key in responses.
 * Implements rule-based event classification, severity scoring, and sentiment
 * detection. Designed so an AI/ML model can later replace the classifier.
 */

const GNEWS_BASE_URL = 'https://gnews.io/api/v4'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ARTICLES = 30

/* ---------------------------------------------------------------------------
 * In-memory cache (no Redis in this project; swap for Redis later if needed)
 * ------------------------------------------------------------------------- */

const cache = new Map()

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

/* ---------------------------------------------------------------------------
 * Event classification — rule-based, modular, replaceable by ML later
 * ------------------------------------------------------------------------- */

const EVENT_RULES = [
  { type: 'Flood', patterns: ['flood', 'flooding', 'waterlogging', 'water logging', 'flash flood'] },
  { type: 'Heavy Rain', patterns: ['heavy rain', 'rainfall', 'torrential rain', 'downpour', 'rains'] },
  { type: 'Cyclone', patterns: ['cyclone', 'hurricane', 'typhoon'] },
  { type: 'Storm', patterns: ['storm', 'thunderstorm', 'squall', 'gale'] },
  { type: 'Landslide', patterns: ['landslide', 'mudslide', 'rockslide', 'land slip'] },
  { type: 'Road Closure', patterns: ['road closed', 'road blocked', 'road closure', 'blocked road', 'road shut'] },
  { type: 'Weather Emergency', patterns: ['weather emergency', 'weather alert', 'weather warning', 'extreme weather', 'heat wave', 'cold wave'] },
  { type: 'Travel Disruption', patterns: ['travel disruption', 'train cancelled', 'flight cancelled', 'flight delayed', 'train delayed', 'transport strike', 'traffic jam', 'traffic snarl'] },
]

const SEVERITY_KEYWORDS = {
  high: ['evacuation', 'deaths', 'death', 'stranded', 'major flooding', 'emergency', 'severe', 'blocked roads', 'fatalities', 'killed', 'missing', 'rescue', 'disaster', 'catastrophe', 'extreme'],
  medium: ['warning', 'alert', 'disruption', 'delayed', 'cancelled', 'closed', 'affected', 'displaced', 'damage', 'disruption'],
  low: ['advisory', 'watch', 'minor', 'expected', 'forecast', 'likely', 'possible'],
}

const SENTIMENT_KEYWORDS = {
  Alert: ['emergency', 'warning', 'alert', 'evacuate', 'evacuation', 'danger', 'urgent', 'immediate', 'life-threatening'],
  Negative: ['death', 'deaths', 'killed', 'fatalities', 'destroyed', 'damaged', 'stranded', 'cancelled', 'delayed', 'disrupted', 'flooded', 'collapsed', 'trapped', 'missing', 'injured', 'crisis', 'disaster', 'chaos', 'devastating'],
  Positive: ['recovered', 'restored', 'reopened', 'rescued', 'relief', 'repaired', 'cleared', 'normal', 'returned', 'safe', 'back to normal'],
}

/**
 * Classify an article into an event type based on its text.
 * Returns the first matching rule, or null if no rule matches.
 */
export function classifyEvent(title, description) {
  const text = `${title} ${description}`.toLowerCase()
  for (const rule of EVENT_RULES) {
    if (rule.patterns.some((p) => text.includes(p))) {
      return rule.type
    }
  }
  return null
}

/**
 * Calculate severity based on keyword density in the article text.
 * Returns 'High', 'Medium', or 'Low'.
 */
export function calculateSeverity(title, description) {
  const text = `${title} ${description}`.toLowerCase()
  let highScore = 0
  let mediumScore = 0
  let lowScore = 0

  for (const keyword of SEVERITY_KEYWORDS.high) {
    if (text.includes(keyword)) highScore++
  }
  for (const keyword of SEVERITY_KEYWORDS.medium) {
    if (text.includes(keyword)) mediumScore++
  }
  for (const keyword of SEVERITY_KEYWORDS.low) {
    if (text.includes(keyword)) lowScore++
  }

  if (highScore >= 2 || (highScore >= 1 && mediumScore >= 1)) return 'High'
  if (highScore >= 1 || mediumScore >= 2) return 'Medium'
  if (mediumScore >= 1 || lowScore >= 1) return 'Low'
  return 'Low'
}

/**
 * Lightweight sentiment/reaction classification for article text.
 * Returns 'Alert', 'Negative', 'Neutral', or 'Positive'.
 *
 * NOTE: This is an aggregated public signal, not a representation of the
 * entire population's sentiment.
 */
export function classifySentiment(title, description) {
  const text = `${title} ${description}`.toLowerCase()
  const scores = { Alert: 0, Negative: 0, Positive: 0 }

  for (const keyword of SENTIMENT_KEYWORDS.Alert) {
    if (text.includes(keyword)) scores.Alert++
  }
  for (const keyword of SENTIMENT_KEYWORDS.Negative) {
    if (text.includes(keyword)) scores.Negative++
  }
  for (const keyword of SENTIMENT_KEYWORDS.Positive) {
    if (text.includes(keyword)) scores.Positive++
  }

  if (scores.Alert > 0) return 'Alert'
  if (scores.Negative > scores.Positive && scores.Negative > 0) return 'Negative'
  if (scores.Positive > scores.Negative && scores.Positive > 0) return 'Positive'
  return 'Neutral'
}

/* ---------------------------------------------------------------------------
 * GNews API client
 * ------------------------------------------------------------------------- */

/**
 * Build the GNews search query by combining location and keyword.
 */
function buildSearchQuery(location, keyword) {
  const parts = []
  if (location?.trim()) parts.push(location.trim())
  if (keyword?.trim()) parts.push(keyword.trim())
  return parts.join(' ') || 'weather disruption'
}

/**
 * Fetch articles from the GNews API.
 * Throws on timeout, rate-limit, or API errors.
 */
async function fetchFromGNews(apiKey, query, page, limit) {
  const params = new URLSearchParams({
    apikey: apiKey,
    q: query,
    lang: 'en',
    page: String(page),
    max: String(Math.min(limit, MAX_ARTICLES)),
  })

  const url = `${GNEWS_BASE_URL}/search?${params}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('GNews API request timed out.'), { statusCode: 504 })
    }
    throw Object.assign(new Error('Could not reach the GNews API.'), { statusCode: 502 })
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 429) {
    throw Object.assign(new Error('GNews API rate limit exceeded. Please try again later.'), { statusCode: 429 })
  }
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error('GNews API authentication failed.'), { statusCode: 502 })
  }
  if (!response.ok) {
    throw Object.assign(new Error(`GNews API returned status ${response.status}.`), { statusCode: 502 })
  }

  const payload = await response.json()
  return payload
}

/* ---------------------------------------------------------------------------
 * Normalization
 * ------------------------------------------------------------------------- */

/**
 * Normalize a raw GNews article into the social-signal shape.
 */
function normalizeArticle(raw, location) {
  const title = raw.title || 'Untitled'
  const description = raw.description || ''
  const eventType = classifyEvent(title, description)
  const severity = calculateSeverity(title, description)
  const sentiment = classifySentiment(title, description)

  return {
    title,
    description,
    url: raw.url || '',
    source: raw.source?.name || 'Unknown',
    published_at: raw.publishedAt || '',
    image: raw.image || '',
    location: location || '',
    event_type: eventType || 'Weather Emergency',
    severity,
    sentiment,
  }
}

/* ---------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

/**
 * Fetch and normalize social signals from GNews.
 *
 * @param {object} options
 * @param {string} options.location  - e.g. "Mumbai"
 * @param {string} [options.keyword]  - e.g. "flood"
 * @param {number} [options.page=1]
 * @param {number} [options.limit=10]
 * @returns {Promise<{articles: Array, total: number, location: string}>}
 */
export async function fetchSocialSignals({ location, keyword, page = 1, limit = 10 }) {
  const apiKey = process.env.GNEWS_API_KEY
  if (!apiKey) {
    throw Object.assign(new Error('GNEWS_API_KEY is missing from the backend environment.'), { statusCode: 500 })
  }

  const cacheKey = `${location}|${keyword}|${page}|${limit}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const query = buildSearchQuery(location, keyword)
  const payload = await fetchFromGNews(apiKey, query, page, limit)

  const rawArticles = payload.articles || []
  const articles = rawArticles.map((raw) => normalizeArticle(raw, location))

  const result = {
    articles,
    total: payload.totalArticles ?? articles.length,
    location: location || '',
  }

  cacheSet(cacheKey, result)
  return result
}

/**
 * Fetch a summary of social signals for AI/prediction system consumption.
 *
 * @param {object} options
 * @param {string} options.location
 * @returns {Promise<object>}
 */
export async function fetchSocialSignalsSummary({ location }) {
  const apiKey = process.env.GNEWS_API_KEY
  if (!apiKey) {
    throw Object.assign(new Error('GNEWS_API_KEY is missing from the backend environment.'), { statusCode: 500 })
  }

  const cacheKey = `summary|${location}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  // Fetch across multiple event types to build a comprehensive summary
  const keywords = ['flood', 'heavy rain', 'cyclone', 'storm', 'landslide', 'road closed', 'weather emergency', 'travel disruption']
  const allArticles = []

  for (const keyword of keywords) {
    try {
      const query = buildSearchQuery(location, keyword)
      const payload = await fetchFromGNews(apiKey, query, 1, 5)
      const rawArticles = payload.articles || []
      for (const raw of rawArticles) {
        const normalized = normalizeArticle(raw, location)
        // Deduplicate by URL
        if (!allArticles.some((a) => a.url === normalized.url)) {
          allArticles.push(normalized)
        }
      }
    } catch {
      // Skip failed keyword searches; partial results are still useful
      continue
    }
  }

  const activeEvents = [...new Set(allArticles.map((a) => a.event_type))]
  const highSeverityCount = allArticles.filter((a) => a.severity === 'High').length

  // Determine dominant event type by frequency
  const eventCounts = {}
  for (const article of allArticles) {
    eventCounts[article.event_type] = (eventCounts[article.event_type] || 0) + 1
  }
  const dominantEvent = Object.entries(eventCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  const result = {
    location: location || '',
    active_events: activeEvents,
    high_severity_count: highSeverityCount,
    dominant_event: dominantEvent,
    recent_signals: allArticles.slice(0, 10),
  }

  cacheSet(cacheKey, result)
  return result
}
