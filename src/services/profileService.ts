/**
 * All `profiles` table access lives here so the rest of the app never builds a
 * query itself. Every statement is scoped to the signed-in user; Row Level
 * Security in Postgres is the real enforcement (see
 * `supabase/migrations/0001_profiles.sql`), these helpers just avoid
 * accidentally asking for someone else's row.
 */
import { getSupabase } from '../lib/supabase'
import type { Profile, ProfileUpdate } from '../types/database'

/** Thrown when a query fails, so callers can surface a real message. */
export class ProfileServiceError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ProfileServiceError'
    this.code = code
  }
}

function toServiceError(error: { message: string; code?: string }): ProfileServiceError {
  return new ProfileServiceError(error.message, error.code)
}

/**
 * Fetches the profile row belonging to `userId`.
 *
 * Returns `null` when the row genuinely does not exist yet (e.g. the account
 * predates the `handle_new_user` trigger). It never invents placeholder data.
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, phone, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw toServiceError(error)
  return data
}

/**
 * Backstop for the database trigger: makes sure a profile row exists for the
 * current user. `upsert` with `ignoreDuplicates` is idempotent and safe to
 * call on every sign-in.
 *
 * Note the RLS `insert` policy is `auth.uid() = id`, so a client can only ever
 * insert its own profile.
 */
export async function ensureProfile(
  userId: string,
  seed: { fullName?: string | null; email?: string | null; avatarUrl?: string | null; phone?: string | null } = {},
): Promise<Profile> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        full_name: seed.fullName ?? null,
        email: seed.email ?? null,
        avatar_url: seed.avatarUrl ?? null,
        phone: seed.phone ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id, full_name, email, avatar_url, phone, created_at, updated_at')
    .single()

  if (error) throw toServiceError(error)
  return data
}

/** Updates the signed-in user's own profile. RLS rejects any other `id`. */
export async function updateProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
  const supabase = getSupabase()

  // Guard in the client as well as the database: never let a caller try to
  // write a row that isn't theirs.
  if (patch.id !== undefined && patch.id !== userId) {
    throw new ProfileServiceError('You can only update your own profile.', 'FORBIDDEN_ROW')
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...patch, id: userId })
    .eq('id', userId)
    .select('id, full_name, email, avatar_url, phone, created_at, updated_at')
    .single()

  if (error) throw toServiceError(error)
  return data
}
