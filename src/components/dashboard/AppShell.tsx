import type { ReactNode } from 'react'
import { Leaf, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

/**
 * Chrome for signed-in pages. Keeps the Wayvo nature aesthetic and, crucially,
 * renders the traveller's *real* identity from Supabase — no placeholders.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  const displayName =
    profile?.full_name?.trim() ||
    (user?.user_metadata as Record<string, unknown> | undefined)?.full_name?.toString() ||
    user?.email ||
    'Traveller'

  async function handleSignOut() {
    const result = await signOut()
    if (result.ok) {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="relative min-h-svh">
      <div className="wayvo-hero-backdrop" aria-hidden="true" />
      {/* The dashboard is scrollable and holds a lot of body copy over the
          photograph, so it carries a heavier scrim than the auth pages. */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-ink/55" aria-hidden="true" />

      <div className="relative z-[1] flex min-h-svh flex-col">
        <header className="border-b border-white/10">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-5 py-4 sm:px-8 sm:py-5">
            <span className="flex items-center gap-2 font-display text-[15px] font-extrabold tracking-[0.18em] text-white uppercase">
              <Leaf size={18} strokeWidth={2.2} aria-hidden="true" />
              Wayvo
            </span>

            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="max-w-[220px] truncate text-[13px] font-medium text-white">{displayName}</p>
                <p className="max-w-[220px] truncate text-[12px] text-white/55">{user?.email}</p>
              </div>

              <Avatar url={profile?.avatar_url ?? null} name={displayName} />

              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 text-[12px] font-semibold tracking-[0.1em] text-white uppercase backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <LogOut size={14} strokeWidth={2.2} aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  if (url) {
    return <img src={url} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/30" />
  }

  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 place-items-center rounded-full bg-white font-display text-[12px] font-bold text-ink"
    >
      {initials || 'W'}
    </span>
  )
}
