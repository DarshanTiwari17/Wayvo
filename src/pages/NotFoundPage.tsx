import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { RouteLoader } from '../components/routing/RouteLoader'
import { useAuth } from '../hooks/useAuth'

/**
 * Shown for an unknown URL.
 *
 * Sits inside the light product language, not the glass auth language: a user
 * who reaches a bad link is already inside the product.
 */
export function NotFoundPage() {
  const { user, loading, status } = useAuth()

  if (status === 'unconfigured') return <NavigateToSetup />
  if (loading) return <RouteLoader label="Checking your session" />

  // A signed-in traveller has the product available, so send them there.
  if (user) {
    return (
      <div className="wva-shell grid min-h-svh place-items-center px-5 py-16">
        <div className="w-card text-center" style={{ maxWidth: 420 }}>
          <span className="wva-empty__icon mx-auto mb-5" aria-hidden="true">
            <Compass size={22} strokeWidth={1.9} />
          </span>
          <h1 className="wva-h1">Page not found</h1>
          <p className="wva-body mt-2">
            That page does not exist, or it moved. The page you were looking for is not part of Wayvo.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <Link to="/dashboard" className="wva-btn wva-btn--primary">
              Back to dashboard
            </Link>
            <Link to="/journeys" className="wva-btn wva-btn--secondary">
              View journeys
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wva-shell grid min-h-svh place-items-center px-5 py-16">
      <div style={{ maxWidth: 420 }} className="text-center">
        <h1 className="wva-h1">Page not found</h1>
        <p className="wva-body mt-2">That page does not exist. Head back to Wayvo to carry on.</p>
        <div className="mt-7">
          <Link to="/login" className="wva-btn wva-btn--primary">
            Go to login
          </Link>
        </div>
      </div>
    </div>
  )
}

function NavigateToSetup() {
  return (
    <div className="wva-shell grid min-h-svh place-items-center">
      <RouteLoader label="Redirecting" />
    </div>
  )
}
