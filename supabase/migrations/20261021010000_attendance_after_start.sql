-- Stage B1 review fix: attendance can only be marked once a booking has started.
--
-- Marking next Friday's booking "no_show" by mistake made it uncancellable (only confirmed bookings
-- can be cancelled), kept the pitch reserved, and moved it to the player's past list without telling
-- them. Now a booking that hasn't started answers `not_started` and stays confirmed.

create or replace function public.set_resource_booking_status(p_booking_id uuid, p_status public.resource_booking_status)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.resource_bookings;
begin
  select * into v_booking from public.resource_bookings where id = p_booking_id for update;
  if not found then
    return 'not_found';
  end if;
  if p_status not in ('attended', 'no_show') or v_booking.status <> 'confirmed' then
    return 'invalid';
  end if;
  if lower(v_booking.period) > now() then
    return 'not_started';
  end if;
  update public.resource_bookings set status = p_status where id = p_booking_id;
  return 'updated';
end;
$$;
