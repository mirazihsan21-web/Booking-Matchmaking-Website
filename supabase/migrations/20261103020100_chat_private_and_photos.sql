-- Players chat (stage C2, spec §7–§8): private conversations between two players, blocks, and one photo per message
-- in a private chat-photos bucket. Private messages are chat_messages rows with a conversation_id, readable only by
-- the two people in it. A photo can be seen only by those who may see its message (and by the team while a report on
-- it is open). Photos are deleted through the Storage API from chat_photo_trash (SQL can't delete storage objects).

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_low uuid not null,
  profile_high uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, profile_low, profile_high),
  check (profile_low < profile_high),
  constraint chat_conversations_profile_low_fkey foreign key (profile_low, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade,
  constraint chat_conversations_profile_high_fkey foreign key (profile_high, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_conversations_profile_low_idx on public.chat_conversations (profile_low);
create index chat_conversations_profile_high_idx on public.chat_conversations (profile_high);

alter table public.chat_messages
  add column conversation_id uuid,
  add column photo_path text,
  add constraint chat_messages_conversation_id_fkey foreign key (conversation_id, organization_id)
    references public.chat_conversations (id, organization_id) on delete cascade,
  add constraint chat_messages_card_plain check (card_id is null or (conversation_id is null and photo_path is null));
-- A visible message has words, a card or a photo.
alter table public.chat_messages drop constraint chat_messages_check1;
alter table public.chat_messages
  add constraint chat_messages_has_content check (state <> 'visible' or body is not null or card_id is not null or photo_path is not null);
create unique index chat_messages_photo_path_key on public.chat_messages (photo_path) where photo_path is not null;
create index chat_messages_conversation_id_created_at_idx on public.chat_messages (conversation_id, created_at desc);

create table public.chat_conversation_reads (
  conversation_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null,
  read_at timestamptz,
  emailed_at timestamptz,
  primary key (conversation_id, profile_id),
  constraint chat_conversation_reads_conversation_id_fkey foreign key (conversation_id, organization_id)
    references public.chat_conversations (id, organization_id) on delete cascade,
  constraint chat_conversation_reads_profile_id_fkey foreign key (profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_conversation_reads_profile_id_idx on public.chat_conversation_reads (profile_id);
create index chat_conversation_reads_organization_id_idx on public.chat_conversation_reads (organization_id);

create table public.chat_blocks (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  blocker_profile_id uuid not null,
  blocked_profile_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_profile_id, blocked_profile_id),
  check (blocker_profile_id <> blocked_profile_id),
  constraint chat_blocks_blocker_profile_id_fkey foreign key (blocker_profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade,
  constraint chat_blocks_blocked_profile_id_fkey foreign key (blocked_profile_id, organization_id)
    references public.player_profiles (id, organization_id) on delete cascade
);
create index chat_blocks_blocked_profile_id_idx on public.chat_blocks (blocked_profile_id);
create index chat_blocks_organization_id_idx on public.chat_blocks (organization_id);

-- Photos waiting to be deleted from Storage by the every-minute job.
create table public.chat_photo_trash (
  path text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  queued_at timestamptz not null default now()
);
create index chat_photo_trash_organization_id_idx on public.chat_photo_trash (organization_id);

-- Is the signed-in person one of the two people in this conversation?
create function private.is_conversation_member(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_conversations c
    join public.player_profiles p on p.id in (c.profile_low, c.profile_high) and p.organization_id = c.organization_id
    where c.id = p_conversation and p.user_id = (select auth.uid())
  )
$$;

-- May the signed-in person see this chat photo? Only when they may see its message — a visible room message (anyone
-- signed in, live brand) or a visible private message (its two people) — or, for the team, while a report on it is open.
create function private.can_see_chat_photo(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.chat_messages m
    where m.photo_path = p_name
      and (
        (m.state = 'visible' and m.conversation_id is null and private.org_is_live(m.organization_id))
        or (m.state = 'visible' and m.conversation_id is not null and private.is_conversation_member(m.conversation_id))
        or (private.is_org_member(m.organization_id)
            and exists (select 1 from public.chat_reports r where r.message_id = m.id and r.status = 'open'))
      )
  )
$$;

revoke execute on function private.is_conversation_member(uuid), private.can_see_chat_photo(text) from public, anon;
grant execute on function private.is_conversation_member(uuid), private.can_see_chat_photo(text) to authenticated, service_role;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_reads enable row level security;
alter table public.chat_blocks enable row level security;
alter table public.chat_photo_trash enable row level security;

-- The room for signed-in people; a private message for its two people only.
drop policy chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (
    (conversation_id is null and (select private.org_is_live(organization_id)))
    or (conversation_id is not null and (select private.is_conversation_member(conversation_id)))
  );
create policy chat_conversations_select on public.chat_conversations for select to authenticated
  using ((select private.is_conversation_member(id)));
create policy chat_conversation_reads_select on public.chat_conversation_reads for select to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)));
create policy chat_conversation_reads_insert on public.chat_conversation_reads for insert to authenticated
  with check ((select private.is_own_profile(profile_id, organization_id)) and (select private.is_conversation_member(conversation_id)));
create policy chat_conversation_reads_update on public.chat_conversation_reads for update to authenticated
  using ((select private.is_own_profile(profile_id, organization_id)))
  with check ((select private.is_own_profile(profile_id, organization_id)));
create policy chat_blocks_select on public.chat_blocks for select to authenticated
  using ((select private.is_own_profile(blocker_profile_id, organization_id)));

grant select on public.chat_conversations, public.chat_blocks to authenticated;
grant select on public.chat_conversation_reads to authenticated;
grant insert (conversation_id, organization_id, profile_id, read_at), update (read_at) on public.chat_conversation_reads to authenticated;
grant select, insert, update, delete on public.chat_conversations, public.chat_conversation_reads, public.chat_blocks,
  public.chat_photo_trash to service_role;

-- The photo bucket: private, 2 MB, images only. People upload into their own folder; nobody updates or deletes
-- through the API (the server does, with the service key).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create policy chat_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy chat_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and (select private.can_see_chat_photo(name)));
