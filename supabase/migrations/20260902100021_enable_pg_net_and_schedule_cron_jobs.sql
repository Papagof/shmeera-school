create extension if not exists "pg_net" with schema extensions;

-- sweep-expired-codes and purge-retention are both deployed with
-- verify_jwt = false (pg_cron's net.http_post call carries no Supabase user
-- session) — CRON_SECRET is the *only* thing gating them from being public,
-- unauthenticated endpoints. REPLACE_WITH_CRON_SECRET below is a
-- placeholder — never commit the real value to git. The live database has
-- the actual secret applied directly (via apply_migration, not tracked in
-- this file's history); if you ever need to recreate this job, generate a
-- fresh secret, set it as the CRON_SECRET Edge Function secret via the
-- dashboard first, then substitute it here before running.
select cron.schedule(
  'sweep-expired-codes-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mwtczbzxxvkviqqpvbnc.supabase.co/functions/v1/sweep-expired-codes',
    headers := jsonb_build_object('x-cron-secret', 'REPLACE_WITH_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'purge-retention-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://mwtczbzxxvkviqqpvbnc.supabase.co/functions/v1/purge-retention',
    headers := jsonb_build_object('x-cron-secret', 'REPLACE_WITH_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
