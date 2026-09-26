import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isRememberSessionEnabled, setRememberSession } from '../lib/supabase'
import {
  supabaseConfigError,
  isSupabaseConfigured,
  resolvePasswordRecoveryRedirect,
  oauthRedirectUrl,
} from '../lib/supabaseConfig'
import { toFriendlyError, type FriendlyError } from '../lib/authErrors'
import { consumeAuthUrlError } from '../lib/authUrlState'
import {
  ensureProfile,
  fetchProfile,
  ProfileServiceError,
  updateProfile as updateProfileRow,
} from '../services/profileService'
import type { Profile, ProfileUpdate } from '../types/database'
import {
  AuthContext,
  type AuthContextValue,
  type AuthResult,
  type AuthStatus,
  type ProfileStatus,
  type SignInInput,
  type SignUpInput,
  type SignUpResult,
} from './authContext'

/**
 * Wayvo's single source of authentication state.
 *
 * Everything the app knows about the current session lives here: the Supabase
 * `user` / `session`, a `loading` flag that is true only while the persisted
 * session is being restored, the sign-in / sign-up / sign-out / reset actions,
 * and the caller's own `public.profiles` row.
 *
 * The context object and the value types live in ./authContext so this module
 * exports only a component (which keeps React Fast Refresh working).
 */
const ok: AuthResult = { ok: true }
const fail = (error: FriendlyError): AuthResult => ({ ok: false, error })

/** Runs a Supabase call after the auth lock is released (see onAuthStateChange). */
function defer<T>(fn: () => T): void {
  setTimeout(fn, 0)
}

/**
 * The display name lives in `auth.users.raw_user_meta_data`; `public.profiles`
 * is the application-facing copy. Supports OAuth providers too, which send
 * `name` / `picture` instead of `full_name` / `avatar_url`.
 */
