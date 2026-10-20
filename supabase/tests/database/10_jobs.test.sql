-- The 10-second job tick: pg_cron → private.trigger_tick() → pg_net POST to the app, using the app URL
-- and shared secret kept in Vault. Queued requests are rolled back with the test, so nothing is sent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is((select schedule from cron.job where jobname = 'tick'), '10 seconds', 'the tick is scheduled every 10 seconds');
select is((select command from cron.job where jobname = 'tick'), 'select private.trigger_tick()', 'and calls private.trigger_tick()');

-- Without configuration (CI, tests) the trigger does nothing.
delete from vault.secrets where name in ('app_url', 'job_secret');
create temp table queued_before as select count(*)::int as n from net.http_request_queue;
select is(private.trigger_tick(), null, 'without Vault secrets the trigger returns null');
select is((select count(*)::int from net.http_request_queue), (select n from queued_before), 'and queues no request');

-- Configured, it posts to the app with the secret.
select vault.create_secret('http://pgtap.invalid:3000', 'app_url');
select vault.create_secret('pgtap-secret', 'job_secret');
create temp table fired as select private.trigger_tick() as request_id;
select is(
  (select url from net.http_request_queue where id = (select request_id from fired)),
  'http://pgtap.invalid:3000/api/jobs/tick',
  'with Vault secrets it queues a POST to <app_url>/api/jobs/tick'
);

select * from finish();
rollback;
