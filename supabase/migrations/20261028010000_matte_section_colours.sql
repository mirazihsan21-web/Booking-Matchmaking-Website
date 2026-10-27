-- R2 "matte night": the site is dark, so each section kind's default colour becomes a soft (matte)
-- one that reads on dark cards and carries dark button text (WCAG AA, see apps/web/lib/site/tokens.ts).
-- Sections still on an old default move to the new one; a colour an owner picked is left alone.

create or replace function private.kind_accent(p_kind public.business_type)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_kind when 'turf' then '#43a66b' when 'boardgame_cafe' then '#2e9e93' else '#8a78e6' end;
$$;

alter table public.sections alter column accent set default '#43a66b';

update public.sections set accent = '#43a66b' where kind = 'turf' and upper(accent) = '#15803D';
update public.sections set accent = '#2e9e93' where kind = 'boardgame_cafe' and upper(accent) = '#0F766E';
update public.sections set accent = '#8a78e6' where kind = 'gaming_lounge' and upper(accent) = '#7C3AED';
