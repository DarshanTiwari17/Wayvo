import { Link } from 'react-router-dom'
import { Bell, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useOpenDisruptions } from '../hooks/useTravelData'
import { Banner, Button, Card, EmptyState, PageHeader, Pill, SectionTitle, SkeletonLines } from '../components/app/Primitives'

const SEVERITY_TONE = { critical: 'danger', warn: 'warn', info: 'info' } as const
const SEVERITY_LABEL = { critical: 'Critical', warn: 'Needs attention', info: 'Heads up' } as const

/**
 * Wayvo — /alerts
 *
 * Real open disruptions from the database, newest first. When nothing has been
 * reported the page says exactly that.
 */
export function AlertsPage() {
  const { user } = useAuth()
  const alerts = useOpenDisruptions(user?.id)

  const openCount = alerts.status === 'ready' ? alerts.rows.length : 0

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Delays, cancellations and missed connections across your journeys."
        actions={
          alerts.status === 'ready' && openCount > 0 ? (
            <Pill tone="danger">
              {openCount} open
            </Pill>
          ) : undefined
        }
      />

      {alerts.status === 'loading' && (
        <Card>
          <SkeletonLines rows={3} />
        </Card>
      )}

      {alerts.status === 'error' && (
        <Banner tone="danger">
          We could not load your alerts. {alerts.error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={alerts.reload}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {alerts.status === 'ready' && alerts.rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<CheckCircle2 size={22} strokeWidth={1.9} />}
            title="No active disruptions"
            description="Nothing has disrupted any of your journeys. If a delay, cancellation or missed connection turns up, it will show up here."
            action={
              <Link to="/journeys" className="wva-btn wva-btn--secondary">
                View your journeys
              </Link>
            }
          />
        </Card>
      )}

      {alerts.status === 'ready' && alerts.rows.length > 0 && (
        <Card>
          <SectionTitle>Open alerts</SectionTitle>
          <ul className="flex flex-col gap-3">
            {alerts.rows.map((alert) => (
              <li key={alert.id}>
                <article className="wva-card wva-card--interactive px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-app-text">{alert.headline}</h3>
                    <Pill tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</Pill>
                  </div>

                  {alert.detail && <p className="wva-body mt-2">{alert.detail}</p>}

                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="wva-meta">
                      {new Intl.DateTimeFormat(undefined, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(alert.reported_at))}
                    </span>
                    <span className="wva-meta capitalize">· {alert.kind.replace(/_/g, ' ')}</span>
                  </p>
                  {alert.trip_id && (
                    <Link to={`/journeys/${alert.trip_id}`} className="wva-btn wva-btn--ghost wva-btn--sm mt-3 self-start">
                      View affected journey
                    </Link>
                  )}
                </article>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {alerts.status === 'ready' && alerts.rows.length === 0 && (
        <p className="mt-6 flex items-center justify-center gap-2 text-[13px] text-app-text-subtle">
          <Bell size={14} strokeWidth={2} aria-hidden="true" />
          Nothing needs your attention right now.
        </p>
      )}
    </>
  )
}
