-- Team and player accounts: each owner or staff member has their own name and mobile, kept with their
-- membership (not a player profile), shown on the Staff page and on My account in Manage.
-- Existing members, and every new one (brand setup, accepted invites, new organisations), are named from
-- their Google name, else their email before "@".

alter table public.organization_members
  add column display_name text,
  add column phone text constraint organization_members_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$');

comment on column public.organization_members.display_name is 'The team member''s own name, shown on Staff and My account (1-60 characters).';
comment on column public.organization_members.phone is 'The team member''s own mobile, in the +E.164 form players'' phones use (optional).';

-- The name a member starts with: Google's full_name, then name, then the email before "@", then "Team member";
-- trimmed and cut to 60 characters.
create function private.member_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(split_part(u.email, '@', 1)), ''),
    'Team member'
  ), 60)
  from auth.users u
  where u.id = p_user_id
$$;
revoke execute on function private.member_display_name(uuid) from public, anon, authenticated;

update public.organization_members set display_name = coalesce(private.member_display_name(user_id), 'Team member');

alter table public.organization_members
  alter column display_name set not null,
  add constraint organization_members_display_name_check check (length(trim(display_name)) between 1 and 60);

-- Fills a missing or blank name on insert, so every way in gets one without code changes.
create function private.fill_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null or trim(new.display_name) = '' then
    new.display_name := coalesce(private.member_display_name(new.user_id), 'Team member');
  end if;
  return new;
end;
$$;
revoke execute on function private.fill_member_display_name() from public, anon, authenticated;

create trigger organization_members_fill_name
  before insert on public.organization_members
  for each row execute function private.fill_member_display_name();
