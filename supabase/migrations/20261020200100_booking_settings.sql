-- Stage B1: venue booking settings and slot length (spec §2.2–2.3).
--
-- Matching must happen before the cancellation cut-off, otherwise nobody could cancel online after
-- matching and the waitlist would never refill a seat (spec §1, rule 1).

alter table public.organizations
  add column booking_horizon_days smallint not null default 14 check (booking_horizon_days between 1 and 90),
  add column cancel_cutoff_minutes int not null default 120 check (cancel_cutoff_minutes between 0 and 10080),
  add column match_cutoff_minutes int not null default 360 check (match_cutoff_minutes between 0 and 10080),
  add column max_upcoming_bookings smallint not null default 3 check (max_upcoming_bookings between 1 and 20),
  add constraint organizations_cutoffs_check check (match_cutoff_minutes > cancel_cutoff_minutes);

-- Owners edit these in Settings (RLS limits organization updates to owners).
grant update (booking_horizon_days, cancel_cutoff_minutes, match_cutoff_minutes, max_upcoming_bookings)
  on public.organizations to authenticated;

alter table public.resources
  add column slot_minutes smallint not null default 60
    check (slot_minutes between 15 and 240 and slot_minutes % 15 = 0);

-- Café tables are booked for longer sittings (matches the presets).
update public.resources set slot_minutes = 120 where kind = 'table';
