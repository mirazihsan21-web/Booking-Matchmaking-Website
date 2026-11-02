-- Players chat (stage C2, spec §8): photos in messages. A message is words, a photo, or both; the photo must be the
-- sender's own upload (`<user id>/<file id>.jpg` in chat-photos), exist, and not be on another message; 10 photos an
-- hour. Removing a message queues its photo in chat_photo_trash (unless a report on it is open — the team must see it
-- first); hiding by reports keeps it. The purge queues old and never-posted photos and drops quiet conversations.
-- The every-minute job deletes queued photos through the Storage API (SQL can't delete storage objects here).

-- Null when this user may post this photo now, else 'bad_photo' or 'too_many_photos'.
create function private.chat_photo_check(p_user_id uuid, p_path text)
returns text
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_path is null or p_path !~ ('^' || p_user_id::text || '/[0-9a-f-]{36}\.jpg$') then
    return 'bad_photo';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat-photos' and o.name = p_path) then
    return 'bad_photo';
  end if;
  if exists (select 1 from public.chat_messages m where m.photo_path = p_path) then
    return 'bad_photo';
  end if;
  if (select count(*) from public.chat_messages m
      where m.author_user_id = p_user_id and m.photo_path is not null and m.created_at > now() - interval '1 hour') >= 10 then
    return 'too_many_photos';
  end if;
  return null;
end;
$$;

-- Queues a message's photo for deletion, unless a report on it is still open.
create function private.trash_photo(p_message_id uuid)
returns void
language sql security invoker set search_path = '' as $$
  insert into public.chat_photo_trash (path, organization_id)
  select m.photo_path, m.organization_id from public.chat_messages m
  where m.id = p_message_id and m.photo_path is not null
    and not exists (select 1 from public.chat_reports r where r.message_id = m.id and r.status = 'open')
  on conflict (path) do nothing
$$;

-- The room's post, now with an optional photo (spec §2.1, §8). Same order as before: who, what, the photo, the limits.
drop function public.post_chat_message(uuid, uuid, text);
create function public.post_chat_message(p_organization_id uuid, p_user_id uuid, p_body text, p_photo_path text default null)
returns table (status text, message_id uuid)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_author record;
  v_body text := nullif(btrim(coalesce(p_body, ''), E' \t\r\n'), '');
  v_refusal text;
  v_id uuid;
begin
  select * into v_author from private.chat_author(p_organization_id, p_user_id) limit 1;
  if not found then
    return query select 'no_profile'::text, null::uuid;
    return;
  end if;
  if (v_body is null and p_photo_path is null) or (v_body is not null and char_length(v_body) > 500) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if p_photo_path is not null then
    v_refusal := private.chat_photo_check(p_user_id, p_photo_path);
    if v_refusal is not null then
      return query select v_refusal, null::uuid;
      return;
    end if;
  end if;
  v_refusal := private.chat_guard(p_organization_id, p_user_id, v_author.profile_id);
  if v_refusal is not null then
    return query select v_refusal, null::uuid;
    return;
  end if;
  insert into public.chat_messages (organization_id, author_user_id, author_profile_id, author_kind, author_name, body, photo_path)
  values (p_organization_id, p_user_id, v_author.profile_id, v_author.kind, v_author.name, v_body, p_photo_path)
  returning id into v_id;
  return query select 'posted'::text, v_id;
end;
$$;

-- As before (a card's note goes with its message), and a removed message's photo is queued for deletion.
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
    insert into public.chat_message_archive (message_id, organization_id, body)
    values (v_message.id, v_message.organization_id, v_message.body)
    on conflict (message_id) do nothing;
  end if;
  update public.chat_messages set body = null, state = p_state where id = p_message_id;
  if p_state in ('removed_by_author', 'removed_by_venue') then
    perform private.trash_photo(p_message_id);
  end if;
end;
$$;

-- As before, and once a removed message has no open report, its photo is queued for deletion.
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
      resolved_by = p_user_id, resolved_at = now()
  where message_id = p_message_id and status = 'open';

  if exists (select 1 from public.chat_messages m where m.id = p_message_id and m.state in ('removed_by_author', 'removed_by_venue')) then
    perform private.trash_photo(p_message_id);
  end if;
  return 'resolved';
end;
$$;

-- As before, plus: the photos of purged messages and photos uploaded over a day ago but never posted are queued for
-- deletion, and conversations quiet for 30 days are dropped. Returns the paths it queued.
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
    select o.name as path, (select pr.organization_id from public.player_profiles pr
                            where pr.user_id::text = (storage.foldername(o.name))[1] limit 1) as organization_id
    from storage.objects o
    where o.bucket_id = 'chat-photos' and o.created_at < p_now - interval '1 day'
      and not exists (select 1 from public.chat_messages m where m.photo_path = o.name)
  ),
  queued as (
    insert into public.chat_photo_trash (path, organization_id)
    select path, organization_id from (select * from old_photos union select * from never_posted) p
    where organization_id is not null
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

-- The job: the oldest queued photo paths, and forgetting them once Storage has deleted them.
create function public.take_chat_photo_trash(p_limit int)
returns setof text
language sql stable security invoker set search_path = '' as $$
  select path from public.chat_photo_trash order by queued_at, path limit p_limit
$$;

create function public.forget_chat_photo_trash(p_paths text[])
returns void
language sql security invoker set search_path = '' as $$
  delete from public.chat_photo_trash where path = any (p_paths)
$$;

revoke execute on function
  private.chat_photo_check(uuid, text),
  private.trash_photo(uuid),
  public.post_chat_message(uuid, uuid, text, text),
  public.take_chat_photo_trash(int),
  public.forget_chat_photo_trash(text[])
from public, anon, authenticated;

grant execute on function
  private.chat_photo_check(uuid, text),
  private.trash_photo(uuid),
  public.post_chat_message(uuid, uuid, text, text),
  public.take_chat_photo_trash(int),
  public.forget_chat_photo_trash(text[])
to service_role;
