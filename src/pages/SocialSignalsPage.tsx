import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudRain, ExternalLink, MapPin, Newspaper, RefreshCw, Search, TrendingUp, TriangleAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { fetchSocialSignals, SocialSignalsError, type EventType, type Sentiment, type Severity, type SocialSignal } from '../services/socialSignalsService'
import { Banner, Button, Card, EmptyState, PageHeader, Pill, SkeletonLines } from '../components/app/Primitives'
import { SocialSignalsMap } from '../components/social-signals/SocialSignalsMap'

const EVENT_FILTERS: Array<{ value: EventType | 'All'; label: string }> = [
  { value: 'All', label: 'All Events' },
  { value: 'Flood', label: 'Flood' },
  { value: 'Heavy Rain', label: 'Heavy Rain' },
  { value: 'Cyclone', label: 'Cyclone' },
  { value: 'Storm', label: 'Storm' },
  { value: 'Landslide', label: 'Landslide' },
  { value: 'Road Closure', label: 'Road Closure' },
  { value: 'Weather Emergency', label: 'Weather Emergency' },
]

const SEVERITY_TONE: Record<Severity, 'danger' | 'warn' | 'neutral'> = {
  High: 'danger',
  Medium: 'warn',
  Low: 'neutral',
}

const SENTIMENT_TONE: Record<Sentiment, 'danger' | 'warn' | 'neutral' | 'info'> = {
  Alert: 'danger',
  Negative: 'warn',
  Neutral: 'neutral',
  Positive: 'info',
}

const AUTO_REFRESH_MS = 5 * 60 * 1000 // 5 minutes

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Wayvo — /social-signals
 *
 * Real-world social signals from public news via the GNews API.
 * Shows weather events, travel disruptions, and other reported incidents
 * for a selected location.
 */
