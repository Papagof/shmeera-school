-- Cross-tenant isolation regression suite (SPEC.md §3.3.9).
--
-- Seeds two independent schools (via supabase/seed.sql, loaded by `db reset`
-- before this file runs) plus a few extra rows per table, then impersonates
-- each non-platform role (school_admin, teacher, guardian) in each school
-- and asserts they get ZERO rows back when querying the other school's data,
-- across every tenant-scoped table. This suite is meant to block merges if
-- it fails — see CLAUDE.md.
--
-- Run with: npm run supabase:test  (or `supabase test db`)

begin;
set search_path = public, extensions;
select * from no_plan();

-- ─────────────────────────── extra fixtures ───────────────────────────
-- (runs as the superuser connection pg_prove uses, which bypasses RLS)

insert into public.designees (id, school_id, requested_by_guardian_id, student_id, full_name, status) values
  ('aaaaaaaa-de51-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-9d41-0000-0000-000000000001', 'aaaaaaaa-5c0d-0000-0000-000000000001', 'Alpha Designee', 'approved'),
  ('bbbbbbbb-de51-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-9d41-0000-0000-000000000001', 'bbbbbbbb-5c0d-0000-0000-000000000001', 'Beta Designee', 'approved');

insert into public.event_codes (id, school_id, student_id, type, code, qr_payload, issued_by, expires_at) values
  ('aaaaaaaa-ec0d-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-5c0d-0000-0000-000000000001', 'pickup', '111111', 'payload-a', '11111111-aaaa-0000-0000-000000000003', now() + interval '10 minutes'),
  ('bbbbbbbb-ec0d-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-5c0d-0000-0000-000000000001', 'pickup', '222222', 'payload-b', '22222222-bbbb-0000-0000-000000000003', now() + interval '10 minutes');

insert into public.events (id, school_id, student_id, event_code_id, type, validated_by_staff_id, geo) values
  ('aaaaaaaa-e7e0-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-5c0d-0000-0000-000000000001', 'aaaaaaaa-ec0d-0000-0000-000000000001', 'pickup', 'aaaaaaaa-57af-0000-0000-000000000001', '{"lat":40.0,"lng":-73.0}'),
  ('bbbbbbbb-e7e0-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-5c0d-0000-0000-000000000001', 'bbbbbbbb-ec0d-0000-0000-000000000001', 'pickup', 'bbbbbbbb-57af-0000-0000-000000000001', '{"lat":41.0,"lng":-87.0}');

insert into public.security_alerts (id, school_id, student_id, kind, details) values
  ('aaaaaaaa-a1e5-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-5c0d-0000-0000-000000000001', 'invalid_code', '{}'),
  ('bbbbbbbb-a1e5-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-5c0d-0000-0000-000000000001', 'invalid_code', '{}');

insert into public.chat_messages (school_id, thread_id, sender_id, sender_role, body)
select ct.school_id, ct.id, g.user_id, 'guardian', 'Hello from Alpha guardian'
from public.chat_threads ct join public.guardians g on g.id = ct.guardian_id
where ct.school_id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.chat_messages (school_id, thread_id, sender_id, sender_role, body)
select ct.school_id, ct.id, g.user_id, 'guardian', 'Hello from Beta guardian'
from public.chat_threads ct join public.guardians g on g.id = ct.guardian_id
where ct.school_id = 'bbbbbbbb-0000-0000-0000-000000000001';

insert into public.chat_reports (school_id, thread_id, reported_by, reason)
select ct.school_id, ct.id, g.user_id, 'test report'
from public.chat_threads ct join public.guardians g on g.id = ct.guardian_id
where ct.school_id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.chat_reports (school_id, thread_id, reported_by, reason)
select ct.school_id, ct.id, g.user_id, 'test report'
from public.chat_threads ct join public.guardians g on g.id = ct.guardian_id
where ct.school_id = 'bbbbbbbb-0000-0000-0000-000000000001';

insert into public.audit_log (school_id, actor_id, actor_role, action) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', 'school_admin', 'test_seed'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-bbbb-0000-0000-000000000001', 'school_admin', 'test_seed');

