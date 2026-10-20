-- Stage B1: notifications, the outbox (spec §2.6). Replaces M1's SMS-shaped `messages`.
--
-- A notification is written in the same SQL function as the state change it reports, so a booking
-- can't exist without its notification. The in-app bell reads rows live through Realtime; the job
-- tick delivers `email_status = 'pending'` rows by email. Payloads carry ids, times and venue data
-- (names) — the app renders the words from apps/web/messages, so a Bangla file can come later.

drop table public.messages;
drop type public.message_direction;

create type public.notification_kind as enum (
  'booking_confirmed', 'booking_cancelled',
  -- open play (Stage B2)
  'seat_confirmed', 'waitlisted', 'offer', 'offer_expired', 'seat_cancelled', 'session_cancelled', 'no_seat'
);
create type public.email_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null,
  kind public.notification_kind not null,
  payload jsonb not null default '{}',
  link text not null,
  read_at timestamptz,
  email_status public.email_status not null default 'pending',
  email_attempts smallint not null default 0,
  email_claimed_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index notifications_organization_id_idx on public.notifications (organization_id);
-- Leads with profile_id for the composite FK and serves the inbox (newest first).
create index notifications_profile_id_idx on public.notifications (profile_id, organization_id, created_at desc);
create index notifications_email_pending_idx on public.notifications (created_at) where email_status = 'pending';

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)));
create policy notifications_update on public.notifications for update to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)))
  with check ((select private.is_own_profile(profile_id, organization_id)));

alter publication supabase_realtime add table public.notifications;