export function SocialSignalsPage() {
  const { session } = useAuth()
  const token = session?.access_token ?? ''

  const [location, setLocation] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [eventFilter, setEventFilter] = useState<EventType | 'All'>('All')
  const [state, setState] = useState<LoadState>('idle')
  const [articles, setArticles] = useState<SocialSignal[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSignals = useCallback(
    async (loc: string, filter: EventType | 'All') => {
      if (!token || !loc.trim()) return
      setState('loading')
      setError(null)
      try {
        const keyword = filter === 'All' ? '' : filter
        const result = await fetchSocialSignals(token, { location: loc, keyword, limit: 20 })
        setArticles(result.articles)
        setTotal(result.total)
        setState('ready')
        setLastUpdated(new Date())
      } catch (err) {
        setState('error')
        setError(
          err instanceof SocialSignalsError
            ? err.message
            : 'Could not load social signals. Please try again.',
        )
      }
    },
    [token],
  )

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (state === 'ready' && location.trim()) {
      refreshTimer.current = setInterval(() => {
        void loadSignals(location, eventFilter)
      }, AUTO_REFRESH_MS)
      return () => {
        if (refreshTimer.current) clearInterval(refreshTimer.current)
      }
    }
  }, [state, location, eventFilter, loadSignals])

  function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = searchInput.trim()
    if (!trimmed) return
    setLocation(trimmed)
    void loadSignals(trimmed, eventFilter)
  }

  function handleFilterChange(value: EventType | 'All') {
    setEventFilter(value)
    if (location.trim()) {
      void loadSignals(location, value)
    }
  }

  function handleRefresh() {
    if (location.trim()) {
      void loadSignals(location, eventFilter)
    }
  }

  // Statistics
  const highSeverityCount = articles.filter((a) => a.severity === 'High').length
  const floodCount = articles.filter((a) => a.event_type === 'Flood').length
  const weatherAlertCount = articles.filter(
    (a) => a.event_type === 'Weather Emergency' || a.sentiment === 'Alert',
  ).length

  return (
    <>
      <PageHeader
        title="Social Signals"
        description="Real-world reports of weather events, travel disruptions, and emergencies from public news sources."
        actions={
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={state === 'loading' || !location.trim()}>
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
            Refresh Signals
          </Button>
        }
      />

      {/* Search + Filter */}
      <Card className="mb-6">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="ss-location" className="wva-label">
              Location
            </label>
            <div className="relative">
              <Search size={15} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-text-subtle" aria-hidden="true" />
              <input
                id="ss-location"
                type="text"
                className="wva-input pl-9"
                placeholder="Mumbai, Pune, Delhi..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
          <div className="sm:w-48">
            <label htmlFor="ss-filter" className="wva-label">
              Event Type
            </label>
            <select
              id="ss-filter"
              className="wva-select"
              value={eventFilter}
              onChange={(e) => handleFilterChange(e.target.value as EventType | 'All')}
            >
              {EVENT_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={state === 'loading' || !searchInput.trim()}>
            <Search size={14} strokeWidth={2} aria-hidden="true" />
            Search
          </Button>
        </form>
      </Card>

      {/* Statistics */}
      {state === 'ready' && articles.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<Newspaper size={18} />} label="Total Signals" value={total} />
          <StatCard icon={<TriangleAlert size={18} />} label="High Severity" value={highSeverityCount} tone="danger" />
          <StatCard icon={<CloudRain size={18} />} label="Flood Reports" value={floodCount} tone="info" />
          <StatCard icon={<TrendingUp size={18} />} label="Weather Alerts" value={weatherAlertCount} tone="warn" />
        </div>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <Card>
          <SkeletonLines rows={4} />
        </Card>
      )}

      {/* Error */}
      {state === 'error' && (
        <Banner tone="danger">
          {error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={handleRefresh}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {/* Empty */}
      {state === 'ready' && articles.length === 0 && (
        <Card>
          <EmptyState
            icon={<CloudRain size={22} strokeWidth={1.9} />}
            title="No signals found"
            description={`No public reports found for ${location || 'this location'}. Try a different location or event filter.`}
            action={
              <Button variant="secondary" size="sm" onClick={handleRefresh}>
                Search again
              </Button>
            }
          />
        </Card>
      )}

      {/* Results */}
      {state === 'ready' && articles.length > 0 && (
        <>
          {/* Map */}
          <div className="mb-6">
            <SocialSignalsMap articles={articles} location={location} />
          </div>

          {/* Signal Cards */}
          <div className="flex flex-col gap-3">
            {articles.map((article, index) => (
              <SignalCard key={`${article.url}-${index}`} article={article} />
            ))}
          </div>

          {lastUpdated && (
            <p className="mt-4 text-center text-[12px] text-app-text-subtle">
              Last updated {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 5 minutes
            </p>
          )}
        </>
      )}

      {/* Initial state — no search yet */}
      {state === 'idle' && (
        <Card>
          <EmptyState
            icon={<MapPin size={22} strokeWidth={1.9} />}
            title="Search for social signals"
            description="Enter a location above to see real-world reports of weather events, travel disruptions, and emergencies in that area."
          />
        </Card>
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------
 * Signal Card
 * ------------------------------------------------------------------------- */

function SignalCard({ article }: { article: SocialSignal }) {
  const publishedLabel = article.published_at
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(article.published_at))
    : 'Unknown date'

  return (
    <article className="wva-card wva-card--interactive px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={SEVERITY_TONE[article.severity]}>{article.severity}</Pill>
            <Pill tone="info">{article.event_type}</Pill>
            <Pill tone={SENTIMENT_TONE[article.sentiment]}>{article.sentiment}</Pill>
          </div>
          <h3 className="mt-2 text-[14px] font-semibold text-app-text">{article.title}</h3>
        </div>
      </div>

      {article.description && <p className="wva-body mt-2 line-clamp-3">{article.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="wva-meta">{article.source}</span>
        <span className="wva-meta">· {publishedLabel}</span>
        {article.location && <span className="wva-meta">· {article.location}</span>}
      </div>

      {article.url && (
        <div className="mt-3">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="wva-btn wva-btn--secondary wva-btn--sm"
          >
            <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
            Read Source
          </a>
        </div>
      )}
    </article>
  )
}

/* ---------------------------------------------------------------------------
 * Stat Card
 * ------------------------------------------------------------------------- */

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: 'danger' | 'info' | 'warn' }) {
  const toneClass =
    tone === 'danger'
      ? 'text-app-danger'
      : tone === 'info'
        ? 'text-app-info'
        : tone === 'warn'
          ? 'text-app-warn'
          : 'text-app-text'

  return (
    <div className="wva-card px-4 py-3">
      <div className={`flex items-center gap-2 ${toneClass}`}>
        {icon}
        <span className="text-[22px] font-bold leading-none">{value}</span>
      </div>
      <p className="mt-1 text-[12px] text-app-text-muted">{label}</p>
    </div>
  )
}