-- ─────────────────────────── helper ───────────────────────────
-- Counts rows in `tbl` matching `col = forbidden_school` under whatever role
-- / auth.uid() is currently active, and asserts the count is zero.
create or replace function pg_temp.assert_school_isolation(
  p_persona_label text, p_table text, p_col text, p_forbidden_school uuid
) returns text
language plpgsql
as $fn$
declare
  v_count bigint;
begin
  execute format('select count(*) from public.%I where %I = $1', p_table, p_col)
    into v_count
    using p_forbidden_school;
  return is(v_count, 0::bigint, format('%s cannot see any %s rows belonging to the other school', p_persona_label, p_table));
end;
$fn$;

-- All personas run as the `authenticated` role for the rest of this test so
-- RLS is actually enforced (a superuser connection bypasses it entirely).
set local role authenticated;

-- ─────────────────────────── Alpha personas blocked from Beta ───────────────────────────
set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000001","role":"authenticated"}'; -- alpha admin
select pg_temp.assert_school_isolation('alpha admin', 'schools', 'id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'memberships', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'classes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'staff', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'guardians', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'students', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'guardian_student_links', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'designees', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'event_codes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'events', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'security_alerts', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'chat_threads', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'chat_messages', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'chat_reports', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha admin', 'audit_log', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000002","role":"authenticated"}'; -- alpha teacher
select pg_temp.assert_school_isolation('alpha teacher', 'schools', 'id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'memberships', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'classes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'staff', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'guardians', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'students', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'guardian_student_links', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'designees', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'event_codes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'events', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'security_alerts', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'chat_threads', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'chat_messages', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'chat_reports', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha teacher', 'audit_log', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000003","role":"authenticated"}'; -- alpha guardian
select pg_temp.assert_school_isolation('alpha guardian', 'schools', 'id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'memberships', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'classes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'staff', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'guardians', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'students', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'guardian_student_links', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'designees', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'event_codes', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'events', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'security_alerts', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'chat_threads', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'chat_messages', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'chat_reports', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('alpha guardian', 'audit_log', 'school_id', 'bbbbbbbb-0000-0000-0000-000000000001');

-- ─────────────────────────── Beta personas blocked from Alpha ───────────────────────────
set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000001","role":"authenticated"}'; -- beta admin
select pg_temp.assert_school_isolation('beta admin', 'schools', 'id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'memberships', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'classes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'staff', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'guardians', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'students', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'guardian_student_links', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'designees', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'event_codes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'events', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'security_alerts', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'chat_threads', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'chat_messages', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'chat_reports', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta admin', 'audit_log', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000002","role":"authenticated"}'; -- beta teacher
select pg_temp.assert_school_isolation('beta teacher', 'schools', 'id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'memberships', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'classes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'staff', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'guardians', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'students', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'guardian_student_links', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'designees', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'event_codes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'events', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'security_alerts', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'chat_threads', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'chat_messages', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'chat_reports', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta teacher', 'audit_log', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000003","role":"authenticated"}'; -- beta guardian
select pg_temp.assert_school_isolation('beta guardian', 'schools', 'id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'memberships', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'classes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'staff', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'guardians', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'students', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'guardian_student_links', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'designees', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'event_codes', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'events', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'security_alerts', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'chat_threads', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'chat_messages', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'chat_reports', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert_school_isolation('beta guardian', 'audit_log', 'school_id', 'aaaaaaaa-0000-0000-0000-000000000001');

-- ─────────────────────────── positive sanity checks ───────────────────────────
-- If these fail, RLS is over-blocking (denying everyone everything), which
-- would make the negative checks above pass for the wrong reason.
set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.students) >= 1, 'alpha admin can see alpha''s own students');

set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000002","role":"authenticated"}';
select ok((select count(*) from public.students) >= 1, 'alpha teacher can see their own class roster');

set local request.jwt.claims to '{"sub":"11111111-aaaa-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.students), 1::bigint, 'alpha guardian sees exactly their one linked child');

set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000001","role":"authenticated"}';
select ok((select count(*) from public.students) >= 1, 'beta admin can see beta''s own students');

set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000002","role":"authenticated"}';
select ok((select count(*) from public.students) >= 1, 'beta teacher can see their own class roster');

set local request.jwt.claims to '{"sub":"22222222-bbbb-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.students), 1::bigint, 'beta guardian sees exactly their one linked child');

select * from finish();
rollback;
