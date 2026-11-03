-- Paying for online bookings by bKash or Nagad (spec 2026-11-04-mobile-money-booking-design §4.1–4.2).
-- A player's online booking of a priced space is `pending`: it holds its slot (its resource_reservations row, as
-- every booking) for 15 minutes (`hold_until`) while they Send Money to the brand's number and type in the
-- transaction ID (a payment claim); then until the team confirms or rejects it.

-- The brand's numbers (11-digit Bangladeshi mobile numbers), shown to players on the payment page.
alter table public.organizations
  add column bkash_number text check (bkash_number ~ '^01[3-9][0-9]{8}$'),
  add column nagad_number text check (nagad_number ~ '^01[3-9][0-9]{8}$');

-- Set while a pending booking waits for the player's payment details; cleared when they send them.
alter table public.resource_bookings add column hold_until timestamptz;
create index resource_bookings_hold_until_idx on public.resource_bookings (hold_until) where hold_until is not null;

-- Payments: cash at the desk, or bKash / Nagad confirmed by the team (with the transaction ID).
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash', 'bkash', 'nagad'));
alter table public.payments add column reference text;
alter table public.payments add constraint payments_reference_check check ((method = 'cash') = (reference is null));

-- What a player sent for one booking. The transaction ID is stored upper-case without spaces and is used once
-- per brand. Written only by the database's own functions (service role).
create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  booking_id uuid not null,
  method text not null check (method in ('bkash', 'nagad')),
  sender_phone text not null check (sender_phone ~ '^01[3-9][0-9]{8}$'),
  trx_id text not null check (trx_id ~ '^[A-Z0-9]{6,20}$'),
  amount_poisha integer not null check (amount_poisha > 0 and amount_poisha <= 10000000),
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 200),
  constraint payment_claims_booking_id_key unique (booking_id),
  constraint payment_claims_trx_id_key unique (organization_id, trx_id),
  constraint payment_claims_booking_id_fkey foreign key (booking_id, organization_id)
    references public.resource_bookings (id, organization_id) on delete cascade
);
create index payment_claims_decided_by_idx on public.payment_claims (decided_by);
create index payment_claims_to_check_idx on public.payment_claims (organization_id, submitted_at) where status = 'submitted';

-- The booking's own player, or the team for the booking's section (owners run every section).
create function private.can_see_payment_claim(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.resource_bookings b
    join public.resources r on r.id = b.resource_id
    where b.id = p_booking
      and ((select private.is_own_profile(b.profile_id, b.organization_id)) or (select private.is_section_staff(r.section_id)))
  )
$$;
revoke execute on function private.can_see_payment_claim(uuid) from public, anon;
grant execute on function private.can_see_payment_claim(uuid) to authenticated, service_role;

alter table public.payment_claims enable row level security;
revoke all on public.payment_claims from anon, authenticated;
grant select on public.payment_claims to authenticated;
create policy payment_claims_select on public.payment_claims for select to authenticated
  using ((select private.can_see_payment_claim(booking_id)));
