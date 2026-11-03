-- Players chat (stage C2): fixes from the final review.
-- 1. The team could read a private message's text after its author removed it (chat_message_archive): the archive now
--    marks private rows, and the team reads room rows only.
-- 2. A reported private message's copy stayed readable by the team after they decided: it is cleared then.
-- 3. The unread reminder repeated every 12 hours for the same unread message, and fired for blocked pairs; the unread
--    count kept counting a conversation either side had blocked.
-- 4. Never-posted uploads by someone with no player profile (a team login, a new account) were never deleted, and
--    anyone signed in could upload without limit: uploads now need a profile or a team login, 20 an hour.

-- 1
alter table public.chat_message_archive add column is_private boolean not null default false;
update public.chat_message_archive a set is_private = true
from public.chat_messages m where m.id = a.message_id and m.conversation_id is not null;

drop policy chat_message_archive_select on public.chat_message_archive;
create policy chat_message_archive_select on public.chat_message_archive for select to authenticated
  using ((select private.is_org_member(organization_id)) and not is_private);

create or replace function private.archive_message(p_message_id uuid, p_state public.chat_message_state)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found then
    return;
  end if;
  if v_message.card_id is not null then
    insert into public.chat_message_archive (message_id, organization_id, body)
    select v_message.id, v_message.organization_id, c.note from public.chat_cards c where c.id = v_message.card_id and c.note is not null
    on conflict (message_id) do nothing;
    update public.chat_cards set note = null where id = v_message.card_id;
  elsif v_message.body is not null then
    insert into public.chat_message_archive (message_id, organization_id, body, is_private)
    values (v_message.id, v_message.organization_id, v_message.body, v_message.conversation_id is not null)
    on conflict (message_id) do nothing;
  end if;
  update public.chat_messages set body = null, state = p_state where id = p_message_id;
  if p_state in ('removed_by_author', 'removed_by_venue') then
    perform private.trash_photo(p_message_id);
  end if;
end;
$$;

-- 2: as before, and once decided, a private message's report copies are cleared.
create or replace function public.resolve_chat_reports(p_message_id uuid, p_user_id uuid, p_action text)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_message public.chat_messages;
  v_archived text;
begin
  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then
    return 'not_found';
  end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = v_message.organization_id and m.user_id = p_user_id) then
    return 'not_allowed';
  end if;
  if p_action not in ('remove', 'dismiss') then
    return 'invalid';
  end if;
  if not exists (select 1 from public.chat_reports r where r.message_id = p_message_id and r.status = 'open') then
    return 'nothing_open';
  end if;

  if p_action = 'remove' then
    if v_message.state <> 'removed_by_venue' then
      perform private.archive_message(p_message_id, 'removed_by_venue');
    end if;
    if v_message.card_id is not null and exists (select 1 from public.chat_cards c where c.id = v_message.card_id and c.status in ('open', 'full')) then
      perform private.close_card(v_message.card_id, 'closed', true);
    end if;
  elsif v_message.state = 'hidden_by_reports' then
    select a.body into v_archived from public.chat_message_archive a where a.message_id = p_message_id;
    if v_message.card_id is not null then
      update public.chat_cards set note = v_archived where id = v_message.card_id;
      update public.chat_messages set state = 'visible' where id = p_message_id;
    else
      update public.chat_messages set body = v_archived, state = 'visible' where id = p_message_id;
    end if;
    delete from public.chat_message_archive where message_id = p_message_id;
  end if;

  update public.chat_reports
  set status = case when p_action = 'remove' then 'removed'::public.chat_report_status else 'dismissed'::public.chat_report_status end,
      resolved_by = p_user_id, resolved_at = now(),
      body_copy = case when v_message.conversation_id is not null then null else body_copy end
  where message_id = p_message_id and status = 'open';

  if exists (select 1 from public.chat_messages m where m.id = p_message_id and m.state in ('removed_by_author', 'removed_by_venue')) then
    perform private.trash_photo(p_message_id);
  end if;
  return 'resolved';
end;
$$;

