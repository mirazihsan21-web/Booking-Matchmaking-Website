-- Players chat (stage C2, spec §7): the unread private-message reminder, run by the every-minute job. When a message
-- from the other person has waited unread for 15 minutes, its reader gets one notification (the bell, and an email if
-- they allow emails — the outbox checks), never with the message's words; then nothing more for that conversation
-- for 12 hours.
create function public.due_private_message_reminders(p_now timestamptz default now())
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_sent int;
begin
  with sides as (
    select c.id as conversation_id, c.organization_id, s.reader,
           case when s.reader = c.profile_low then c.profile_high else c.profile_low end as sender
    from public.chat_conversations c
    cross join lateral (values (c.profile_low), (c.profile_high)) as s (reader)
  ),
  due as materialized (
    select s.conversation_id, s.organization_id, s.reader, s.sender,
           (select m.author_name from public.chat_messages m
            where m.conversation_id = s.conversation_id and m.author_profile_id = s.sender and m.state = 'visible'
            order by m.created_at desc limit 1) as sender_name
    from sides s
    left join public.chat_conversation_reads r on r.conversation_id = s.conversation_id and r.profile_id = s.reader
    where (r.emailed_at is null or r.emailed_at < p_now - interval '12 hours')
      and exists (
        select 1 from public.chat_messages m
        where m.conversation_id = s.conversation_id and m.author_profile_id = s.sender and m.state = 'visible'
          and m.created_at < p_now - interval '15 minutes'
          and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)
      )
    limit 100
  ),
  marked as (
    insert into public.chat_conversation_reads as r (conversation_id, organization_id, profile_id, emailed_at)
    select conversation_id, organization_id, reader, p_now from due
    on conflict (conversation_id, profile_id) do update set emailed_at = excluded.emailed_at
    returning 1
  ),
  told as (
    insert into public.notifications (organization_id, profile_id, kind, payload, link)
    select organization_id, reader, 'chat_private_message',
           jsonb_build_object('conversation_id', conversation_id, 'sender_name', sender_name, 'sender_profile_id', sender),
           '/chat/private/' || sender
    from due
    returning 1
  )
  select (select count(*) from told) + 0 * (select count(*) from marked) into v_sent;
  return v_sent;
end;
$$;

revoke execute on function public.due_private_message_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.due_private_message_reminders(timestamptz) to service_role;
