import type { ReactNode } from 'react'
import { Facebook, Instagram, Linkedin, Twitter } from 'lucide-react'

/**
 * The four white circular social buttons under the headline divider, exactly
 * as they appear in the reference: 44px white discs with dark glyphs.
 *
 * They are presentational only — Wayvo auth is email/password via Supabase, so
 * these link out to the brand profiles.
 */
const SOCIAL_LINKS = [
  { label: 'Wayvo on Facebook', href: 'https://www.facebook.com', Icon: Facebook },
  { label: 'Wayvo on Instagram', href: 'https://www.instagram.com', Icon: Instagram },
  { label: 'Wayvo on LinkedIn', href: 'https://www.linkedin.com', Icon: Linkedin },
  { label: 'Wayvo on Twitter', href: 'https://twitter.com', Icon: Twitter },
] as const

export function SocialLinks() {
  return (
    <ul className="wayvo-hero__social list-none p-0 m-0">
      {SOCIAL_LINKS.map(({ label, href, Icon }) => (
        <li key={label}>
          <a
            className="wayvo-hero__social-link"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
          >
            <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  )
}

type AuthShellProps = {
  children: ReactNode
}

/**
 * The /login shell from the reference image.
 *
 * Left column  → frosted glass card holding the form.
 * Right column → uppercase display headline, white rule, social row.
 *
 * Below 768px the two columns stack in the same order (card first, then the
 * headline block), so the visual hierarchy is preserved rather than scaled.
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <>
      <div className="wayvo-hero-backdrop" aria-hidden="true" />

      <main className="wayvo-auth-shell">
        <div className="flex w-full justify-center md:justify-start">
          <div className="wayvo-card">{children}</div>
        </div>

        <aside className="w-full max-w-[38.5rem]">
          <h1 className="wayvo-hero__headline wayvo-hero__wordmark">Wayvo</h1>

          <div className="mt-8 md:mt-14">
            <div className="wayvo-hero__rule" />
          </div>

          <div className="mt-6 md:mt-7">
            <SocialLinks />
          </div>
        </aside>
      </main>
    </>
  )
}
