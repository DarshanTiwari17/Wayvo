import { Check } from 'lucide-react'

type RecoveryProgressProps = {
  currentStep: number
  totalSteps: number
  completedSteps: number
}

export function RecoveryProgress({ currentStep, totalSteps, completedSteps }: RecoveryProgressProps) {
  const percentage = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100)

  return (
    <section className="wva-card wva-card--pad" aria-label="Recovery progress">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="wva-eyebrow">Progress</p>
          <p className="mt-1 text-[18px] font-semibold text-app-text">
            Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-app-accent">
          <Check size={15} aria-hidden="true" /> {completedSteps} of {totalSteps} steps completed
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-app-surface-alt" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-label={`${percentage}% complete`}>
        <div className="h-full rounded-full bg-app-accent transition-[width] duration-300" style={{ width: `${percentage}%` }} />
      </div>
      <p className="wva-meta mt-2 text-right">{percentage}% complete</p>
    </section>
  )
}