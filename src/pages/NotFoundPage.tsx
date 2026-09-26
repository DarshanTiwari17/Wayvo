import { Link, Navigate } from 'react-router-dom'
import { RouteLoader } from '../components/routing/RouteLoader'
import { useAuth } from '../hooks/useAuth'

export function NotFoundPage() {
  const { loading, status } = useAuth()

  if (status === 'unconfigured') return <Navigate to="/setup" replace />
  if (loading) return <RouteLoader label="Checking your session" />

  return (
    <div className="relative grid min-h-svh place-items-center px-5">
      <div className="wayvo-hero-backdrop" aria-hidden="true" />
      <div className="relative z-[1] text-center">
        <p className="font-display text-[64px] leading-none font-extrabold text-white/90">404</p>
        <h1 className="mt-4 font-display text-[20px] font-bold text-white">This trail does not exist</h1>
        <p className="mt-2 text-[14px] text-white/70">The page you were looking for has wandered off the map.</p>
        <Link
          to="/"
          className="wayvo-button mt-7 max-w-[220px] border border-white/25 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
        >
          Back to safety
        </Link>
      </div>
    </div>
  )
}
