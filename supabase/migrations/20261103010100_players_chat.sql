-- Players chat (stage C1, spec docs/superpowers/specs/2026-11-02-players-chat-design.md §10.1–10.2).
-- One live room per brand with "Need players" cards. Signed-in people read the room; the browser writes only its
-- own read marker — every other write goes through the server and the SQL functions of the next migrations.

create type public.chat_author_kind as enum ('player', 'team');
create type public.chat_message_state as enum ('visible', 'removed_by_author', 'removed_by_venue', 'hidden_by_reports');
create type public.chat_card_kind as enum ('booking', 'session');
create type public.chat_card_status as enum ('open', 'full', 'closed', 'cancelled', 'started');
create type public.chat_join_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'left', 'removed', 'expired');
create type public.chat_report_reason as enum ('spam', 'abuse', 'photo', 'other');
create type public.chat_report_status as enum ('open', 'removed', 'dismissed');

-- A "Need players" card: for the poster's own booking (spots to fill, I'm in → Accept) or for an open-play session
-- (seats; "Get a seat" goes to the session page). What it shows is snapshotted, so a live update carries it whole.
create table public.chat_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.chat_card_kind not null,
  resource_booking_id uuid,
  session_id uuid,
  poster_user_id uuid not null references auth.users (id) on delete cascade,
  poster_profile_id uuid,
  poster_name text not null,
  section_id uuid not null,
  section_name text not null,
  section_kind public.business_type not null,
  section_accent text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  seat_price_poisha int check (seat_price_poisha is null or seat_price_poisha >= 0),
  spots_needed smallint check (spots_needed is null or spots_needed between 1 and 20),
  spots_taken smallint not null default 0 check (spots_taken >= 0 and (spots_needed is null or spots_taken <= spots_needed)),
  note text check (note is null or char_length(note) <= 200),
  status public.chat_card_status not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, organization_id),
  check ((kind = 'booking') = (resource_booking_id is not null) and (kind = 'session') = (session_id is not null)),
  check (kind = 'session' or (spots_needed is not null and poster_profile_id is not null)),
  constraint chat_cards_resource_booking_id_fkey foreign key (resource_booking_id, organization_id)
    references public.resource_bookings (id, organization_id) on delete cascade,
  constraint chat_cards_session_id_fkey foreign key (session_id, organization_id)
    references public.open_play_sessions (id, organization_id) on delete cascade,
  constraint chat_cards_poster_profile_id_fkey foreign key (poster_profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade,
  constraint chat_cards_section_id_fkey foreign key (section_id, organization_id)
    references public.sections (id, organization_id) on delete cascade
);
create unique index chat_cards_one_active_per_booking on public.chat_cards (resource_booking_id) where status in ('open', 'full');
create unique index chat_cards_one_open_per_session_poster on public.chat_cards (session_id, poster_user_id) where status = 'open';
create index chat_cards_organization_id_status_starts_at_idx on public.chat_cards (organization_id, status, starts_at);
create index chat_cards_resource_booking_id_idx on public.chat_cards (resource_booking_id);
create index chat_cards_session_id_idx on public.chat_cards (session_id);
create index chat_cards_poster_profile_id_idx on public.chat_cards (poster_profile_id);
create index chat_cards_poster_user_id_idx on public.chat_cards (poster_user_id);
create index chat_cards_section_id_idx on public.chat_cards (section_id);

-- A message in the room. The sender's name is a snapshot (team messages carry the brand's name); a removed or
-- hidden message keeps its row but loses its text (moved to chat_message_archive, which only the team reads).
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  author_profile_id uuid,
  author_kind public.chat_author_kind not null,
  author_name text not null,
  body text check (body is null or char_length(body) between 1 and 500),
  card_id uuid,
  state public.chat_message_state not null default 'visible',
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((author_kind = 'team') = (author_profile_id is null)),
  check (state <> 'visible' or body is not null or card_id is not null),
  constraint chat_messages_author_profile_id_fkey foreign key (author_profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade,
  constraint chat_messages_card_id_fkey foreign key (card_id, organization_id)
    references public.chat_cards (id, organization_id) on delete cascade
);
create index chat_messages_organization_id_created_at_idx on public.chat_messages (organization_id, created_at desc);
create index chat_messages_author_user_id_created_at_idx on public.chat_messages (author_user_id, created_at desc);
create index chat_messages_author_profile_id_idx on public.chat_messages (author_profile_id);
create index chat_messages_card_id_idx on public.chat_messages (card_id);

