import { useState } from 'react'

export function useRecoveryNavigation(stepCount: number) {
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [isNavigating, setIsNavigating] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  function startNavigation() {
    if (stepCount === 0) return
    setCurrentStep(0)
    setCompletedSteps([])
    setIsFinished(false)
    setIsNavigating(true)
  }

  function nextStep() {
    setCurrentStep((step) => Math.min(step + 1, Math.max(stepCount - 1, 0)))
  }

  function previousStep() {
    setCurrentStep((step) => Math.max(step - 1, 0))
  }

  function completeCurrentStep() {
    setCompletedSteps((steps) => (steps.includes(currentStep) ? steps : [...steps, currentStep]))
    if (currentStep < stepCount - 1) setCurrentStep((step) => step + 1)
  }

  function finishNavigation() {
    if (stepCount > 0 && completedSteps.length === stepCount) {
      setIsFinished(true)
      setIsNavigating(false)
    }
  }

  function resetNavigation() {
    setCurrentStep(0)
    setCompletedSteps([])
    setIsNavigating(false)
    setIsFinished(false)
  }

  return {
    currentStep,
    completedSteps,
    isNavigating,
    isFinished,
    startNavigation,
    nextStep,
    previousStep,
    completeCurrentStep,
    finishNavigation,
    resetNavigation,
  }
}