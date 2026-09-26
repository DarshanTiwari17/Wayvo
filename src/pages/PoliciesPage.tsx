import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, ExternalLink, LockKeyhole } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Banner, Card, EmptyState, PageHeader, Pill, SkeletonLines } from '../components/app/Primitives'
import { fetchPublicRefundPolicies, type RefundPolicy } from '../services/refundPolicyService'

const MODE_LABELS: Record<string, string> = {
  train: 'Trains',
  flight: 'Flights',
  bus: 'Buses',
  car: 'Car travel',
  ferry: 'Ferries',
  hotel: 'Hotels',
  other: 'Other transport',
}

export function PoliciesPage() {
  const { id } = useParams()
  const [policies, setPolicies] = useState<RefundPolicy[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setStatus('loading')
    void fetchPublicRefundPolicies()
      .then((rows) => {
        if (!active) return
        setPolicies(rows)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'The policy library could not be loaded.')
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [])

  if (id) {
    return <PolicyDetail policy={policies.find((policy) => policy.id === id) ?? null} status={status} error={error} />
  }

  const groups = [...new Set(policies.map((policy) => policy.transportMode))]
  const visibleGroups = groups.length > 0 ? groups : ['train', 'flight']

  return (
    <PublicPolicyLayout>
      <PageHeader
        title="Policy Library"
        description="Verified refund and compensation policies, kept separate from your private eligibility results."
      />

      <PolicyBoundaryNotice />

      {status === 'loading' && <Card><SkeletonLines rows={5} /></Card>}
      {status === 'error' && <Banner tone="danger">We could not load the policy library. {error}</Banner>}

      {status === 'ready' && (
        <div className="flex flex-col gap-8">
          {visibleGroups.map((mode) => {
            const modePolicies = policies.filter((policy) => policy.transportMode === mode)
            return (
              <section key={mode} aria-labelledby={`policy-mode-${mode}`}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="wva-eyebrow">Transport mode</p>
                    <h2 id={`policy-mode-${mode}`} className="wva-h2 mt-1">{MODE_LABELS[mode] ?? mode}</h2>
                  </div>
                  {modePolicies.length > 0 && <Pill tone="success">Verified policies</Pill>}
                </div>

                {modePolicies.length === 0 ? (
                  <Card>
                    <div className="flex items-start gap-3">
                      <LockKeyhole size={18} className="mt-0.5 shrink-0 text-app-text-subtle" aria-hidden="true" />
                      <div>
                        <h3 className="text-[14px] font-semibold text-app-text">Unsupported for now</h3>
                        <p className="wva-body mt-1">No official {MODE_LABELS[mode]?.toLowerCase() ?? mode} policy has been added to Wayvo yet.</p>
                      </div>
                    </div>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {modePolicies.map((policy) => <PolicyCard key={policy.id} policy={policy} />)}
                  </div>
                )}
              </section>
            )
          })}

          {policies.length === 0 && (
            <Card>
              <EmptyState
                icon={<BookOpen size={22} strokeWidth={1.9} />}
                title="No verified policies published yet"
                description="Wayvo will show a policy here only after its provider, source, version, and effective date have been recorded."
              />
            </Card>
          )}
        </div>
      )}
    </PublicPolicyLayout>
  )
}

function PolicyDetail({ policy, status, error }: { policy: RefundPolicy | null; status: 'loading' | 'ready' | 'error'; error: string | null }) {
  if (status === 'loading') {
    return <PublicPolicyLayout><PageHeader title="Policy" /><Card><SkeletonLines rows={7} /></Card></PublicPolicyLayout>
  }
  if (status === 'error') {
    return <PublicPolicyLayout><PageHeader title="Policy" /><Banner tone="danger">We could not load this policy. {error}</Banner></PublicPolicyLayout>
  }
  if (!policy) {
    return (
      <PublicPolicyLayout>
        <PageHeader title="Policy not found" />
        <Card><p className="wva-body">This policy is not published or is no longer active.</p></Card>
      </PublicPolicyLayout>
    )
  }

  return (
    <PublicPolicyLayout>
      <div className="mb-6">
        <Link to="/policies" className="wva-btn wva-btn--ghost wva-btn--sm">
          <ArrowLeft size={14} aria-hidden="true" /> Back to Policy Library
        </Link>
      </div>
      <PageHeader
        title={policy.name}
        description={`${policy.provider} · ${MODE_LABELS[policy.transportMode] ?? policy.transportMode}`}
        actions={<Pill tone="success">Verified policy</Pill>}
      />
      <PolicyBoundaryNotice />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <PolicySection title="General policy information">
            <p className="wva-body">{policy.summary || 'No plain-language summary has been published for this policy.'}</p>
            <DefinitionList items={[
              ['Provider/operator', policy.provider],
              ['Policy version', policy.version],
              ['Effective date', formatDate(policy.effectiveFrom)],
              ['Effective until', policy.effectiveUntil ? formatDate(policy.effectiveUntil) : 'Until further notice'],
              ['Source', policy.source],
            ]} />
          </PolicySection>
          <PolicySection title="Applicable disruption or event types">
            <StringList values={policy.applicableDisruptionTypes} empty="No event types have been published." />
          </PolicySection>
        </Card>
        <Card>
          <PolicySection title="Eligibility conditions">
            <StringList values={policy.eligibilityConditions} empty="No conditions have been published." />
          </PolicySection>
          <PolicySection title="Exclusions">
            <StringList values={policy.exclusions} empty="No exclusions have been published." />
          </PolicySection>
          <PolicySection title="Refund or compensation method">
            <p className="wva-body">{amountLabel(policy)}</p>
          </PolicySection>
          <PolicySection title="Required evidence">
            <StringList values={policy.requiredEvidence} empty="No evidence requirements have been published." />
          </PolicySection>
          <PolicySection title="Claim method and deadline">
            <p className="wva-body">{policy.claimMethod || 'No claim method has been published.'}</p>
            <p className="wva-meta mt-1">{policy.claimDeadlineDays === null || policy.claimDeadlineDays === undefined ? 'Deadline not published.' : `${policy.claimDeadlineDays} days from the qualifying event.`}</p>
          </PolicySection>
        </Card>
      </div>
    </PublicPolicyLayout>
  )
}

function PolicyCard({ policy }: { policy: RefundPolicy }) {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="wva-eyebrow">{policy.provider}</p>
          <h3 className="wva-h3 mt-1">{policy.name}</h3>
        </div>
        <Pill tone="success">{policy.version}</Pill>
      </div>
      <p className="wva-body mt-3 flex-1">{policy.summary || 'Verified provider policy. Open the record for the published details.'}</p>
      <p className="wva-meta mt-4">Effective {formatDate(policy.effectiveFrom)} · Source: {policy.source}</p>
      <Link to={`/policies/${policy.id}`} className="wva-btn wva-btn--secondary wva-btn--sm mt-4 self-start">
        View policy <ExternalLink size={14} aria-hidden="true" />
      </Link>
    </Card>
  )
}

