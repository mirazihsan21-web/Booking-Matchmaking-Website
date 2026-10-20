-- Stage B1: delivering notification emails from the outbox (spec §3 B1, §6).
--
-- The job tick claims a batch, sends each email, then records the outcome. `for update skip locked`
-- means two overlapping ticks never claim the same row; a claim stuck in `sending` for more than
-- 5 minutes (a crashed tick) is claimable again. A failure is retried until the third attempt.

create function public.claim_pending_emails(p_limit int)
returns setof public.notifications
language sql
security invoker
set search_path = ''
as $$
  with picked as (
    select id
    from public.notifications
    where email_status = 'pending'
       or (email_status = 'sending' and email_claimed_at < now() - interval '5 minutes')
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
  set email_status = 'sending',
      email_attempts = n.email_attempts + 1,
      email_claimed_at = now()
  from picked
  where n.id = picked.id
  returning n.*;
$$;

create function public.finish_email(p_notification_id uuid, p_outcome text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.email_status;
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed', 'skipped') then
    raise exception 'unknown email outcome: %', p_outcome using errcode = '22023';
  end if;

  update public.notifications
  set email_status = case
        when p_outcome = 'sent' then 'sent'
        when p_outcome = 'skipped' then 'skipped'
        when email_attempts >= 3 then 'failed'
        else 'pending'
      end::public.email_status,
      emailed_at = case when p_outcome = 'sent' then now() else emailed_at end
  where id = p_notification_id
  returning email_status into v_status;

  return v_status::text;
end;
$$;

revoke execute on function public.claim_pending_emails(int), public.finish_email(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pending_emails(int), public.finish_email(uuid, text) to service_role;
