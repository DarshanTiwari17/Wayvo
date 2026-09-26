import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react'

/* ---------------------------------------------------------------------------
 * Page header — one place for the page title, supporting line and actions.
 * ------------------------------------------------------------------------- */

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="wva-h1">{title}</h1>
        {description && <p className="wva-body mt-2 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Card
 * ------------------------------------------------------------------------- */

export function Card({ children, className = '', pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`wva-card${pad ? ' wva-card--pad' : ''} ${className}`.trim()}>{children}</section>
}

/* ---------------------------------------------------------------------------
 * Section heading inside a card
 * ------------------------------------------------------------------------- */

export function SectionTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="wva-h2">{children}</h2>
      {description && <p className="wva-meta mt-1">{description}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Buttons
 * ------------------------------------------------------------------------- */

type ButtonProps = {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  pending?: boolean
  pendingLabel?: string
  disabled?: boolean
  onClick?: () => void
  full?: boolean
  className?: string
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  pending = false,
  pendingLabel,
  disabled = false,
  onClick,
  full = false,
  className = '',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending}
      className={[
        'wva-btn',
        `wva-btn--${variant}`,
        size === 'sm' ? 'wva-btn--sm' : '',
        full ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {pending && <LoaderCircle size={15} strokeWidth={2.4} className="animate-spin" aria-hidden="true" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}

/* ---------------------------------------------------------------------------
 * Feedback banner
 * ------------------------------------------------------------------------- */

type BannerTone = 'info' | 'success' | 'warn' | 'danger'

const BANNER_ICONS: Record<BannerTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
}

export function Banner({ tone = 'info', children }: { tone?: BannerTone; children: ReactNode }) {
  const Icon = BANNER_ICONS[tone]
  return (
    <div className={`wva-banner wva-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Empty state — the correct answer when a real table has no rows.
 * ------------------------------------------------------------------------- */

type EmptyStateProps = {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="wva-empty">
      <span className="wva-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <h3 className="wva-h2">{title}</h3>
      <p className="wva-body mt-2 max-w-md text-balance">{description}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Status pill
 * ------------------------------------------------------------------------- */

type PillTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info'

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`wva-pill wva-pill--${tone}`}>{children}</span>
}

/* ---------------------------------------------------------------------------
 * Field wrapper for the product forms
 * ------------------------------------------------------------------------- */

type FieldProps = {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label className="wva-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="wva-field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] text-app-text-subtle">{hint}</span>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Skeleton rows — used while a real query is in flight, never as fake content.
 * ------------------------------------------------------------------------- */

export function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="wva-skeleton h-3.5" style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  )
}
