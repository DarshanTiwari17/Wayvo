import { useEffect, useState, type FormEvent } from 'react'
import { Camera, Mail } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Banner, Button, Card, Field, PageHeader, Pill, SectionTitle, SkeletonLines } from '../components/app/Primitives'

/**
 * Wayvo — /profile
 *
 * The traveller's own details, read live from `public.profiles` and writable
 * through the RLS-protected update policy.
 *
 * Nothing technical is shown: no UUIDs, no row identifiers, no auth metadata
 * and no database timestamps. The one internal value on screen is "member
 * since", rendered as a month and year, because a traveller cares about that
 * and nothing else.
 */
export function ProfilePage() {
  const { user, profile, profileStatus, profileError, refreshProfile, updateProfile, isEmailConfirmed } = useAuth()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Seed the form from the real row whenever it arrives.
  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setPhone(profile.phone ?? '')
    setDirty(false)
  }, [profile])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 4000)
    return () => clearTimeout(timer)
  }, [saved])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setSaved(false)

    const nextErrors: Record<string, string | undefined> = {}
    if (fullName.trim() && fullName.trim().length < 2) {
      nextErrors.fullName = 'That looks too short for a name.'
    }
    if (phone.trim() && phone.trim().length < 6) {
      nextErrors.phone = 'Enter a contact number we can reach you on.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    const result = await updateProfile({
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
    })
    setSaving(false)

    if (result.ok) {
      setSaved(true)
      setDirty(false)
      void refreshProfile()
    } else {
      setFormError(result.error.message)
    }
  }

  const email = profile?.email?.trim() || user?.email || ''
  const avatarUrl = profile?.avatar_url ?? null
  const displayName = profile?.full_name?.trim() || email.split('@')[0] || 'Traveller'
  const memberSince = profile?.created_at ? new Date(profile.created_at) : null

  return (
    <>
      <PageHeader title="Profile" description="Your traveller details, the way you like to travel." />

      {/* --- identity card ------------------------------------------------- */}
      <Card className="mb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="wva-avatar" style={{ width: 64, height: 64, fontSize: 20 }} aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : initialsOf(displayName)}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="wva-h1">{displayName}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {email && (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-app-text-muted">
                  <Mail size={14} strokeWidth={2} aria-hidden="true" />
                  {email}
                </span>
              )}
              {memberSince && !Number.isNaN(memberSince.getTime()) && (
                <span className="text-[13px] text-app-text-muted">
                  Member since{' '}
                  {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(memberSince)}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Pill tone={isEmailConfirmed ? 'success' : 'warn'}>
                {isEmailConfirmed ? 'Email confirmed' : 'Email not confirmed'}
              </Pill>
            </div>
          </div>
        </div>
      </Card>

      {!isEmailConfirmed && (
        <div className="mb-6">
          <Banner tone="warn">
            Confirm your email address to make sure recovery options and alerts reach you. Check your inbox for the
            Wayvo verification link.
          </Banner>
        </div>
      )}

      {/* --- editable details ---------------------------------------------- */}
      <Card className="mb-6">
        <SectionTitle description="Used to keep you up to date when a journey changes.">Your details</SectionTitle>

        {profileStatus === 'loading' && <SkeletonLines rows={3} />}

        {profileStatus === 'error' && (
          <Banner tone="danger">
            We could not load your details. {profileError}
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => void refreshProfile()}>
                Try again
              </Button>
            </div>
          </Banner>
        )}

        {(profileStatus === 'ready' || profileStatus === 'missing') && (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            {formError && <Banner tone="danger">{formError}</Banner>}
            {saved && <Banner tone="success">Your details have been saved.</Banner>}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="fullName" label="Full name" error={errors.fullName} hint="What we call you.">
                <input
                  id="fullName"
                  className="wva-input"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value)
                    setDirty(true)
                  }}
                  placeholder="Alex Rivera"
                  autoComplete="name"
                  aria-invalid={Boolean(errors.fullName) || undefined}
                  aria-describedby={errors.fullName ? 'fullName-error' : undefined}
                  disabled={saving}
                />
              </Field>

              <Field id="phone" label="Phone" error={errors.phone} hint="Optional. For urgent changes only.">
                <input
                  id="phone"
                  className="wva-input"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value)
                    setDirty(true)
                  }}
                  placeholder="+1 555 0134"
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.phone) || undefined}
                  aria-describedby={errors.phone ? 'phone-error' : undefined}
                  disabled={saving}
                />
              </Field>
            </div>

            <Field id="emailReadOnly" label="Email" hint="Your sign-in address. Contact support to change it.">
              <input
                id="emailReadOnly"
                className="wva-input"
                value={email}
                readOnly
                disabled
                aria-readonly="true"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={saving} pendingLabel="Saving…" disabled={!dirty}>
                Save changes
              </Button>
              {!dirty && !saving && <span className="text-[12px] text-app-text-subtle">No changes to save</span>}
            </div>
          </form>
        )}
      </Card>

      {/* --- preferences: honestly absent, not faked ------------------------ */}
      <Card>
        <SectionTitle description="Tell Wayvo how you like to travel and it will shape your options.">
          Travel preferences
        </SectionTitle>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
            style={{ background: 'var(--color-app-surface-alt)', color: 'var(--color-app-text-subtle)' }}
            aria-hidden="true"
          >
            <Camera size={17} strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-app-text">Coming soon</p>
            <p className="wva-body mt-0.5">
              Seat preferences, pace, dietary and accessibility needs will live here. We are not collecting them yet, so
              there is nothing to show.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'W'
  )
}
