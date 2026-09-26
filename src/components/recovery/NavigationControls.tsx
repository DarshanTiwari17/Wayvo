import { ArrowLeft, ArrowRight, Check, Flag, Play, RotateCcw } from 'lucide-react'
import { Button } from '../app/Primitives'

type NavigationControlsProps = {
  isNavigating: boolean
  isFinished: boolean
  currentStep: number
  totalSteps: number
  currentStepCompleted: boolean
  onStart: () => void
  onNext: () => void
  onPrevious: () => void
  onComplete: () => void
  onFinish: () => void
  onReset: () => void
}

export function NavigationControls({ isNavigating, isFinished, currentStep, totalSteps, currentStepCompleted, onStart, onNext, onPrevious, onComplete, onFinish, onReset }: NavigationControlsProps) {
  if (isFinished) {
    return <Button variant="secondary" onClick={onReset}><RotateCcw size={15} aria-hidden="true" /> Restart demo</Button>
  }
  if (!isNavigating) {
    return <Button onClick={onStart}><Play size={15} fill="currentColor" aria-hidden="true" /> Start Navigation</Button>
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onPrevious} disabled={currentStep === 0}><ArrowLeft size={15} aria-hidden="true" /> Previous</Button>
      {!currentStepCompleted ? (
        <Button onClick={onComplete}><Check size={15} aria-hidden="true" /> Mark Complete</Button>
      ) : currentStep === totalSteps - 1 ? (
        <Button onClick={onFinish}><Flag size={15} aria-hidden="true" /> Finish Recovery</Button>
      ) : (
        <Button onClick={onNext}><ArrowRight size={15} aria-hidden="true" /> Next Step</Button>
      )}
    </div>
  )
}