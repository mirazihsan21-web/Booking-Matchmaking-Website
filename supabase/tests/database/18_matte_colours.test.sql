-- R2 "matte night": each section kind's default colour is the soft one the dark site uses, and no
-- section keeps the old (light-site) default. Org C (…18a0) is a fresh brand for add_section.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(private.kind_accent('turf'), '#43a66b', 'turf defaults to the matte green');
select is(private.kind_accent('boardgame_cafe'), '#2e9e93', 'the café defaults to the matte teal');
select is(private.kind_accent('gaming_lounge'), '#8a78e6', 'the lounge defaults to the matte violet');

insert into public.organizations (id, slug, name, status) values ('00000000-0000-4000-8000-0000000018a0', 'matte-org-c', 'Org C', 'live');
-- add_section in its own statement: a row it inserts isn't visible to the query that calls it.
create temp table s as select public.add_section('00000000-0000-4000-8000-0000000018a0', 'turf', 'Turf') as id;
select is((select accent from public.sections where id = (select id from s)), '#43a66b', 'a new section gets its kind''s matte colour');

select is((select count(*) from public.sections where upper(accent) in ('#15803D', '#0F766E', '#7C3AED')), 0::bigint,
  'no section keeps an old default colour');

select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'sections' and column_name = 'accent'),
  '''#43a66b''::text', 'the column default is the matte green too');

select * from finish();
rollback;
