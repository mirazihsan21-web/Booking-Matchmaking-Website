-- Booking & matchmaking schema.
-- Every venue-scoped table carries venue_id so RLS policies and Realtime filters can use it directly.
-- Seat invariants (one live booking per seat / per player per session, one pending offer per seat)
-- are partial unique indexes, so concurrent writers cannot break them.

create type public.session_status as enum ('open', 'matched', 'closed');
create type public.booking_status as enum ('confirmed', 'cancelled', 'attended', 'no_show');
create type public.booking_source as enum ('matched', 'waitlist');
create type public.waitlist_status as enum ('waiting', 'offered', 'promoted', 'expired', 'withdrawn');
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired');
create type public.message_direction as enum ('outbound', 'inbound');

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/London',
  skin text not null default 'boardgame',
  offer_ttl_seconds int not null default 900 check (offer_ttl_seconds > 0),
  owner_id uuid not null references auth.users (id) on delete cascade,
  is_demo boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index venues_owner_id_idx on public.venues (owner_id);

create table public.venue_tables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  capacity smallint not null check (capacity between 1 and 20),
  x real not null default 0,
  y real not null default 0
);
create index venue_tables_venue_id_idx on public.venue_tables (venue_id);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  min_players smallint not null check (min_players >= 1),
  max_players smallint not null,
  duration_min smallint not null check (duration_min > 0),
  popularity real not null default 1 check (popularity > 0),
  check (min_players <= max_players)
);
create index games_venue_id_idx on public.games (venue_id);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  skill smallint not null check (skill between 1 and 5),
  sms_opt_in boolean not null default true,
  created_at timestamptz not null default now(),
  unique (venue_id, phone),
  unique (venue_id, user_id)
);
create index players_user_id_idx on public.players (user_id);

create table public.player_games (
  venue_id uuid not null references public.venues (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  rank smallint not null check (rank >= 1),
  primary key (player_id, game_id),
  unique (player_id, rank)
);
create index player_games_venue_id_idx on public.player_games (venue_id);
create index player_games_game_id_idx on public.player_games (game_id);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);
create index availability_venue_id_idx on public.availability (venue_id);
create index availability_player_id_idx on public.availability (player_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  seat_price_cents int not null check (seat_price_cents >= 0),
  status public.session_status not null default 'open',
  check (starts_at < ends_at)
);
create index sessions_venue_id_starts_at_idx on public.sessions (venue_id, starts_at);

create table public.seat_requests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, player_id)
);
create index seat_requests_venue_id_idx on public.seat_requests (venue_id);
create index seat_requests_player_id_idx on public.seat_requests (player_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  table_id uuid not null references public.venue_tables (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  capacity smallint not null check (capacity > 0),
  unique (session_id, table_id)
);
create index groups_venue_id_idx on public.groups (venue_id);
create index groups_table_id_idx on public.groups (table_id);
create index groups_game_id_idx on public.groups (game_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  seat_no smallint not null check (seat_no >= 1),
  status public.booking_status not null default 'confirmed',
  source public.booking_source not null default 'matched',
  price_cents int not null check (price_cents >= 0),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index bookings_live_player_per_session_key
  on public.bookings (session_id, player_id) where status <> 'cancelled';
create unique index bookings_live_seat_key
  on public.bookings (group_id, seat_no) where status <> 'cancelled';
create index bookings_venue_id_idx on public.bookings (venue_id);
create index bookings_session_id_idx on public.bookings (session_id);
create index bookings_group_id_idx on public.bookings (group_id);
create index bookings_player_id_idx on public.bookings (player_id);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  priority smallint not null default 0,
  queue_position int not null check (queue_position >= 1),
  status public.waitlist_status not null default 'waiting',
  created_at timestamptz not null default now(),
  unique (session_id, player_id)
);
create index waitlist_entries_venue_id_idx on public.waitlist_entries (venue_id);
create index waitlist_entries_player_id_idx on public.waitlist_entries (player_id);

create table public.seat_offers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  seat_no smallint not null check (seat_no >= 1),
  waitlist_entry_id uuid not null references public.waitlist_entries (id) on delete cascade,
  status public.offer_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index seat_offers_one_pending_per_seat_key
  on public.seat_offers (group_id, seat_no) where status = 'pending';
create index seat_offers_venue_id_idx on public.seat_offers (venue_id);
create index seat_offers_group_id_idx on public.seat_offers (group_id);
create index seat_offers_waitlist_entry_id_idx on public.seat_offers (waitlist_entry_id);
create index seat_offers_status_expires_at_idx on public.seat_offers (status, expires_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  direction public.message_direction not null,
  body text not null,
  provider text not null check (provider in ('simulated', 'twilio')),
  provider_sid text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);
create index messages_venue_id_created_at_idx on public.messages (venue_id, created_at);
create index messages_player_id_idx on public.messages (player_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_venue_id_created_at_idx on public.events (venue_id, created_at);
create index events_session_id_idx on public.events (session_id);