create table public.chat_message_archive (
  message_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  body text,
  archived_at timestamptz not null default now(),
  constraint chat_message_archive_message_id_fkey foreign key (message_id, organization_id)
    references public.chat_messages (id, organization_id) on delete cascade
);
create index chat_message_archive_organization_id_idx on public.chat_message_archive (organization_id);

create table public.chat_join_requests (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  card_id uuid not null,
  profile_id uuid not null,
  status public.chat_join_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (card_id, profile_id),
  constraint chat_join_requests_card_id_fkey foreign key (card_id, organization_id)
    references public.chat_cards (id, organization_id) on delete cascade,
  constraint chat_join_requests_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_join_requests_profile_id_status_idx on public.chat_join_requests (profile_id, status);
create index chat_join_requests_organization_id_idx on public.chat_join_requests (organization_id);

-- A mute is active while `until` is null (until unmuted) or still ahead.
create table public.chat_mutes (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null,
  until timestamptz,
  muted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, profile_id),
  constraint chat_mutes_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_mutes_profile_id_idx on public.chat_mutes (profile_id);
create index chat_mutes_muted_by_idx on public.chat_mutes (muted_by);

-- A report keeps its own copy of what was reported, so the team can judge it even after the sender removes it.
create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid not null,
  reporter_profile_id uuid not null,
  reason public.chat_report_reason not null,
  note text check (note is null or char_length(note) <= 200),
  body_copy text,
  author_name_copy text not null,
  status public.chat_report_status not null default 'open',
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_profile_id),
  constraint chat_reports_message_id_fkey foreign key (message_id, organization_id)
    references public.chat_messages (id, organization_id) on delete cascade,
  constraint chat_reports_reporter_profile_id_fkey foreign key (reporter_profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_reports_organization_id_status_idx on public.chat_reports (organization_id, status);
create index chat_reports_reporter_profile_id_created_at_idx on public.chat_reports (reporter_profile_id, created_at);
create index chat_reports_resolved_by_idx on public.chat_reports (resolved_by);

create table public.chat_blocked_words (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  word text not null check (char_length(word) between 2 and 40 and word = lower(word)),
  primary key (organization_id, word)
);

-- Where each person has read the room up to (the Chat link's dot). The browser writes its own row.
create table public.chat_reads (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  room_read_at timestamptz not null,
  primary key (organization_id, user_id)
);
create index chat_reads_user_id_idx on public.chat_reads (user_id);

alter table public.chat_cards enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_archive enable row level security;
alter table public.chat_join_requests enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_blocked_words enable row level security;
alter table public.chat_reads enable row level security;

create policy chat_cards_select on public.chat_cards for select to authenticated
  using ((select private.org_is_live(organization_id)));
create policy chat_messages_select on public.chat_messages for select to authenticated
  using ((select private.org_is_live(organization_id)));
create policy chat_join_requests_select on public.chat_join_requests for select to authenticated
  using (
    (select private.is_own_profile(profile_id, organization_id))
    or exists (select 1 from public.chat_cards c where c.id = card_id and c.poster_user_id = (select auth.uid()))
  );
create policy chat_message_archive_select on public.chat_message_archive for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy chat_reports_select on public.chat_reports for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy chat_blocked_words_select on public.chat_blocked_words for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy chat_mutes_select on public.chat_mutes for select to authenticated
  using ((select private.is_org_member(organization_id)) or (select private.is_own_profile(profile_id, organization_id)));
create policy chat_reads_select on public.chat_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy chat_reads_insert on public.chat_reads for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy chat_reads_update on public.chat_reads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select on public.chat_cards, public.chat_messages, public.chat_message_archive, public.chat_join_requests,
  public.chat_mutes, public.chat_reports, public.chat_blocked_words to authenticated;
grant select, insert, update on public.chat_reads to authenticated;
grant select, insert, update, delete on public.chat_cards, public.chat_messages, public.chat_message_archive,
  public.chat_join_requests, public.chat_mutes, public.chat_reports, public.chat_blocked_words, public.chat_reads to service_role;

alter publication supabase_realtime add table public.chat_messages, public.chat_cards;
