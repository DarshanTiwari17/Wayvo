import { Terminal } from 'lucide-react'
import { supabaseConfigError } from '../lib/supabaseConfig'

/**
 * Shown instead of the app when Supabase credentials are missing.
 *
 * Deliberately explicit: the alternative would be a login form that silently
 * fails, or worse, a mock session. Wayvo reports the missing configuration.
 */
export function SupabaseSetupPage() {
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-ink px-5 py-12">
      <div className="w-full max-w-2xl">
        <span className="font-display text-[13px] font-extrabold tracking-[0.2em] text-white/70 uppercase">Wayvo</span>

        <h1 className="mt-3 font-display text-[clamp(24px,4vw,34px)] leading-tight font-extrabold tracking-tight text-white">
          Supabase is not configured
        </h1>

        <p className="mt-3 text-[15px] leading-relaxed text-white/70">
          Wayvo talks to a real Supabase project. Add your credentials to <code className="text-white">.env.local</code>{' '}
          and restart the dev server.
        </p>

        <ol className="mt-6 flex flex-col gap-3 text-[14px] leading-relaxed text-white/80">
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 text-[12px]">
              1
            </span>
            <span>
              Copy the template: <code className="text-white">cp .env.example .env.local</code>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 text-[12px]">
              2
            </span>
            <span>
              Paste your <strong className="font-semibold text-white">Project URL</strong> and{' '}
              <strong className="font-semibold text-white">anon key</strong> from Supabase → Project Settings → API.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/25 text-[12px]">
              3
            </span>
            <span>
              Run <code className="text-white">supabase/migrations/0001_profiles.sql</code> in the Supabase SQL editor.
            </span>
          </li>
        </ol>

        <div className="mt-7 flex items-start gap-3 rounded-lg border border-rose-300/30 bg-rose-900/25 p-4">
          <Terminal size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-rose-200" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-rose-200 uppercase">Reported error</p>
            <p className="mt-1 break-words text-[13px] text-rose-100">{supabaseConfigError}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