function PolicyBoundaryNotice() {
  return (
    <div className="mb-7">
      <Banner tone="info">
        <strong className="font-semibold">General policy information.</strong> This library is not your personal eligibility result. Your journey, fare, passenger details, documents, and eligibility results are never shown here.
      </Banner>
    </div>
  )
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-b border-app-border py-5 first:pt-0 last:border-b-0 last:pb-0"><h2 className="wva-h3 mb-2">{title}</h2>{children}</section>
}

function DefinitionList({ items }: { items: [string, string][] }) {
  return <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">{items.map(([label, value]) => <div key={label}><dt className="wva-meta">{label}</dt><dd className="mt-0.5 text-[13px] text-app-text">{value}</dd></div>)}</dl>
}

function StringList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <p className="wva-body">{empty}</p>
  return <ul className="flex flex-col gap-2">{values.map((value) => <li key={value} className="wva-body flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-app-accent" aria-hidden="true" />{value}</li>)}</ul>
}

function amountLabel(policy: RefundPolicy): string {
  if (policy.amount.type === 'full_fare') return 'Full fare, when the published conditions are satisfied.'
  if (policy.amount.type === 'partial_fare') return policy.amount.percentage == null ? 'Partial fare; percentage not published.' : `${policy.amount.percentage}% of the fare.`
  if (policy.amount.type === 'fixed') return policy.amount.value == null ? 'Fixed amount; value not published.' : `${policy.amount.value} ${policy.amount.currency ?? ''}`.trim()
  if (policy.amount.type === 'calculated') return 'Calculated according to the published policy rules.'
  return 'Amount not published.'
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function PublicPolicyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-app-bg"><header className="border-b border-app-border bg-app-surface"><div className="wva-container flex items-center justify-between py-4"><Link to="/" className="wva-wordmark">Wayvo</Link><div className="flex items-center gap-3"><Link to="/login" className="wva-btn wva-btn--ghost wva-btn--sm">Log in</Link></div></div></header><main className="wva-container pb-20 pt-8 sm:pt-10">{children}</main></div>
}