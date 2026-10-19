/**
 * Insertable DB rows. Keys are the exact snake_case column names from the schema
 * (supabase/migrations), so generated data can be inserted without mapping.
 * Columns with DB defaults that the sim doesn't need (e.g. venues.created_at) are omitted.
 */

export type SessionStatus = 'open' | 'matched' | 'closed';
export type BookingStatus = 'confirmed' | 'cancelled' | 'attended' | 'no_show';
export type BookingSource = 'matched' | 'waitlist';
export type WaitlistStatus = 'waiting' | 'offered' | 'promoted' | 'expired' | 'withdrawn';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface VenueRow {
  id: string;
  name: string;
  timezone: string;
  skin: string;
  offer_ttl_seconds: number;
  owner_id: string;
  is_demo: boolean;
  expires_at: string | null;
}

export interface VenueTableRow {
  id: string;
  venue_id: string;
  name: string;
  capacity: number;
  x: number;
  y: number;
}

export interface GameRow {
  id: string;
  venue_id: string;
  name: string;
  min_players: number;
  max_players: number;
  duration_min: number;
  popularity: number;
}

export interface PlayerRow {
  id: string;
  venue_id: string;
  user_id: string | null;
  name: string;
  phone: string;
  skill: number;
  sms_opt_in: boolean;
}

export interface PlayerGameRow {
  venue_id: string;
  player_id: string;
  game_id: string;
  rank: number;
}

export interface AvailabilityRow {
  id: string;
  venue_id: string;
  player_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface SessionRow {
  id: string;
  venue_id: string;
  starts_at: string;
  ends_at: string;
  seat_price_cents: number;
  status: SessionStatus;
}

export interface SeatRequestRow {
  id: string;
  venue_id: string;
  session_id: string;
  player_id: string;
  priority: number;
  created_at: string;
}

export interface GroupRow {
  id: string;
  venue_id: string;
  session_id: string;
  table_id: string;
  game_id: string;
  capacity: number;
}

export interface BookingRow {
  id: string;
  venue_id: string;
  session_id: string;
  group_id: string;
  player_id: string;
  seat_no: number;
  status: BookingStatus;
  source: BookingSource;
  price_cents: number;
  created_at: string;
  cancelled_at: string | null;
}

export interface WaitlistEntryRow {
  id: string;
  venue_id: string;
  session_id: string;
  player_id: string;
  priority: number;
  queue_position: number;
  status: WaitlistStatus;
  created_at: string;
}

export interface SeatOfferRow {
  id: string;
  venue_id: string;
  group_id: string;
  seat_no: number;
  waitlist_entry_id: string;
  status: OfferStatus;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
}

export interface MessageRow {
  id: string;
  venue_id: string;
  player_id: string | null;
  direction: 'outbound' | 'inbound';
  body: string;
  provider: 'simulated' | 'twilio';
  provider_sid: string | null;
  status: string;
  created_at: string;
}

export interface EventRow {
  id: string;
  venue_id: string;
  session_id: string | null;
  type: 'booking_cancelled' | 'offer_created' | 'offer_accepted' | 'offer_declined' | 'offer_expired' | 'seat_filled';
  payload: Record<string, unknown>;
  created_at: string;
}
