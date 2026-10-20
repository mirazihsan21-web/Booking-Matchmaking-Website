-- Stage B1: the 10-second job tick (spec §5).
--
-- pg_cron runs private.trigger_tick() every 10 seconds. It reads the app's address and a shared secret
-- from Vault and POSTs to <app_url>/api/jobs/tick through pg_net; the app then does the timed work
-- (B1: deliver pending emails). Without those Vault secrets (CI, tests, a fresh database) it does
-- nothing. Locally `pnpm env:local` writes them: app_url = http://host.docker.internal:3000.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function private.trigger_tick()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'job_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url || '/api/jobs/tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json')
  );
end;
$$;

revoke execute on function private.trigger_tick() from public, anon, authenticated;

select cron.schedule('tick', '10 seconds', 'select private.trigger_tick()');
