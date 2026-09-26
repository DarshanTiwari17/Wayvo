/**
 * Hand-maintained mirror of the generated Supabase `Database` type.
 *
 * Regenerate with the Supabase CLI once the project is linked:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Mirrors `supabase/migrations/`:
 *   0001_profiles.sql → profiles
 *   0002_travel.sql   → trips, disruptions, recovery_plans
 *
 * `trip_segments` and `bookings` are not created yet, so they are not declared.
 * See `supabase/ROADMAP.md`.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          /** Supabase auth.users UUID. */
          id: string
          full_name: string | null
          email: string | null
          avatar_url: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          email?: string | null
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          email?: string | null
          avatar_url?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      trips: {
        Row: {
          id: string
          profile_id: string
          title: string
          origin: string | null
          destination: string | null
          status: TripStatus
          starts_on: string | null
          ends_on: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          title: string
          origin?: string | null
          destination?: string | null
          status?: TripStatus
          starts_on?: string | null
          ends_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          title?: string
          origin?: string | null
          destination?: string | null
          status?: TripStatus
          starts_on?: string | null
          ends_on?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      disruptions: {
        Row: {
          id: string
          profile_id: string
          trip_id: string | null
          kind: string
          severity: DisruptionSeverity
          headline: string
          detail: string | null
          reported_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id?: string | null
          kind: string
          severity?: DisruptionSeverity
          headline: string
          detail?: string | null
          reported_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          trip_id?: string | null
          kind?: string
          severity?: DisruptionSeverity
          headline?: string
          detail?: string | null
          reported_at?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      recovery_plans: {
        Row: {
          id: string
          profile_id: string
          trip_id: string
          disruption_id: string | null
          title: string
          summary: string | null
          total_cost: number | null
          currency: string
          status: RecoveryPlanStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id: string
          disruption_id?: string | null
          title: string
          summary?: string | null
          total_cost?: number | null
          currency?: string
          status?: RecoveryPlanStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          trip_id?: string
          disruption_id?: string | null
          title?: string
          summary?: string | null
          total_cost?: number | null
          currency?: string
          status?: RecoveryPlanStatus
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type TripStatus = 'planning' | 'booked' | 'active' | 'completed' | 'cancelled'
export type DisruptionSeverity = 'info' | 'warn' | 'critical'
export type RecoveryPlanStatus = 'proposed' | 'accepted' | 'dismissed'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
export type Trip = Database['public']['Tables']['trips']['Row']
export type TripInsert = Database['public']['Tables']['trips']['Insert']
export type TripUpdate = Database['public']['Tables']['trips']['Update']
export type Disruption = Database['public']['Tables']['disruptions']['Row']
export type RecoveryPlan = Database['public']['Tables']['recovery_plans']['Row']