function readFullName(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  const value = meta?.full_name ?? meta?.name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readAvatarUrl(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  const value = meta?.avatar_url ?? meta?.picture
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [isRecoverySession, setIsRecoverySession] = useState(false)
  const [urlAuthError, setUrlAuthError] = useState<FriendlyError | null>(null)
  const [rememberSession, setRememberSessionState] = useState(isRememberSessionEnabled)

  // Guards against out-of-order profile fetches when auth changes quickly.
  const profileRequestId = useRef(0)

  const user = session?.user ?? null

  // --- profile loading ------------------------------------------------------

  const loadProfile = useCallback(async (targetUser: User | null) => {
    const requestId = ++profileRequestId.current

    if (!targetUser) {
      setProfile(null)
      setProfileStatus('idle')
      setProfileError(null)
      return
    }

    setProfileStatus('loading')
    setProfileError(null)

    try {
      let row = await fetchProfile(targetUser.id)

      // The `handle_new_user` trigger normally creates this row. If it is
      // missing (older account, or the trigger was added later) create it now
      // rather than leaving the app without a profile.
      if (!row) {
        row = await ensureProfile(targetUser.id, {
          fullName: readFullName(targetUser),
          email: targetUser.email ?? null,
          avatarUrl: readAvatarUrl(targetUser),
          phone: targetUser.phone ?? null,
        })
      }

      if (requestId !== profileRequestId.current) return
      setProfile(row)
      setProfileStatus('ready')
    } catch (error) {
      if (requestId !== profileRequestId.current) return
      // RLS or a missing table is a real, reportable failure — we surface it
      // instead of substituting placeholder profile data.
      setProfile(null)
      setProfileStatus('error')
      setProfileError(
        error instanceof ProfileServiceError
          ? toFriendlyError({ message: error.message, code: error.code }).message
          : 'Could not load your profile from the database.',
      )
    }
  }, [])

  // --- session bootstrap + live auth state ---------------------------------

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    const supabase = getSupabase()
    let active = true

    // Pick up a failure carried in on the URL (expired / reused email link).
    setUrlAuthError(consumeAuthUrlError())

    // `INITIAL_SESSION` gives us the persisted session, so a refresh keeps the
    // user signed in without an extra network round trip.
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return

      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true)
      }

      // `TOKEN_REFRESHED` and `SIGNED_IN` mean the user object changed
      // (e.g. they just confirmed their email) — keep `user` in sync.
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'PASSWORD_RECOVERY'
      ) {
        setSession(nextSession)
        setLoading(false)
      }

      const nextUser = nextSession?.user ?? null

      if (event === 'SIGNED_OUT') {
        setIsRecoverySession(false)
        void loadProfile(null)
        return
      }

      // Never call supabase APIs synchronously inside this callback: it can
      // deadlock on the auth lock.
      if (nextUser) {
        defer(() => {
          if (active) void loadProfile(nextUser)
        })
      }
    })

    // Belt-and-braces: if the listener does not emit for some reason, resolve
    // `loading` from an explicit read so the router can never hang.
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return
      setSession(sessionData.session)
      setLoading(false)
      const currentUser = sessionData.session?.user ?? null
      if (currentUser) {
        void loadProfile(currentUser)
      } else {
        setProfileStatus('idle')
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [loadProfile])

  // --- auth actions --------------------------------------------------------

  const signIn = useCallback(async ({ email, password }: SignInInput): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return fail(toFriendlyError(error, 'We could not sign you in. Please try again.'))
    return ok
  }, [])

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // /dashboard is protected, so an unconfigured redirect or a declined
        // consent screen lands back in the app: success goes straight through,
        // failure is bounced to /login where `urlAuthError` is displayed.
        redirectTo: oauthRedirectUrl(),
      },
    })

    if (error) {
      return fail(
        toFriendlyError(
          error,
          'Google sign-in is not available. Make sure the Google provider is enabled in Supabase (Authentication → Providers).',
        ),
      )
    }
    return ok
  }, [])

  const signUp = useCallback(async ({ email, password, fullName }: SignUpInput): Promise<SignUpResult> => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: { message: supabaseConfigError!, code: null, isEmailIssue: false } }
    }
    const supabase = getSupabase()

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // `handle_new_user` reads these to seed public.profiles. Keeping the
        // only copy of the name in user_metadata avoids duplicating it.
        data: { full_name: fullName.trim() },
        emailRedirectTo: resolvePasswordRecoveryRedirect(),
      },
    })

    if (error) return { ok: false, error: toFriendlyError(error, 'We could not create your account.') }

    // No session => Supabase requires the user to confirm their email first.
    return {
      ok: true,
      requiresEmailConfirmation: !data.session,
      session: data.session,
    }
  }, [])

  const signOut = useCallback(async (): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()
    const { error } = await supabase.auth.signOut()
    if (error) return fail(toFriendlyError(error, 'We could not sign you out. Please try again.'))
    setSession(null)
    setProfile(null)
    setProfileStatus('idle')
    setIsRecoverySession(false)
    return ok
  }, [])

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resolvePasswordRecoveryRedirect(),
    })
    if (error) return fail(toFriendlyError(error, 'We could not send the reset link. Please try again.'))
    return ok
  }, [])

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return fail(toFriendlyError(error, 'We could not update your password.'))
    // The user is now fully recovered: drop the recovery flag.
    setIsRecoverySession(false)
    return ok
  }, [])

  const resendVerificationEmail = useCallback(async (email: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return fail({ message: supabaseConfigError!, code: null, isEmailIssue: false })
    const supabase = getSupabase()
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: resolvePasswordRecoveryRedirect() },
    })
    if (error) return fail(toFriendlyError(error, 'We could not resend the verification email.'))
    return ok
  }, [])

  const refreshProfile = useCallback(async () => {
    await loadProfile(user)
  }, [loadProfile, user])

  const updateProfile = useCallback(
    async (patch: Omit<ProfileUpdate, 'id'>): Promise<AuthResult> => {
      if (!user) return fail({ message: 'You must be signed in to update your profile.', code: null, isEmailIssue: false })
      try {
        const row = await updateProfileRow(user.id, patch)
        setProfile(row)
        setProfileStatus('ready')
        setProfileError(null)
        return ok
      } catch (error) {
        const friendly = toFriendlyError(
          error instanceof ProfileServiceError ? { message: error.message, code: error.code } : null,
          'We could not save your profile.',
        )
        setProfileError(friendly.message)
        return fail(friendly)
      }
    },
    [user],
  )

  const clearUrlAuthError = useCallback(() => setUrlAuthError(null), [])

  const handleRememberSession = useCallback((enabled: boolean) => {
    setRememberSession(enabled)
    setRememberSessionState(enabled)
  }, [])

  const isEmailConfirmed = Boolean(user?.email_confirmed_at)

  const status: AuthStatus = !isSupabaseConfigured ? 'unconfigured' : loading ? 'loading' : user ? 'authenticated' : 'guest'

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      status,
      isEmailConfirmed,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      resendVerificationEmail,
      profile,
      profileStatus,
      profileError,
      refreshProfile,
      updateProfile,
      isRecoverySession,
      rememberSession,
      setRememberSession: handleRememberSession,
      urlAuthError,
      clearUrlAuthError,
      configError: supabaseConfigError,
    }),
    [
      user,
      session,
      loading,
      status,
      isEmailConfirmed,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      resendVerificationEmail,
      profile,
      profileStatus,
      profileError,
      refreshProfile,
      updateProfile,
      isRecoverySession,
      rememberSession,
      handleRememberSession,
      urlAuthError,
      clearUrlAuthError,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
