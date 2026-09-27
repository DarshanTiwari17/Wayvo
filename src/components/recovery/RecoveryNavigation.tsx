import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DeviceLocation, RecoveryNavigationData } from '../../types/recoveryNavigation'
import { useRecoveryNavigation } from '../../hooks/useRecoveryNavigation'
import { Banner, Card, PageHeader } from '../app/Primitives'
import { NavigationControls } from './NavigationControls'
import { RecoveryMap } from './RecoveryMap'
import { RecoveryProgress } from './RecoveryProgress'
import { RecoveryStepCard } from './RecoveryStepCard'

export function RecoveryNavigation({ data, currentLocation, onRecenter }: { data: RecoveryNavigationData; currentLocation?: DeviceLocation | null; onRecenter?: () => void }) {
  const navigation = useRecoveryNavigation(data.steps.length)
  const currentStep = data.steps[navigation.currentStep]
  const currentStepCompleted = navigation.completedSteps.includes(navigation.currentStep)

  if (navigation.isFinished) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="py-14 text-center">
          <CheckCircle2 size={44} className="mx-auto text-app-accent" aria-hidden="true" />
          <h1 className="wva-h1 mt-5">Journey completed</h1>
          <p className="wva-body mx-auto mt-3 max-w-md">You have completed all steps in this journey.</p>
          <Link to="/journeys" className="wva-btn wva-btn--primary mt-7"><ArrowLeft size={15} aria-hidden="true" /> Back to Journeys</Link>
        </Card>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Navigate your journey" description={data.summary} actions={<Link to="/journeys" className="wva-btn wva-btn--secondary"><ArrowLeft size={15} aria-hidden="true" /> Back to Journeys</Link>} />
      <Banner tone="info">
        <strong className="font-semibold">OpenRouteService route.</strong> This route uses your saved journey endpoints. It does not include live traffic or GPS tracking.
      </Banner>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
          <RecoveryProgress currentStep={navigation.currentStep} totalSteps={data.steps.length} completedSteps={navigation.completedSteps.length} />
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div><p className="wva-eyebrow">Current step</p><h2 className="wva-h2 mt-1">{currentStep?.title ?? 'No route available'}</h2></div>
              <span className="text-[13px] font-medium text-app-text-muted">{navigation.isNavigating ? 'In progress' : 'Ready to begin'}</span>
            </div>
            {currentStep ? <RecoveryStepCard step={currentStep} status={currentStepCompleted ? 'completed' : 'current'} /> : <p className="wva-body mt-4">No route available.</p>}
            <div className="mt-5"><NavigationControls isNavigating={navigation.isNavigating} isFinished={navigation.isFinished} currentStep={navigation.currentStep} totalSteps={data.steps.length} currentStepCompleted={currentStepCompleted} onStart={navigation.startNavigation} onNext={navigation.nextStep} onPrevious={navigation.previousStep} onComplete={navigation.completeCurrentStep} onFinish={navigation.finishNavigation} onReset={navigation.resetNavigation} /></div>
          </Card>
        </div>
        <div className="order-1 min-w-0 lg:order-2"><RecoveryMap steps={data.steps} currentStep={navigation.currentStep} completedSteps={navigation.completedSteps} routeGeometry={data.routeGeometry} currentLocation={currentLocation} onRecenter={onRecenter} /></div>
      </div>
    </>
  )
}
