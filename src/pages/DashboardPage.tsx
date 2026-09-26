import { useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bell, Map, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useJourneys, useOpenDisruptions, useRecoveryPlans } from '../hooks/useTravelData'
import { formatDateRange, formatRoute, isJourneyPast } from '../services/travelService'
import { Banner, Button, Card, EmptyState, PageHeader, Pill, SectionTitle, SkeletonLines } from '../components/app/Primitives'

/**
 * Wayvo — /dashboard
 *
 * The first authenticated screen. Answers two questions and nothing else:
 *   "What is Wayvo?" and "What do I do next?"
 *
 * Every number here is a real count from the database. No identifiers,
 * timestamps, table names or infrastructure state are shown.
 */
export function DashboardPage() {
  const { user, profile, isEmailConfirmed } = useAuth()
  const journeys = useJourneys(user?.id)
  const alerts = useOpenDisruptions(user?.id)
  const plans = useRecoveryPlans(user?.id)

  const displayName = profile?.full_name?.trim() || user?.email?.split('@')[0] || 'there'
  const firstName = displayName.split(/\s+/)[0] ?? displayName

  const reloadAll = useCallback(() => {
    journeys.reload()
    alerts.reload()
    plans.reload()
  }, [journeys, alerts, plans])

  const upcoming = useMemo(
    () => journeys.rows.filter((trip) => !isJourneyPast(trip)).slice(0, 3),
    [journeys.rows],
  )

  const openAlertCount = alerts.status === 'ready' ? alerts.rows.length : 0
  const activePlanCount = plans.status === 'ready' ? plans.rows.filter((p) => p.status === 'proposed').length : 0
  const journeyCount = journeys.status === 'ready' ? journeys.rows.length : 0

  return (
    <>
      <PageHeader
        title={
          <>
            Good {greeting()}, {firstName}.
          </>
        }
        description="Your travel recovery assistant is ready. Plan a journey, and Wayvo will help you recover when plans change."
      />

      {!isEmailConfirmed && (
        <div className="mb-6">
          <Banner tone="warn">
            <strong className="font-semibold">Confirm your email address.</strong> Some account and recovery
            notifications may not reach you until you do. Check your inbox for the Wayvo verification link.
          </Banner>
        </div>
      )}

      {/* --- What Wayvo is ------------------------------------------------ */}
      <Card className="mb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="wva-eyebrow">Welcome to Wayvo</p>
            <h2 className="wva-h1 mt-2">Plan your journey. Stay prepared when things change.</h2>
            <p className="wva-body mt-2 max-w-xl">
              Add a journey and Wayvo keeps an eye on it. When a delay, cancellation or missed connection turns up,
              you get a clear picture of the options and a plan to get back on track.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:w-48">
            <Link to="/journeys?new=1" className="wva-btn wva-btn--primary w-full">
              Plan a Journey
              <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link to="/profile" className="wva-btn wva-btn--secondary w-full">
              Explore Wayvo
            </Link>
          </div>
        </div>
      </Card>

      {/* --- At a glance --------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Map size={16} strokeWidth={2} aria-hidden="true" />}
          label="Journeys"
          value={journeys.status === 'ready' ? String(journeyCount) : '—'}
          to="/journeys"
        />
        <StatCard
          icon={<Bell size={16} strokeWidth={2} aria-hidden="true" />}
          label="Active alerts"
          value={alerts.status === 'ready' ? String(openAlertCount) : '—'}
          tone={openAlertCount > 0 ? 'danger' : 'neutral'}
          to="/alerts"
        />
        <StatCard
          icon={<ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />}
          label="Recovery options"
          value={plans.status === 'ready' ? String(activePlanCount) : '—'}
          to="/recovery"
        />
      </div>

      {/* --- Journeys ----------------------------------------------------- */}
      <Card>
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionTitle>Your journeys</SectionTitle>
          {journeys.status === 'ready' && journeyCount > 0 && (
            <Link to="/journeys" className="wva-btn wva-btn--ghost wva-btn--sm shrink-0">
              View all
            </Link>
          )}
        </div>

        {journeys.status === 'loading' && <SkeletonLines rows={3} />}

        {journeys.status === 'error' && (
          <Banner tone="danger">
            We could not load your journeys. {journeys.error}
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={reloadAll}>
                Try again
              </Button>
            </div>
          </Banner>
        )}

        {journeys.status === 'ready' && journeyCount === 0 && (
          <EmptyState
            icon={<Map size={22} strokeWidth={1.9} />}
            title="No journeys yet"
            description="Add your upcoming journey so Wayvo can watch for disruptions and help you recover when plans change."
            action={
              <Link to="/journeys?new=1" className="wva-btn wva-btn--primary">
                Add your first journey
              </Link>
            }
          />
        )}

        {journeys.status === 'ready' && journeyCount > 0 && (
          <ul className="flex flex-col gap-3">
            {upcoming.map((trip) => (
              <li key={trip.id}>
                <Link
                  to={`/journeys?open=${trip.id}`}
                  className="wva-card wva-card--interactive flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-app-text">{trip.title}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-app-text-muted">
                      {formatRoute(trip)} · {formatDateRange(trip.starts_on, trip.ends_on)}
                    </span>
                  </span>
                  <Pill tone={trip.status === 'active' ? 'info' : 'neutral'}>
                    {trip.status === 'active' ? 'Travelling' : trip.status === 'booked' ? 'Booked' : 'Planning'}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- First-run hint ------------------------------------------------ */}
      {journeys.status === 'ready' && journeyCount === 0 && (
        <Card className="mt-6">
          <div className="flex items-start gap-4">
            <span className="wva-empty__icon mb-0 shrink-0" aria-hidden="true">
              <Sparkles size={20} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h3 className="wva-h3">What happens next</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {[
                  'Add a journey with where you are going and when.',
                  'Wayvo watches it for delays, cancellations and missed connections.',
                  'When something breaks, you get recovery options you can compare and act on.',
                ].map((line) => (
                  <li key={line} className="wva-body flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-app-text-subtle" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function StatCard({
  icon,
  label,
  value,
  to,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  value: string
  to: string
  tone?: 'neutral' | 'danger'
}) {
  return (
    <Link to={to} className="wva-card wva-card--interactive flex items-center gap-4 px-4 py-4">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{
          background: tone === 'danger' ? 'var(--color-app-danger-soft)' : 'var(--color-app-accent-soft)',
          color: tone === 'danger' ? 'var(--color-app-danger)' : 'var(--color-app-accent)',
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold leading-tight tracking-tight text-app-text">{value}</span>
        <span className="block text-[12px] text-app-text-muted">{label}</span>
      </span>
    </Link>
  )
}

function greeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
