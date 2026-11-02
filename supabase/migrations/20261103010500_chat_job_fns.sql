-- Players chat (stage C1): the every-minute job's chat work (spec §10.6). Cards close when their booking or session
-- is cancelled (accepted and waiting players hear it) or when the game starts (quietly); session cards with no seats
-- left close as full (the app counts seats); and the chat is kept for 30 days.

create function public.close_due_chat_cards()
returns table (card_id uuid, outcome text)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_due record;
begin
  for v_due in
    select c.id, c.organization_id, (rb.status = 'cancelled' or os.status = 'cancelled') is true as cancelled
    from public.chat_cards c
    left join public.resource_bookings rb on rb.id = c.resource_booking_id
    left join public.open_play_sessions os on os.id = c.session_id
    where c.status in ('open', 'full') and (c.starts_at <= now() or rb.status = 'cancelled' or os.status = 'cancelled')
    order by c.starts_at
    limit 200
    for update of c skip locked
  loop
    if v_due.cancelled then
      insert into public.notifications (organization_id, profile_id, kind, payload, link)
      select v_due.organization_id, r.profile_id, 'chat_game_cancelled', private.chat_card_payload(c), '/chat/games/' || c.id
      from public.chat_join_requests r
      join public.chat_cards c on c.id = r.card_id
      where r.card_id = v_due.id and r.status in ('accepted', 'pending');
      perform private.close_card(v_due.id, 'cancelled', false);
      card_id := v_due.id;
      outcome := 'cancelled';
    else
      perform private.close_card(v_due.id, 'started', false);
      card_id := v_due.id;
      outcome := 'started';
    end if;
    return next;
  end loop;
end;
$$;

-- The open session cards of sessions with no seats left (the app works the seats out) now show full.
create function public.close_session_cards(p_session_ids uuid[])
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_count int;
begin
  update public.chat_cards set status = 'full'
  where kind = 'session' and status = 'open' and session_id = any (p_session_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Deletes what the chat no longer keeps: messages after 30 days (their archived text goes with them), cards 30 days
-- after their game (with their requests and room message), resolved reports and ended mutes after 30 days.
-- Returns the storage paths of photos to delete; stage C1 has no photos, so it returns none.
create function public.purge_chat(p_now timestamptz default now())
returns setof text
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.chat_messages where created_at < p_now - interval '30 days';
  delete from public.chat_cards where ends_at < p_now - interval '30 days';
  delete from public.chat_reports where status <> 'open' and resolved_at < p_now - interval '30 days';
  delete from public.chat_mutes where until is not null and until < p_now - interval '30 days';
  return;
end;
$$;

revoke execute on function
  public.close_due_chat_cards(),
  public.close_session_cards(uuid[]),
  public.purge_chat(timestamptz)
from public, anon, authenticated;

grant execute on function
  public.close_due_chat_cards(),
  public.close_session_cards(uuid[]),
  public.purge_chat(timestamptz)
to service_role;
