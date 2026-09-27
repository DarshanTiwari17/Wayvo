/**
 * Wayvo — /digital-twin
 *
 * A what-if for the traveller's own travel. Change the weather, watch the real
 * itinerary degrade corridor by corridor, and get a concrete response.
 *
 * Three things this page is careful about:
 *
 *   1. It never invents data. The baseline is the traveller's real bookings
 *      when they have any, the real open disruptions when the query succeeds,
 *      and a clearly-labelled estimate otherwise.
 *   2. It never shows a number that contradicts another. The model enforces
 *      that internally (see `digitalTwin.ts`).
 *   3. Nothing here is decorative. Every control changes the result, and every
 *      result is derived from data the traveller owns or from a stated
 *      assumption.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, ShieldCheck, Sparkles } from 'lucide-react'
import { Banner, Button, Card, PageHeader } from '../../components/app/Primitives'
import { useAuth } from '../../hooks/useAuth'
import { useJourneys, useOpenDisruptions } from '../../hooks/useTravelData'
import { streamTravelAssistant } from '../travel-chat/travelChatService'
import { formatRoute } from '../../services/travelService'
import type { WeatherLookup } from './weatherAdapter'
import type { Trip } from '../../types/database'
import { CorridorBreakdown } from './CorridorBreakdown'
import { ImpactPanel, type CurrentState } from './ImpactPanel'
import { LiveWeatherPanel } from './LiveWeatherPanel'
import { ScenarioPanel } from './ScenarioPanel'
import { TwinOverview } from './TwinOverview'
import {
  buildScenarioSummary,
  calculateDigitalTwinSimulation,
  describeCurrentState,
  formatMinutes,
  riskLevelLabel,
  routeStatusLabel,
  type TwinScenario,
} from './digitalTwin'
import { baselineForTrip, systemBaseline, type TwinBaseline } from './twinBaseline'
import { useLiveWeather, useTripSegments, useTwinScenario } from './useDigitalTwin'

type CopyState = 'idle' | 'copied' | 'failed'

function conciseRecommendation(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*|__|[*_`#]/g, '').trim())
    .filter(Boolean)
  const preferred = lines.find((line) =>
    /^(?:recommended action|best operational decision|recommendation)\s*:/i.test(line) &&
    line.replace(/^(?:recommended action|best operational decision|recommendation)\s*:\s*/i, '').trim(),
  )
  const content = preferred ?? lines.find((line) => !/^(?:risk|delay|buffer|departure)\s*:/i.test(line)) ?? lines[0] ?? ''
  const sentence = content
    .replace(/^(?:recommended action|best operational decision|recommendation)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (sentence.match(/^(.{1,180}?[.!?])(?:\s|$)/)?.[1] ?? sentence.slice(0, 180)).trim()
}

