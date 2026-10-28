-- The job tick waits up to 30 s for the site's answer (final review of the Vercel launch, Important 2).
-- pg_net's default timeout is a few seconds; a Vercel cold start plus the tick's work (and Gmail sends) often
-- takes longer. The work still finishes — Vercel doesn't stop a function when the caller hangs up — but
-- net._http_response, the tick's only health record, would show timeouts instead of 200s.

create or replace function private.trigger_tick()
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
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 30000
  );
end;
$$;
