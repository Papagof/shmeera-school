-- Bug: `private.assert_same_school` (and the RLS helper functions) were
-- only granted to `authenticated`. Every cross-tenant trigger that calls
-- `private.*` runs SECURITY INVOKER, so it executes as whichever role
-- performed the write — and every Edge Function writes through the
-- service_role client (SPEC.md §3.3.4). Without this grant, any insert or
-- update through a service-role client that touches a trigger-guarded table
-- (classes, staff, students, guardian_student_links, designees, event_codes,
-- events, chat_threads, chat_messages, chat_reports) fails with
-- "permission denied for schema private" — caught live via
-- generate-event-code returning 500.

grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- Keep future functions in this schema covered automatically too.
alter default privileges in schema private grant execute on functions to service_role;