export function DigitalTwinPage() {
  const { user } = useAuth()
  const journeys = useJourneys(user?.id)
  const openDisruptions = useOpenDisruptions(user?.id)
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [aiBrief, setAiBrief] = useState<string | null>(null)
  const [aiBriefLoading, setAiBriefLoading] = useState(false)
  const [aiBriefError, setAiBriefError] = useState<string | null>(null)

  const { scenario, patch, applyPreset, reset, isDefault, locations } = useTwinScenario(user?.id ?? 'signed-out')

  /* ---- live weather ---------------------------------------------------- */

  // The trip's origin is the only place name the app actually knows, so it is
  // the only one it can look up without asking the traveller to type. Nothing
  // is fetched until the traveller actually asks for a lookup.
  const [liveLookup, setLiveLookup] = useState<WeatherLookup | null>(null)
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [weatherRefreshKey, setWeatherRefreshKey] = useState(0)

  /* ---- the trip in scope -------------------------------------------- */

  const selectedTrip = useMemo((): Trip | null => {
    if (journeys.status !== 'ready') return null
    return journeys.rows.find((trip) => trip.id === selectedTripId) ?? null
  }, [journeys.status, journeys.rows, selectedTripId])

  const effectiveTripId = selectedTrip?.id ?? null

  // A trip that has been deleted must not leave the selector pointing at
  // nothing: fall back to the honest "no trip selected" state.
  useEffect(() => {
    if (selectedTripId && journeys.status === 'ready' && !selectedTrip) setSelectedTripId(null)
  }, [journeys.status, selectedTrip, selectedTripId])

  const segments = useTripSegments(effectiveTripId)

  /* ---- the twin ------------------------------------------------------ */

  const baseline = useMemo<TwinBaseline>(
    () => (selectedTrip ? baselineForTrip(selectedTrip, segments.rows) : systemBaseline()),
    [selectedTrip, segments.rows],
  )

  const simulation = useMemo(
    () =>
      calculateDigitalTwinSimulation({
        baselineTravelMinutes: baseline.minutes,
        scenario,
        corridors: baseline.corridors,
      }),
    [baseline, scenario],
  )

  const current = useMemo<CurrentState>(() => {
    if (openDisruptions.status !== 'ready') {
      return { disruptionCount: 0, routeStatus: 'normal', riskLevel: 'low', isKnown: false }
    }
    return { ...describeCurrentState(openDisruptions.rows), isKnown: true }
  }, [openDisruptions.status, openDisruptions.rows])

  const currentNote = useMemo(() => {
    switch (openDisruptions.status) {
      case 'error':
        return 'Your live alerts could not be loaded, so the "now" column is incomplete.'
      case 'missing':
        return 'Alerts are not set up on this project yet, so the "now" column shows no live data.'
      case 'loading':
        return 'Loading your live alerts…'
      case 'ready':
        return openDisruptions.rows.length === 0 ? 'No alerts are open on your account right now.' : null
      default:
        return null
    }
  }, [openDisruptions.status, openDisruptions.rows.length])

  const originLabel = selectedTrip?.origin?.trim() || 'Origin'
  const destinationLabel =
    selectedTrip?.destination?.trim() || simulation.corridors[simulation.corridors.length - 1]?.label || 'Destination'

  /**
   * The place a live lookup would use: the trip's origin when there is a real
   * one, otherwise whatever the traveller last asked for.
   */
  const liveQueryOrigin = selectedTrip?.origin?.trim() || null
  const liveLookupQuery = useMemo<WeatherLookup | null>(
    () => liveLookup ?? (liveQueryOrigin ? { kind: 'place', place: liveQueryOrigin } : null),
    [liveLookup, liveQueryOrigin],
  )
  const live = useLiveWeather(liveLookupQuery, liveEnabled, weatherRefreshKey)

  const retryTrips = useCallback(() => journeys.reload(), [journeys])

  const startLiveLookup = useCallback((query: WeatherLookup) => {
    setLiveLookup(query)
    setLiveEnabled(true)
  }, [])

  const refreshLiveWeather = useCallback(() => setWeatherRefreshKey((value) => value + 1), [])

  const applyLive = useCallback(
    (next: Partial<TwinScenario>) => {
      patch(next)
    },
    [patch],
  )

  /* ---- copy the scenario --------------------------------------------- */

  const clipboardAvailable = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'

  const generateAiBrief = useCallback(async () => {
    const firstAction = simulation.actions[0]
    const prompt = [
      'You are Wayvo’s travel disruption advisor.',
      `Facts: ${JSON.stringify({
        trip: selectedTrip ? formatRoute(selectedTrip) : 'System baseline',
        scenario: simulation.weatherChange,
        risk: riskLevelLabel(simulation.riskLevel),
        network: routeStatusLabel(simulation.routeStatus),
        modeledDelayMinutes: simulation.delayMinutes,
        recommendedAction: firstAction?.label ?? null,
        actionDetail: firstAction?.detail ?? null,
        liveAlerts: currentNote ?? 'No alert note',
      })}`,
      'Write exactly one practical recommendation sentence, maximum 18 words. Do not repeat the facts, state numbers, add headings, bullets, markdown, or invent an action. Output only the sentence.',
    ].join('\n')

    setAiBriefLoading(true)
    setAiBriefError(null)
    setAiBrief('')

    try {
      await streamTravelAssistant([{ role: 'user', content: prompt }], (token) => {
        setAiBrief((current) => `${current ?? ''}${token}`)
      })
    } catch (cause) {
      setAiBriefError(cause instanceof Error ? cause.message : 'The AI brief could not be generated.')
    } finally {
      setAiBriefLoading(false)
    }
  }, [baseline.label, currentNote, selectedTrip, simulation])

  async function copySummary() {
    const text = buildScenarioSummary(simulation, baseline.label)
    try {
      if (!clipboardAvailable) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2500)
    } catch {
      // Clipboard access can be blocked outright (insecure context, denied
      // permission). Report it rather than pretending the copy worked.
      setCopyState('failed')
    }
  }

  return (
    <>
      <PageHeader
        title="Digital Twin"
        description="Stress-test your real itinerary against changing weather. Move the conditions and watch every corridor, connection and delay respond."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void copySummary()} disabled={!clipboardAvailable}>
              {copyState === 'copied' ? (
                <Check size={14} strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
              )}
              {copyState === 'copied' ? 'Copied' : 'Copy scenario'}
            </Button>
            <Link to="/recovery" className="wva-btn wva-btn--ghost wva-btn--sm">
              <ShieldCheck size={14} strokeWidth={2.2} aria-hidden="true" />
              Recovery options
            </Link>
          </>
        }
      />

      {copyState === 'failed' && (
        <div className="mb-6">
          <Banner tone="warn">
            This browser blocked the clipboard, so the scenario could not be copied. Everything on this page is still
            accurate — the summary is only the text version of it.
          </Banner>
        </div>
      )}

      {openDisruptions.status === 'error' && (
        <div className="mb-6">
          <Banner tone="warn">
            Your live alerts could not be loaded, so the &ldquo;now&rdquo; side of the comparison is incomplete. The
            simulation itself is unaffected.
          </Banner>
        </div>
      )}

      <div className="mb-6">
        <div className="wva-digital-hero-card">
          <div className="wva-digital-hero-card__copy">
            <p className="wva-eyebrow">Live route stress test</p>
            <h2 className="wva-h2 mt-2">Weather is changing the trip before it starts.</h2>
            <p className="wva-body mt-3 max-w-xl">
              Adjust rain, duration and temperature to see the digital twin recalculate disruption, delay, route safety,
              and recovery guidance in real time.
            </p>
          </div>

          <div className="wva-digital-hero-card__media" aria-label="Animated traveller moving with luggage">
            <img
              src="/images/digital-twin-traveller.gif"
              alt="Animated traveller traversing a route"
              className="wva-digital-hero-card__gif"
            />
          </div>
        </div>
      </div>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="wva-eyebrow">AI route brief</p>
            <h2 className="wva-h2 mt-1">Route outlook</h2>
          </div>
          <Button
            variant="secondary"
            size="sm"
            pending={aiBriefLoading}
            pendingLabel="Generating"
            onClick={() => {
              void generateAiBrief()
            }}
          >
            <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" />
            {aiBrief ? 'Refresh brief' : 'Generate brief'}
          </Button>
        </div>

        <div className="wva-digital-ai-brief__facts" aria-label="Simulation summary">
          <div><span>Risk</span><strong>{riskLevelLabel(simulation.riskLevel)}</strong></div>
          <div><span>Network</span><strong>{routeStatusLabel(simulation.routeStatus)}</strong></div>
          <div><span>Added delay</span><strong>{formatMinutes(simulation.delayMinutes)}</strong></div>
        </div>

        {aiBriefError ? (
          <div className="wva-banner wva-banner--warn mt-4" role="alert">
            <ShieldCheck size={16} strokeWidth={2.2} aria-hidden="true" />
            <div className="min-w-0">{aiBriefError}</div>
          </div>
        ) : aiBrief !== null ? (
          <div className="wva-digital-ai-brief__recommendation" aria-live="polite">
            <div className="wva-digital-ai-brief__sparkle" aria-hidden="true"><Sparkles size={16} /></div>
            <div className="min-w-0">
              <p className="wva-eyebrow">Recommended next step</p>
              <p className="wva-digital-ai-brief__text">
                {conciseRecommendation(aiBrief) || (aiBriefLoading ? 'Preparing recommendation…' : 'No recommendation available.')}
                {aiBriefLoading && <span className="wva-digital-ai-brief__cursor" aria-hidden="true" />}
              </p>
            </div>
          </div>
        ) : <p className="wva-body mt-4">Generate one concise recommendation based on this simulation.</p>}
      </Card>

      {/* ---- controls + twin state ------------------------------------- */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card>
          <div className="mb-5">
            <p className="wva-eyebrow">Scenario controls</p>
            <h2 className="wva-h2 mt-1">What-if simulation</h2>
          </div>

          <ScenarioPanel
            scenario={scenario}
            onPatch={patch}
            onPreset={applyPreset}
            onReset={reset}
            isDefault={isDefault}
            locations={locations}
            trips={journeys.status === 'ready' ? journeys.rows : []}
            tripsStatus={journeys.status}
            tripsError={journeys.error}
            onRetryTrips={retryTrips}
            selectedTripId={effectiveTripId}
            onSelectTrip={setSelectedTripId}
            baseline={baseline}
            segments={segments}
          />
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <LiveWeatherPanel
              live={live}
              query={liveQueryOrigin}
              canAutoQuery={Boolean(selectedTrip?.origin?.trim())}
              onQuery={startLiveLookup}
              onApply={applyLive}
              onRefresh={refreshLiveWeather}
            />
          </Card>

          <Card>
            <TwinOverview
              simulation={simulation}
              scopeLabel={baseline.label}
              originLabel={originLabel}
              destinationLabel={destinationLabel}
            />
            {/* One concise announcement for screen readers rather than a live
                region around the whole panel, which would read every number on
                every slider tick. */}
            <p className="sr-only" role="status" aria-live="polite">
              {`${simulation.weatherChange}. Travel time ${formatMinutes(simulation.baselineTravelMinutes)} becomes ${formatMinutes(
                simulation.simulatedTravelMinutes,
              )}. ${routeStatusLabel(simulation.routeStatus)} network, risk ${riskLevelLabel(simulation.riskLevel)}, resilience ${simulation.resilienceScore} of 100.`}
            </p>
          </Card>
        </div>
      </div>

      {/* ---- before / after + cause and effect -------------------------- */}
      <Card className="mb-6">
        <ImpactPanel simulation={simulation} current={current} currentNote={currentNote} />
      </Card>

      {/* ---- corridors --------------------------------------------------- */}
      <Card className="mb-6">
        <CorridorBreakdown simulation={simulation} />
      </Card>

    </>
  )
}
