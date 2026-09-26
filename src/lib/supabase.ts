/**
 * The single, centralised Supabase client for the whole Wayvo app.
 *
 * Components must never call `createClient` themselves — import `getSupabase()`
 * (or the auth/profile services built on top of it) instead. This keeps one
 * connection, one auth token store and one realtime channel registry.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseAnonKey, supabaseConfigError, supabaseUrl } from './supabaseConfig'
import type { Database } from '../types/database'

/* ---------------------------------------------------------------------------
 * "Remember me?"
 *
 * The reference design includes a Remember me? checkbox, so it has to control
 * something real rather than being decorative. supabase-js persists the session
 * in localStorage by default, which survives closing the browser. When the
 * traveller unticks the box we persist to sessionStorage instead, so the
 * session lasts for the tab but dies with it.
 * ------------------------------------------------------------------------- */

const REMEMBER_PREFERENCE_KEY = 'wayvo:remember-session'

function readRememberPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(REMEMBER_PREFERENCE_KEY)
    return stored === null ? true : stored === 'true'
  } catch {
    // Private mode / storage disabled — persistent sessions are the safer bet.
    return true
  }
}

let rememberSession = readRememberPreference()

/** Current preference. `true` = survive a full browser restart. */
export function isRememberSessionEnabled(): boolean {
  return rememberSession
}

export function setRememberSession(enabled: boolean): void {
  rememberSession = enabled
  try {
    window.localStorage.setItem(REMEMBER_PREFERENCE_KEY, String(enabled))
  } catch {
    /* preference is best-effort only */
  }
}

function activeStorage(): Storage {
  return rememberSession ? window.localStorage : window.sessionStorage
}

/** Routes supabase-js storage calls to whichever backend the user chose. */
const authStorage = {
  getItem: (key: string): string | null => {
    try {
      return activeStorage().getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      // Never leave a copy behind in the store we are no longer using.
      const other = rememberSession ? window.sessionStorage : window.localStorage
      other.removeItem(key)
      activeStorage().setItem(key, value)
    } catch {
      /* quota / private mode — the session simply is not persisted */
    }
  },
  removeItem: (key: string): void => {
    try {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

let client: SupabaseClient<Database> | null = null

if (supabaseConfigError === null) {
  client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Restores the stored session on boot — this is what keeps a signed-in
      // user signed in across a page refresh.
      storage: authStorage,
      persistSession: true,
      // Refreshes the access token automatically so long sessions do not
      // silently expire.
      autoRefreshToken: true,
      // Picks up the `?code=` / `#access_token=` fragment that Supabase
      // appends to email-confirmation and password-recovery links.
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
}

/**
 * Returns the shared client. Throws only if the app somehow reached this point
 * without configuration — `main.tsx` renders a setup notice in that case, so in
 * practice this never throws.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (!client) {
    throw new Error(
      'Supabase client was requested but the project is not configured. ' +
        (supabaseConfigError ?? 'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.'),
    )
  }
  return client
}

export { supabaseConfigError }
