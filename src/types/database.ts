/**
 * Hand-maintained mirror of the generated Supabase `Database` type.
 *
 * Regenerate with the Supabase CLI once the project is linked:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * Mirrors `supabase/migrations/`:
 *   0001_profiles.sql      → profiles
 *   0002_travel.sql        → trips, disruptions, recovery_plans
 *   0003_journey_import.sql→ trips (extended), journey_segments,
 *                            journey_documents, gmail_connections
 *   0004_trip_hierarchy.sql → segment provenance, confidence, ordering, review
 *   0005_refund_policy_foundation.sql → policy rules, eligibility, travel status
 *   0006_public_policy_library.sql → non-sensitive policy descriptions
 *   0007_disruption_impact.sql → segment schedules, sources, and ownership checks
 *   0008_refund_evaluation_current.sql → private evidence/current-result fields
 *   0009_railradar_monitoring.sql → owner-scoped monitoring snapshots and notices
 *   0010_railradar_train_identification.sql → identification state and service-number provenance
 *
 * `bookings` and the preference tables are not created yet, so they are not
 * declared. See `supabase/ROADMAP.md`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type TripStatus = 'planning' | 'booked' | 'active' | 'completed' | 'cancelled'
export type DisruptionSeverity = 'info' | 'warn' | 'critical'
export type RecoveryPlanStatus = 'proposed' | 'accepted' | 'dismissed'
export type TransportMode = 'train' | 'flight' | 'bus' | 'car' | 'ferry' | 'hotel' | 'other'
export type JourneySource = 'manual' | 'upload' | 'gmail'
export type FieldProvenance = 'confirmed' | 'estimated' | 'missing'
export type PassengerTravelStatus = 'travelled' | 'not_travelled' | 'unknown'
export type DisruptionKind = 'delay' | 'cancellation' | 'weather' | 'closure' | 'diversion' | 'rescheduling' | 'operational_exception'
export type DisruptionSource = 'manual' | 'simulator' | 'provider' | 'gmail'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
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
          // Booking detail, added by 0003_journey_import.sql
          transport_mode: TransportMode | null
          operator_name: string | null
          service_number: string | null
          departure_at: string | null
          arrival_at: string | null
          booking_reference: string | null
          pnr: string | null
          ticket_number: string | null
          passenger_name: string | null
          seat: string | null
          coach: string | null
          terminal: string | null
          fare_amount: number | null
          fare_currency: string | null
          booking_status: string | null
          source: JourneySource
          field_provenance: Json | null
          import_payload: Json | null
          // Trip hierarchy, added by 0004_trip_hierarchy.sql
          itinerary_built_at: string | null
          segment_count: number
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
          transport_mode?: TransportMode | null
          operator_name?: string | null
          service_number?: string | null
          departure_at?: string | null
          arrival_at?: string | null
          booking_reference?: string | null
          pnr?: string | null
          ticket_number?: string | null
          passenger_name?: string | null
          seat?: string | null
          coach?: string | null
          terminal?: string | null
          fare_amount?: number | null
          fare_currency?: string | null
          booking_status?: string | null
          source?: JourneySource
          field_provenance?: Json | null
          import_payload?: Json | null
          itinerary_built_at?: string | null
          segment_count?: number
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
          transport_mode?: TransportMode | null
          operator_name?: string | null
          service_number?: string | null
          departure_at?: string | null
          arrival_at?: string | null
          booking_reference?: string | null
          pnr?: string | null
          ticket_number?: string | null
          passenger_name?: string | null
          seat?: string | null
          coach?: string | null
          terminal?: string | null
          fare_amount?: number | null
          fare_currency?: string | null
          booking_status?: string | null
          source?: JourneySource
          field_provenance?: Json | null
          import_payload?: Json | null
          itinerary_built_at?: string | null
          segment_count?: number
        }
        Relationships: []
      }

      disruptions: {
        Row: {
          id: string
          profile_id: string
          trip_id: string | null
          segment_id: string | null
          kind: DisruptionKind
          severity: DisruptionSeverity
          headline: string
          detail: string | null
          reported_at: string
          resolved_at: string | null
          delay_minutes: number | null
          original_departure_at: string | null
          original_arrival_at: string | null
          revised_departure_at: string | null
          revised_arrival_at: string | null
          cancellation_at: string | null
          provider_event_reference: string | null
          source: DisruptionSource
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id?: string | null
          segment_id?: string | null
          kind: DisruptionKind
          severity?: DisruptionSeverity
          headline: string
          detail?: string | null
          reported_at?: string
          resolved_at?: string | null
          delay_minutes?: number | null
          original_departure_at?: string | null
          original_arrival_at?: string | null
          revised_departure_at?: string | null
          revised_arrival_at?: string | null
          cancellation_at?: string | null
          provider_event_reference?: string | null
          source?: DisruptionSource
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          trip_id?: string | null
          segment_id?: string | null
          kind?: DisruptionKind
          severity?: DisruptionSeverity
          headline?: string
          detail?: string | null
          reported_at?: string
          resolved_at?: string | null
          delay_minutes?: number | null
          original_departure_at?: string | null
          original_arrival_at?: string | null
          revised_departure_at?: string | null
          revised_arrival_at?: string | null
          cancellation_at?: string | null
          provider_event_reference?: string | null
          source?: DisruptionSource
          updated_at?: string
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

      journey_segments: {
        Row: {
          id: string
          trip_id: string
          seq: number
          origin: string | null
          destination: string | null
          departure_at: string | null
          arrival_at: string | null
          transport_mode: TransportMode | null
          operator_name: string | null
          service_number: string | null
          service_number_source: 'booking_import' | 'railradar' | 'manual_clarification' | null
          booking_reference: string | null
          pnr: string | null
          seat: string | null
          coach: string | null
          terminal: string | null
          ticket_number: string | null
          created_at: string
          updated_at: string
          // Trip hierarchy, added by 0004_trip_hierarchy.sql
          document_id: string | null
          passenger_name: string | null
          fare_amount: number | null
          fare_currency: string | null
          booking_status: string | null
          source: JourneySource
          confidence: number | null
          field_provenance: Json | null
          import_payload: Json | null
          status: TripStatus
          connection_minutes: number | null
          needs_review: boolean
          review_note: string | null
          sequence_confirmed: boolean
          passenger_travel_status: PassengerTravelStatus
        }
        Insert: {
          id?: string
          trip_id: string
          seq?: number
          origin?: string | null
          destination?: string | null
          departure_at?: string | null
          arrival_at?: string | null
          transport_mode?: TransportMode | null
          operator_name?: string | null
          service_number?: string | null
          service_number_source?: 'booking_import' | 'railradar' | 'manual_clarification' | null
          booking_reference?: string | null
          pnr?: string | null
          seat?: string | null
          coach?: string | null
          terminal?: string | null
          ticket_number?: string | null
          created_at?: string
          updated_at?: string
          document_id?: string | null
          passenger_name?: string | null
          fare_amount?: number | null
          fare_currency?: string | null
          booking_status?: string | null
          source?: JourneySource
          confidence?: number | null
          field_provenance?: Json | null
          import_payload?: Json | null
          status?: TripStatus
          connection_minutes?: number | null
          needs_review?: boolean
          review_note?: string | null
          sequence_confirmed?: boolean
          passenger_travel_status?: PassengerTravelStatus
        }
        Update: {
          id?: string
          trip_id?: string
          seq?: number
          origin?: string | null
          destination?: string | null
          departure_at?: string | null
          arrival_at?: string | null
          transport_mode?: TransportMode | null
          operator_name?: string | null
          service_number?: string | null
          service_number_source?: 'booking_import' | 'railradar' | 'manual_clarification' | null
          booking_reference?: string | null
          pnr?: string | null
          seat?: string | null
          coach?: string | null
          terminal?: string | null
          ticket_number?: string | null
          updated_at?: string
          document_id?: string | null
          passenger_name?: string | null
          fare_amount?: number | null
          fare_currency?: string | null
          booking_status?: string | null
          source?: JourneySource
          confidence?: number | null
          field_provenance?: Json | null
          import_payload?: Json | null
          status?: TripStatus
          connection_minutes?: number | null
          needs_review?: boolean
          review_note?: string | null
          sequence_confirmed?: boolean
          passenger_travel_status?: PassengerTravelStatus
        }
        Relationships: []
      }

      journey_documents: {
        Row: {
          id: string
          profile_id: string
          trip_id: string | null
          storage_path: string
          file_name: string
          mime_type: string
          byte_size: number | null
          origin: 'upload' | 'gmail'
          gmail_message_id: string | null
          gmail_attachment_id: string | null
          extraction_status: 'pending' | 'processed' | 'unreadable' | 'no_travel_data'
          extracted: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id?: string | null
          storage_path: string
          file_name: string
          mime_type: string
          byte_size?: number | null
          origin?: 'upload' | 'gmail'
          gmail_message_id?: string | null
          gmail_attachment_id?: string | null
          extraction_status?: 'pending' | 'processed' | 'unreadable' | 'no_travel_data'
          extracted?: Json | null
          created_at?: string
        }
        Update: {
          trip_id?: string | null
          extraction_status?: 'pending' | 'processed' | 'unreadable' | 'no_travel_data'
          extracted?: Json | null
        }
        Relationships: []
      }

      gmail_connections: {
        Row: {
          profile_id: string
          gmail_address: string | null
          scopes: string | null
          status: 'connected' | 'error' | 'revoked'
          refresh_token: string | null
          access_token: string | null
          token_expires_at: string | null
          last_synced_at: string | null
          created_at: string
          updated_at: string
        }
        /**
         * The browser is granted only `gmail_address`, `scopes`, `status`,
         * `last_synced_at` and the timestamps. The token columns are written
         * exclusively by the Edge Function using the service role, so a refresh
         * token can never reach the client.
         */
        Insert: {
          profile_id: string
          gmail_address?: string | null
          scopes?: string | null
          status?: 'connected' | 'error' | 'revoked'
          refresh_token?: string | null
          access_token?: string | null
          token_expires_at?: string | null
          last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          gmail_address?: string | null
          scopes?: string | null
          status?: 'connected' | 'error' | 'revoked'
          refresh_token?: string | null
          access_token?: string | null
          token_expires_at?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      refund_policies: {
        Row: {
          id: string
          transport_mode: TransportMode
          provider: string
          policy_name: string
          policy_version: string
          effective_from: string
          effective_until: string | null
          policy_source: string
          policy_status: 'draft' | 'active' | 'retired'
          amount_type: 'full_fare' | 'partial_fare' | 'fixed' | 'calculated' | 'unknown'
          amount_value: number | null
          amount_percentage: number | null
          amount_currency: string | null
          claim_deadline_days: number | null
          required_evidence: Json
          policy_summary: string
          applicable_disruption_types: Json
          eligibility_conditions: Json
          exclusions: Json
          claim_method: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          transport_mode: TransportMode
          provider: string
          policy_name: string
          policy_version: string
          effective_from: string
          effective_until?: string | null
          policy_source: string
          policy_status?: 'draft' | 'active' | 'retired'
          amount_type?: 'full_fare' | 'partial_fare' | 'fixed' | 'calculated' | 'unknown'
          amount_value?: number | null
          amount_percentage?: number | null
          amount_currency?: string | null
          claim_deadline_days?: number | null
          required_evidence?: Json
          policy_summary?: string
          applicable_disruption_types?: Json
          eligibility_conditions?: Json
          exclusions?: Json
          claim_method?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          transport_mode?: TransportMode
          provider?: string
          policy_name?: string
          policy_version?: string
          effective_from?: string
          effective_until?: string | null
          policy_source?: string
          policy_status?: 'draft' | 'active' | 'retired'
          amount_type?: 'full_fare' | 'partial_fare' | 'fixed' | 'calculated' | 'unknown'
          amount_value?: number | null
          amount_percentage?: number | null
          amount_currency?: string | null
          claim_deadline_days?: number | null
          required_evidence?: Json
          policy_summary?: string
          applicable_disruption_types?: Json
          eligibility_conditions?: Json
          exclusions?: Json
          claim_method?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      refund_policy_rules: {
        Row: {
          id: string
          policy_id: string
          rule_order: number
          condition_type: string
          operator: string
          value_text: string | null
          value_number: number | null
          value_json: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          policy_id: string
          rule_order: number
          condition_type: string
          operator: string
          value_text?: string | null
          value_number?: number | null
          value_json?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          policy_id?: string
          rule_order?: number
          condition_type?: string
          operator?: string
          value_text?: string | null
          value_number?: number | null
          value_json?: Json | null
        }
        Relationships: []
      }
      refund_eligibility_results: {
        Row: {
          id: string
          profile_id: string
          trip_id: string
          segment_id: string
          disruption_id: string | null
          policy_id: string | null
          policy_name: string | null
          policy_provider: string | null
          policy_version: string | null
          policy_source: string | null
          policy_effective_from: string | null
          eligibility_status: 'eligible' | 'potentially_eligible' | 'not_eligible' | 'insufficient_information'
          reason: string
          eligible_amount: number | null
          currency: string | null
          missing_information: Json
          required_evidence: Json
          available_evidence: Json
          missing_evidence: Json
          evaluation_inputs: Json
          evaluated_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id: string
          segment_id: string
          disruption_id?: string | null
          policy_id?: string | null
          policy_name?: string | null
          policy_provider?: string | null
          policy_version?: string | null
          policy_source?: string | null
          policy_effective_from?: string | null
          eligibility_status: 'eligible' | 'potentially_eligible' | 'not_eligible' | 'insufficient_information'
          reason: string
          eligible_amount?: number | null
          currency?: string | null
          missing_information?: Json
          required_evidence?: Json
          available_evidence?: Json
          missing_evidence?: Json
          evaluation_inputs?: Json
          evaluated_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          policy_id?: string | null
          policy_name?: string | null
          policy_provider?: string | null
          policy_version?: string | null
          policy_source?: string | null
          policy_effective_from?: string | null
          eligibility_status?: 'eligible' | 'potentially_eligible' | 'not_eligible' | 'insufficient_information'
          reason?: string
          eligible_amount?: number | null
          currency?: string | null
          missing_information?: Json
          required_evidence?: Json
          available_evidence?: Json
          missing_evidence?: Json
          evaluation_inputs?: Json
          evaluated_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      railradar_monitoring_state: {
        Row: {
          segment_id: string
          trip_id: string
          profile_id: string
          train_number: string | null
          provider: string
          monitoring_status: 'monitoring' | 'monitoring_unavailable' | 'provider_unavailable' | 'stale'
          checked_at: string
          provider_timestamp: string | null
          previous_status: Json | null
          operational_status: Json | null
          operational_fingerprint: string | null
          current_disruption_id: string | null
          last_error: string | null
          identification_status: 'not_attempted' | 'identifying' | 'identified' | 'ambiguous' | 'not_found' | 'unavailable'
          identification_candidates: Json
        }
        Insert: {
          segment_id: string
          trip_id: string
          profile_id: string
          train_number?: string | null
          provider?: string
          monitoring_status: 'monitoring' | 'monitoring_unavailable' | 'provider_unavailable' | 'stale'
          checked_at?: string
          provider_timestamp?: string | null
          previous_status?: Json | null
          operational_status?: Json | null
          operational_fingerprint?: string | null
          current_disruption_id?: string | null
          last_error?: string | null
          identification_status?: 'not_attempted' | 'identifying' | 'identified' | 'ambiguous' | 'not_found' | 'unavailable'
          identification_candidates?: Json
        }
        Update: {
          monitoring_status?: 'monitoring' | 'monitoring_unavailable' | 'provider_unavailable' | 'stale'
          checked_at?: string
          provider_timestamp?: string | null
          previous_status?: Json | null
          operational_status?: Json | null
          operational_fingerprint?: string | null
          current_disruption_id?: string | null
          last_error?: string | null
          identification_status?: 'not_attempted' | 'identifying' | 'identified' | 'ambiguous' | 'not_found' | 'unavailable'
          identification_candidates?: Json
        }
        Relationships: []
      }
      journey_notifications: {
        Row: {
          id: string
          profile_id: string
          trip_id: string
          segment_id: string
          disruption_id: string
          notification_type: string
          headline: string
          detail: string
          operational_fingerprint: string
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          trip_id: string
          segment_id: string
          disruption_id: string
          notification_type: string
          headline: string
          detail: string
          operational_fingerprint: string
          created_at?: string
          read_at?: string | null
        }
        Update: {
          read_at?: string | null
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

export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']
export type Trip = Database['public']['Tables']['trips']['Row']
export type TripInsert = Database['public']['Tables']['trips']['Insert']
export type TripUpdate = Database['public']['Tables']['trips']['Update']
export type Disruption = Database['public']['Tables']['disruptions']['Row']
export type DisruptionInsert = Database['public']['Tables']['disruptions']['Insert']
export type DisruptionUpdate = Database['public']['Tables']['disruptions']['Update']
export type RecoveryPlan = Database['public']['Tables']['recovery_plans']['Row']
export type JourneySegment = Database['public']['Tables']['journey_segments']['Row']
export type JourneySegmentInsert = Database['public']['Tables']['journey_segments']['Insert']
export type JourneySegmentUpdate = Database['public']['Tables']['journey_segments']['Update']
export type JourneyDocument = Database['public']['Tables']['journey_documents']['Row']
export type RefundPolicy = Database['public']['Tables']['refund_policies']['Row']
export type RefundPolicyRule = Database['public']['Tables']['refund_policy_rules']['Row']
export type RefundEligibilityResult = Database['public']['Tables']['refund_eligibility_results']['Row']
export type RailRadarMonitoringState = Database['public']['Tables']['railradar_monitoring_state']['Row']
export type JourneyNotification = Database['public']['Tables']['journey_notifications']['Row']

/** The columns the app selects for a trip. */
export const TRIP_COLUMNS =
  'id, profile_id, title, origin, destination, status, starts_on, ends_on, created_at, updated_at, transport_mode, operator_name, service_number, departure_at, arrival_at, booking_reference, pnr, ticket_number, passenger_name, seat, coach, terminal, fare_amount, fare_currency, booking_status, source, field_provenance, import_payload, itinerary_built_at, segment_count'

/** Everything the itinerary builder needs to order a trip's bookings. */
export const SEGMENT_COLUMNS =
  'id, trip_id, seq, origin, destination, departure_at, arrival_at, transport_mode, operator_name, service_number, service_number_source, booking_reference, pnr, passenger_name, seat, coach, terminal, fare_amount, fare_currency, booking_status, source, confidence, status, connection_minutes, needs_review, review_note, sequence_confirmed, passenger_travel_status, document_id'
