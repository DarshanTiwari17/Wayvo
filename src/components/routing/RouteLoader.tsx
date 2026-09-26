/**
 * Full-screen loading state.
 *
 * Shown while the persisted Supabase session is being restored, so the router
 * never bounces a signed-in user to /login during a refresh.
 */
export function RouteLoader({ label = 'Restoring your session' }: { label?: string }) {
  return (
    <div className="wayvo-route-loader" role="status" aria-live="polite">
      <span className="wayvo-spinner" aria-hidden="true" />
      <span className="text-[13px] tracking-[0.14em] text-white/70 uppercase">{label}</span>
    </div>
  )
}