-- 3: has either person in this conversation blocked the other? (Reads blocks past their row rules, which show
-- only your own.)
create function private.conversation_is_blocked(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_conversations c
    join public.chat_blocks b on b.organization_id = c.organization_id
      and ((b.blocker_profile_id = c.profile_low and b.blocked_profile_id = c.profile_high)
        or (b.blocker_profile_id = c.profile_high and b.blocked_profile_id = c.profile_low))
    where c.id = p_conversation
  )
$$;
revoke execute on function private.conversation_is_blocked(uuid) from public, anon;
grant execute on function private.conversation_is_blocked(uuid) to authenticated, service_role;

create or replace function public.chat_private_unread(p_organization_id uuid)
returns int
language sql stable security invoker set search_path = '' as $$
  select count(*)::int
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  join public.player_profiles me
    on me.organization_id = c.organization_id and me.user_id = (select auth.uid()) and me.id in (c.profile_low, c.profile_high)
  left join public.chat_conversation_reads r on r.conversation_id = c.id and r.profile_id = me.id
  where c.organization_id = p_organization_id
    and m.state = 'visible'
    and m.author_profile_id is distinct from me.id
    and (r.read_at is null or m.created_at > r.read_at)
    and not private.conversation_is_blocked(c.id)
$$;

create or replace function public.due_private_message_reminders(p_now timestamptz default now())
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
      and not private.is_blocked(s.organization_id, s.reader, s.sender)
      and exists (
        select 1 from public.chat_messages m
        where m.conversation_id = s.conversation_id and m.author_profile_id = s.sender and m.state = 'visible'
          and m.created_at < p_now - interval '15 minutes'
          and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)
          -- a message they were already reminded about doesn't remind them again
          and m.created_at > coalesce(r.emailed_at, '-infinity'::timestamptz)
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

-- 4: the trash takes photos from anyone; the purge queues every never-posted upload.
alter table public.chat_photo_trash alter column organization_id drop not null;

create or replace function public.purge_chat(p_now timestamptz default now())
returns setof text
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with old_photos as (
    select m.photo_path as path, m.organization_id from public.chat_messages m
    where m.created_at < p_now - interval '30 days' and m.photo_path is not null
  ),
  never_posted as (
    select o.name as path,
           coalesce(
             (select pr.organization_id from public.player_profiles pr where pr.user_id::text = (storage.foldername(o.name))[1] limit 1),
             (select om.organization_id from public.organization_members om where om.user_id::text = (storage.foldername(o.name))[1] limit 1)
           ) as organization_id
    from storage.objects o
    where o.bucket_id = 'chat-photos' and o.created_at < p_now - interval '1 day'
      and not exists (select 1 from public.chat_messages m where m.photo_path = o.name)
  ),
  queued as (
    insert into public.chat_photo_trash (path, organization_id)
    select path, organization_id from (select * from old_photos union select * from never_posted) p
    on conflict (path) do nothing
    returning path
  )
  select path from queued;

  delete from public.chat_messages where created_at < p_now - interval '30 days';
  delete from public.chat_cards where ends_at < p_now - interval '30 days';
  delete from public.chat_reports where status <> 'open' and resolved_at < p_now - interval '30 days';
  delete from public.chat_mutes where until is not null and until < p_now - interval '30 days';
  delete from public.chat_conversations where last_message_at < p_now - interval '30 days';
end;
$$;

-- 4: may the signed-in person upload a chat photo now? A player profile or a team login, and under 20 this hour.
create function private.may_upload_chat_photo()
returns boolean
language sql volatile security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and (
      exists (select 1 from public.player_profiles p where p.user_id = (select auth.uid()))
      or exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()))
    )
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'chat-photos' and o.name like (select auth.uid())::text || '/%' and o.created_at > now() - interval '1 hour'
    ) < 20
$$;
revoke execute on function private.may_upload_chat_photo() from public, anon;
grant execute on function private.may_upload_chat_photo() to authenticated, service_role;

drop policy chat_photos_insert on storage.objects;
create policy chat_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.may_upload_chat_photo())
  );
