/**
 * The auth context *definition* and its types.
 *
 * Kept apart from `AuthProvider.tsx` on purpose: a module that exports both a
 * React component and a plain value defeats React Fast Refresh, so Vite has to
 * invalidate the page on every edit. This file has no components; the provider
 * file has no non-component exports.
 */
import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { FriendlyError } from '../lib/authErrors'
import type { Profile, ProfileUpdate } from '../types/database'

/** Discriminated result so forms can render exact messages without try/catch. */
export type AuthResult = { ok: true } | { ok: false; error: FriendlyError }

export type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

export type AuthStatus = 'unconfigured' | 'loading' | 'authenticated' | 'guest'

export interface SignUpInput {
  email: string
  password: string
  fullName: string
}

export interface SignInInput {
  email: string
  password: string
}

export type SignUpResult =
  | { ok: true; requiresEmailConfirmation: boolean; session: Session | null }
  | { ok: false; error: FriendlyError }

export interface AuthContextValue {
  /** The authenticated Supabase user, or `null`. Never a mock. */
  user: User | null
  session: Session | null
  /** `true` until the initial session has been restored from storage. */
  loading: boolean
  status: AuthStatus
  isEmailConfirmed: boolean

  signIn(input: SignInInput): Promise<AuthResult>
  /** Starts the Google OAuth flow. The browser navigates away on success. */
  signInWithGoogle(): Promise<AuthResult>
  signUp(input: SignUpInput): Promise<SignUpResult>
  signOut(): Promise<AuthResult>
  /** Step 1 of the reset flow — emails a recovery link. */
  resetPassword(email: string): Promise<AuthResult>
  /** Step 2 of the reset flow — sets the new password on the recovery session. */
  updatePassword(password: string): Promise<AuthResult>
  resendVerificationEmail(email: string): Promise<AuthResult>

  profile: Profile | null
  profileStatus: ProfileStatus
  profileError: string | null
  refreshProfile(): Promise<void>
  updateProfile(patch: Omit<ProfileUpdate, 'id'>): Promise<AuthResult>

  /** `true` while the current session came from a password-recovery link. */
  isRecoverySession: boolean
  /** `true` when the session is persisted beyond the current tab. */
  rememberSession: boolean
  setRememberSession(enabled: boolean): void
  /** One-shot error carried in the URL from a clicked email or OAuth link. */
  urlAuthError: FriendlyError | null
  clearUrlAuthError(): void
  configError: string | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)
