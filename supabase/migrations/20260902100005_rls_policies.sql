-- Row Level Security. This is the real tenant boundary (SPEC.md §3.1) —
-- app code and Edge Functions are never trusted to filter by school_id.
-- Every table gets RLS enabled with no exceptions, even ones with no
-- policies below (default-deny for authenticated; service_role bypasses RLS
-- entirely and is used by Edge Functions for privileged writes).

alter table public.schools enable row level security;
alter table public.memberships enable row level security;
alter table public.classes enable row level security;
alter table public.staff enable row level security;
alter table public.guardians enable row level security;
alter table public.students enable row level security;
alter table public.guardian_student_links enable row level security;
alter table public.designees enable row level security;
alter table public.event_codes enable row level security;
alter table public.events enable row level security;
alter table public.security_alerts enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;
alter table public.audit_log enable row level security;

-- ─────────────────────────── schools ───────────────────────────
create policy schools_select on public.schools for select
  using (id in (select private.current_school_ids()) or private.is_super_admin());

create policy schools_update_admin on public.schools for update
  using (private.has_role_in_school(id, array['school_admin']))
  with check (private.has_role_in_school(id, array['school_admin']));
-- insert/delete: service_role only (school onboarding/offboarding, SPEC.md §3.3.10)

-- ─────────────────────────── memberships ───────────────────────────
create policy memberships_select on public.memberships for select
  using (
    user_id = auth.uid()
    or private.has_role_in_school(school_id, array['school_admin'])
    or private.is_super_admin()
  );

create policy memberships_insert_admin on public.memberships for insert
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    and role in ('teacher', 'guardian')
  );

create policy memberships_delete_admin on public.memberships for delete
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    and role in ('teacher', 'guardian')
  );

-- ─────────────────────────── classes ───────────────────────────
create policy classes_select on public.classes for select
  using (school_id in (select private.current_school_ids()));

create policy classes_write_admin on public.classes for all
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── staff ───────────────────────────
create policy staff_select on public.staff for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = auth.uid()
    or class_id in (
      select c.id from public.classes c
      where c.school_id = staff.school_id
        and c.id in (
          select cl.class_id from public.students cl
          where cl.id in (select private.guardian_student_ids(staff.school_id))
        )
    )
  );

create policy staff_write_admin on public.staff for insert
  with check (private.has_role_in_school(school_id, array['school_admin']));

create policy staff_update_admin on public.staff for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

create policy staff_delete_admin on public.staff for delete
  using (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── guardians ───────────────────────────
create policy guardians_select on public.guardians for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = auth.uid()
    or id in (
      select gsl.guardian_id from public.guardian_student_links gsl
      where gsl.student_id in (select private.teacher_student_ids(school_id))
    )
  );

create policy guardians_insert_self_or_admin on public.guardians for insert
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or (user_id = auth.uid() and status = 'pending')
  );

create policy guardians_update on public.guardians for update
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = auth.uid()
  )
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = auth.uid()
  );

create policy guardians_delete_admin on public.guardians for delete
  using (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── students ───────────────────────────
create policy students_select on public.students for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or id in (select private.guardian_student_ids(school_id))
    or id in (select private.teacher_student_ids(school_id))
  );

create policy students_write_admin on public.students for all
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── guardian_student_links ───────────────────────────
create policy gsl_select on public.guardian_student_links for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or student_id in (select private.guardian_student_ids(school_id))
    or student_id in (select private.teacher_student_ids(school_id))
  );

create policy gsl_write_admin on public.guardian_student_links for all
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── designees ───────────────────────────
create policy designees_select on public.designees for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or requested_by_guardian_id = private.guardian_id_for_school(school_id)
    or student_id in (select private.teacher_student_ids(school_id))
  );

create policy designees_insert_guardian on public.designees for insert
  with check (
    requested_by_guardian_id = private.guardian_id_for_school(school_id)
    and student_id in (select private.guardian_student_ids(school_id))
    and status = 'pending'
  );

create policy designees_update_admin on public.designees for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

create policy designees_delete on public.designees for delete
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or (requested_by_guardian_id = private.guardian_id_for_school(school_id) and status = 'pending')
  );

-- ─────────────────────────── event_codes ───────────────────────────
create policy event_codes_select on public.event_codes for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = auth.uid()
    or student_id in (select private.teacher_student_ids(school_id))
  );

