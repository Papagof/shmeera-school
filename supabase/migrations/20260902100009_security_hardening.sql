-- Addresses two Supabase advisor findings from the initial deploy:
--
-- 1. function_search_path_mutable: every trigger function from
--    20260902100003_cross_tenant_triggers.sql (and private.assert_same_school)
--    was created without a pinned search_path, which is a search-path
--    injection risk. Pin every one to `public, pg_temp`.
-- 2. anon/authenticated_security_definer_function_executable: trigger
--    functions return pseudo-type `trigger` and Postgres already refuses to
--    invoke them outside a trigger context ("trigger functions can only be
--    called as triggers") — not actually exploitable — but they still carry
--    a default PUBLIC execute grant via PostgREST's exposed `public` schema.
--    Revoke it from anon/authenticated for hygiene; nothing legitimate ever
--    calls these directly.

alter function private.assert_same_school(uuid, uuid, text) set search_path = public, pg_temp;
alter function public.trg_classes_same_school() set search_path = public, pg_temp;
alter function public.trg_staff_same_school() set search_path = public, pg_temp;
alter function public.trg_students_same_school() set search_path = public, pg_temp;
alter function public.trg_gsl_same_school() set search_path = public, pg_temp;
alter function public.trg_designees_same_school() set search_path = public, pg_temp;
alter function public.trg_event_codes_same_school() set search_path = public, pg_temp;
alter function public.trg_events_same_school() set search_path = public, pg_temp;
alter function public.trg_chat_threads_same_school() set search_path = public, pg_temp;
alter function public.trg_chat_messages_same_school() set search_path = public, pg_temp;
alter function public.trg_chat_reports_same_school() set search_path = public, pg_temp;
alter function public.trg_event_codes_protect_fields() set search_path = public, pg_temp;
alter function public.trg_schools_protect_secret() set search_path = public, pg_temp;
alter function public.trg_auto_create_chat_thread() set search_path = public, pg_temp;
alter function public.trg_backfill_chat_threads_on_class_assign() set search_path = public, pg_temp;

revoke execute on function public.trg_classes_same_school() from public, anon, authenticated;
revoke execute on function public.trg_staff_same_school() from public, anon, authenticated;
revoke execute on function public.trg_students_same_school() from public, anon, authenticated;
revoke execute on function public.trg_gsl_same_school() from public, anon, authenticated;
revoke execute on function public.trg_designees_same_school() from public, anon, authenticated;
revoke execute on function public.trg_event_codes_same_school() from public, anon, authenticated;
revoke execute on function public.trg_events_same_school() from public, anon, authenticated;
revoke execute on function public.trg_chat_threads_same_school() from public, anon, authenticated;
revoke execute on function public.trg_chat_messages_same_school() from public, anon, authenticated;
revoke execute on function public.trg_chat_reports_same_school() from public, anon, authenticated;
revoke execute on function public.trg_event_codes_protect_fields() from public, anon, authenticated;
revoke execute on function public.trg_schools_protect_secret() from public, anon, authenticated;
revoke execute on function public.trg_auto_create_chat_thread() from public, anon, authenticated;
revoke execute on function public.trg_backfill_chat_threads_on_class_assign() from public, anon, authenticated;
