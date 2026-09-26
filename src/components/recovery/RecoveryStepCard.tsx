import { Car, Check, Footprints, Plane, TrainFront } from 'lucide-react'
import type { RecoveryNavigationStep, RecoveryStepStatus } from '../../types/recoveryNavigation'
import { Button, Pill } from '../app/Primitives'

const MODE_ICONS = { walk: Footprints, drive: Car, transit: TrainFront, flight: Plane }
const STATUS_LABELS: Record<RecoveryStepStatus, string> = { locked: 'Locked', current: 'Current', completed: 'Completed' }

function formatDistance(meters?: number) {
  if (meters === undefined) return 'Distance unavailable'
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`
}

type RecoveryStepCardProps = {
  step: RecoveryNavigationStep
  status: RecoveryStepStatus
  onStart?: () => void
  compact?: boolean
}

export function RecoveryStepCard({ step, status, onStart, compact = false }: RecoveryStepCardProps) {
  const Icon = MODE_ICONS[step.mode]
  return (
    <article className={`wva-card ${status === 'current' ? 'border-app-accent shadow-sm' : ''} ${compact ? 'px-4 py-3' : 'wva-card--pad'}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${status === 'completed' ? 'bg-app-accent-soft text-app-accent' : status === 'current' ? 'bg-app-accent text-white' : 'bg-app-surface-alt text-app-text-subtle'}`} aria-hidden="true">
          {status === 'completed' ? <Check size={17} /> : <Icon size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="wva-eyebrow">Step {step.stepNumber}</p>
              <h3 className="mt-1 text-[15px] font-semibold text-app-text">{step.title}</h3>
            </div>
            <Pill tone={status === 'completed' ? 'success' : status === 'current' ? 'info' : 'neutral'}>{STATUS_LABELS[status]}</Pill>
          </div>
          <p className="wva-meta mt-2">{step.from} <span aria-hidden="true">→</span> {step.to}</p>
          <p className="wva-body mt-2">{step.description}</p>
          <p className="wva-meta mt-3">{formatDistance(step.distanceMeters)} · {step.durationMinutes ?? '—'} min</p>
          {onStart && status === 'current' && <Button className="mt-4" size="sm" onClick={onStart}>Start Navigation</Button>}
        </div>
      </div>
    </article>
  )
}