-- primary write path is the service-role generate-event-code Edge Function
-- (needed for the per-school HMAC signing secret); this is defense-in-depth
-- for the same guardian-only, own-student rule.
create policy event_codes_insert_guardian on public.event_codes for insert
  with check (
    issued_by = auth.uid()
    and student_id in (select private.guardian_student_ids(school_id))
  );

create policy event_codes_update on public.event_codes for update
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = auth.uid()
  )
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = auth.uid()
  );
  -- trg_event_codes_protect_fields further restricts non-service updates to revoke-only

-- ─────────────────────────── events (immutable log) ───────────────────────────
create policy events_select on public.events for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or student_id in (select private.guardian_student_ids(school_id))
    or student_id in (select private.teacher_student_ids(school_id))
  );

create policy events_insert_teacher on public.events for insert
  with check (
    validated_by_staff_id = private.staff_id_for_school(school_id)
    and student_id in (select private.teacher_student_ids(school_id))
  );
-- no update/delete policy for any role: events are an immutable audit trail

-- ─────────────────────────── security_alerts ───────────────────────────
create policy security_alerts_select_admin on public.security_alerts for select
  using (private.has_role_in_school(school_id, array['school_admin']));

create policy security_alerts_insert on public.security_alerts for insert
  with check (school_id in (select private.current_school_ids()));

create policy security_alerts_update_admin on public.security_alerts for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── chat_threads ───────────────────────────
create policy chat_threads_select on public.chat_threads for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or guardian_id = private.guardian_id_for_school(school_id)
    or teacher_id = private.staff_id_for_school(school_id)
  );
-- insert: none for authenticated — threads are auto-created by
-- trg_auto_create_chat_thread (20260902100006) when a guardian_student_links
-- row is inserted, which runs as the table owner regardless of caller role.

create policy chat_threads_update on public.chat_threads for update
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or guardian_id = private.guardian_id_for_school(school_id)
    or teacher_id = private.staff_id_for_school(school_id)
  )
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or guardian_id = private.guardian_id_for_school(school_id)
    or teacher_id = private.staff_id_for_school(school_id)
  );

-- ─────────────────────────── chat_messages ───────────────────────────
-- Admin can read any thread in their school at any time (always-on safety
-- oversight per SPEC.md §5.4.3) — the send-chat-message / get-chat-thread
-- Edge Functions are responsible for writing an audit_log row whenever an
-- admin who isn't a thread participant reads a thread, since Postgres has
-- no SELECT trigger to hook this at the DB layer.
create policy chat_messages_select on public.chat_messages for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or thread_id in (
      select id from public.chat_threads
      where guardian_id = private.guardian_id_for_school(chat_messages.school_id)
         or teacher_id = private.staff_id_for_school(chat_messages.school_id)
    )
  );

create policy chat_messages_insert on public.chat_messages for insert
  with check (
    sender_id = auth.uid()
    and thread_id in (
      select id from public.chat_threads
      where (sender_role = 'guardian' and guardian_id = private.guardian_id_for_school(chat_messages.school_id))
         or (sender_role = 'teacher' and teacher_id = private.staff_id_for_school(chat_messages.school_id))
    )
  );
-- no update/delete policy: chat messages are immutable once sent

-- ─────────────────────────── chat_reports ───────────────────────────
create policy chat_reports_select on public.chat_reports for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or reported_by = auth.uid()
  );

create policy chat_reports_insert on public.chat_reports for insert
  with check (
    reported_by = auth.uid()
    and thread_id in (
      select id from public.chat_threads
      where guardian_id = private.guardian_id_for_school(chat_reports.school_id)
         or teacher_id = private.staff_id_for_school(chat_reports.school_id)
    )
  );

create policy chat_reports_update_admin on public.chat_reports for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));

-- ─────────────────────────── audit_log (immutable, insert-only) ───────────────────────────
create policy audit_log_select_admin on public.audit_log for select
  using (private.has_role_in_school(school_id, array['school_admin']));

create policy audit_log_insert on public.audit_log for insert
  with check (
    actor_id = auth.uid()
    and school_id in (select private.current_school_ids())
  );
-- no update/delete policy for any role: audit_log is append-only (SPEC.md §3.3.8)
