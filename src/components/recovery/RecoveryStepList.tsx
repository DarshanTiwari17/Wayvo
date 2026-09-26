import type { RecoveryNavigationStep, RecoveryStepStatus } from '../../types/recoveryNavigation'
import { RecoveryStepCard } from './RecoveryStepCard'

type RecoveryStepListProps = {
  steps: RecoveryNavigationStep[]
  currentStep: number
  completedSteps: number[]
  onStart?: () => void
  heading?: string
}

export function RecoveryStepList({ steps, currentStep, completedSteps, onStart, heading = 'Your recovery route' }: RecoveryStepListProps) {
  function statusFor(index: number): RecoveryStepStatus {
    if (completedSteps.includes(index)) return 'completed'
    if (index === currentStep) return 'current'
    return 'locked'
  }

  return (
    <section aria-labelledby="recovery-steps-heading">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Route steps</p>
          <h2 id="recovery-steps-heading" className="wva-h2 mt-1">{heading}</h2>
        </div>
        <span className="wva-meta">Demo route</span>
      </div>
      <div className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <RecoveryStepCard key={step.id} step={step} status={statusFor(index)} onStart={index === currentStep ? onStart : undefined} compact={index !== currentStep} />
        ))}
      </div>
    </section>
  )
}