import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CloudRain, LayoutGrid, LogOut, Map, Menu, Navigation, Radio, ShieldCheck, User, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { fetchOpenDisruptions } from '../../services/travelService'
import { TravelChatWidget } from '../../features/travel-chat/TravelChatWidget'

/**
 * Wayvo product shell — the single layout for every signed-in page.
 *
 * Deliberately not the login aesthetic: solid white surfaces, hairline borders,
 * a calm neutral page background and colour reserved for meaning. The glass
 * treatment belongs to the authentication screens only.
 */

type NavItem = { to: string; label: string; icon: typeof LayoutGrid }

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/journeys', label: 'Journeys', icon: Map },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/recovery', label: 'Recovery', icon: ShieldCheck },
  { to: '/digital-twin', label: 'Digital Twin', icon: CloudRain },
  { to: '/navigation', label: 'Navigate', icon: Navigation },
  { to: '/social-signals', label: 'Social Signals', icon: Radio },
]

export function AppShell() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [alertCount, setAlertCount] = useState<number | null>(null)

  // Close the mobile panel whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  // Real count from the database. Stays null when the table is unavailable so
  // the nav never shows a made-up number.
  useEffect(() => {
    if (!user) return
    let active = true
    void fetchOpenDisruptions(user.id)
      .then((rows) => {
        if (active) setAlertCount(rows.length)
      })
      .catch(() => {
        if (active) setAlertCount(null)
      })
    return () => {
      active = false
    }
  }, [user, location.pathname])

  const displayName = profile?.full_name?.trim() || user?.email || 'Traveller'

  async function handleSignOut() {
    const result = await signOut()
    if (result.ok) {
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="wva-shell">
      <header className="wva-header">
        <div className="wva-container">
          <div className="wva-header__inner">
            <Link to="/dashboard" className="wva-wordmark" aria-label="Wayvo home">
              Wayvo
            </Link>

            <nav className="wva-nav" aria-label="Main">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="wva-nav__link">
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                  {label}
                  {to === '/alerts' && alertCount !== null && alertCount > 0 && (
                    <span className="wva-nav__badge">{alertCount}</span>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <UserMenu displayName={displayName} email={user?.email ?? ''} avatarUrl={profile?.avatar_url ?? null} onSignOut={handleSignOut} />

              <button
                type="button"
                className="wva-btn wva-btn--ghost wva-btn--sm min-[900px]:hidden"
                onClick={() => setMobileNavOpen((open) => !open)}
                aria-expanded={mobileNavOpen}
                aria-controls="wayvo-mobile-nav"
                aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              >
                {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>

        {mobileNavOpen && (
          <nav id="wayvo-mobile-nav" className="wva-mobilenav" aria-label="Main">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="wva-mobilenav__link">
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                {label}
                {to === '/alerts' && alertCount !== null && alertCount > 0 && (
                  <span className="wva-nav__badge">{alertCount}</span>
                )}
              </NavLink>
            ))}
            <NavLink to="/profile" className="wva-mobilenav__link">
              <User size={16} strokeWidth={2} aria-hidden="true" />
              Profile
            </NavLink>
          </nav>
        )}
      </header>

      <main className="wva-container pb-20 pt-8 sm:pt-10">
        <Outlet />
      </main>
      <TravelChatWidget />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

type UserMenuProps = {
  displayName: string
  email: string
  avatarUrl: string | null
  onSignOut: () => void
}

function UserMenu({ displayName, email, avatarUrl, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Dismiss on outside click and on Escape.
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="wva-usermenu" ref={containerRef}>
      <button
        type="button"
        className="wva-usermenu__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        <Avatar url={avatarUrl} name={displayName} />
        <span className="hidden max-w-[140px] truncate sm:inline">{displayName}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="text-app-text-subtle">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={menuId} className="wva-usermenu__panel" role="menu">
          <div className="wva-usermenu__header">
            <p className="truncate text-[14px] font-semibold text-app-text">{displayName}</p>
            {email && <p className="mt-0.5 truncate text-[12px] text-app-text-subtle">{email}</p>}
          </div>

          <NavLink to="/profile" className="wva-usermenu__item" role="menuitem" onClick={() => setOpen(false)}>
            <User size={15} strokeWidth={2} aria-hidden="true" />
            Profile
          </NavLink>

          <button type="button" className="wva-usermenu__item wva-usermenu__item--danger" role="menuitem" onClick={onSignOut}>
            <LogOut size={15} strokeWidth={2} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || name.charAt(0).toUpperCase()

  if (url) {
    return (
      <span className="wva-avatar">
        <img src={url} alt="" />
      </span>
    )
  }

  return <span className="wva-avatar">{initials}</span>
}
