import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useRecoveryPlans } from '../hooks/useTravelData'
import type { RecoveryPlanStatus } from '../types/database'
import { Banner, Button, Card, EmptyState, PageHeader, Pill, SectionTitle, SkeletonLines } from '../components/app/Primitives'

const PLAN_TONE: Record<RecoveryPlanStatus, 'info' | 'success' | 'neutral'> = {
  proposed: 'info',
  accepted: 'success',
  dismissed: 'neutral',
}
const PLAN_LABEL: Record<RecoveryPlanStatus, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
}

/**
 * Wayvo — /recovery
 *
 * Real recovery plans from the database. Detailed tooling — the disruption war
 * room, what-if simulation, alternatives — is reached from here per journey
 * rather than crowding the top-level navigation.
 */
export function RecoveryPage() {
  const { user } = useAuth()
  const plans = useRecoveryPlans(user?.id)

  const proposed = plans.status === 'ready' ? plans.rows.filter((p) => p.status === 'proposed').length : 0

  return (
    <>
      <PageHeader
        title="Recovery"
        description="Options to get your journey back on track."
        actions={
          plans.status === 'ready' && proposed > 0 ? (
            <Pill tone="info">
              {proposed} to review
            </Pill>
          ) : undefined
        }
      />

      {plans.status === 'loading' && (
        <Card>
          <SkeletonLines rows={3} />
        </Card>
      )}

      {plans.status === 'error' && (
        <Banner tone="danger">
          We could not load your recovery options. {plans.error}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={plans.reload}>
              Try again
            </Button>
          </div>
        </Banner>
      )}

      {plans.status === 'ready' && plans.rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<ShieldCheck size={22} strokeWidth={1.9} />}
            title="No recovery plans yet"
            description="When something disrupts one of your journeys, Wayvo will put recovery options here so you can compare them and decide what to do."
            action={
              <Link to="/journeys" className="wva-btn wva-btn--secondary">
                View your journeys
              </Link>
            }
          />
        </Card>
      )}

      {plans.status === 'ready' && plans.rows.length > 0 && (
        <Card>
          <SectionTitle>Recovery options</SectionTitle>
          <ul className="flex flex-col gap-3">
            {plans.rows.map((plan) => (
              <li key={plan.id}>
                <article className="wva-card wva-card--interactive px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-app-text">{plan.title}</h3>
                    <Pill tone={PLAN_TONE[plan.status]}>{PLAN_LABEL[plan.status]}</Pill>
                  </div>

                  {plan.summary && <p className="wva-body mt-2">{plan.summary}</p>}

                  {plan.total_cost !== null && (
                    <p className="wva-meta mt-3">
                      Estimated extra cost{' '}
                      {new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: plan.currency || 'USD',
                        maximumFractionDigits: 0,
                      }).format(plan.total_cost)}
                    </p>
                  )}
                </article>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
