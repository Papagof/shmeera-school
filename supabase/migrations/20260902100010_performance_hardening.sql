-- Addresses the remaining Supabase advisor findings from the initial deploy:
--
-- 1. auth_rls_initplan: policies referencing auth.uid() directly get it
--    re-evaluated per row instead of once per query. Wrap every such
--    reference in `(select auth.uid())` so the planner hoists it into an
--    InitPlan. (`unused_index` findings are expected noise on an empty,
--    freshly-migrated database and are not addressed here.)
-- 2. multiple_permissive_policies: classes/guardian_student_links/students
--    each had a dedicated `_select` policy AND a `for all` admin policy,
--    which also grants select — two permissive SELECT policies evaluated
--    per query. Split each `for all` into insert/update/delete only.
-- 3. unindexed_foreign_keys: add covering indexes for FK columns that had
--    none.

-- ── auth_rls_initplan ──────────────────────────────────────────────

drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships for select
  using (
    user_id = (select auth.uid())
    or private.has_role_in_school(school_id, array['school_admin'])
    or private.is_super_admin()
  );

drop policy staff_select on public.staff;
create policy staff_select on public.staff for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = (select auth.uid())
    or class_id in (
      select c.id from public.classes c
      where c.school_id = staff.school_id
        and c.id in (
          select cl.class_id from public.students cl
          where cl.id in (select private.guardian_student_ids(staff.school_id))
        )
    )
  );

drop policy guardians_select on public.guardians;
create policy guardians_select on public.guardians for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = (select auth.uid())
    or id in (
      select gsl.guardian_id from public.guardian_student_links gsl
      where gsl.student_id in (select private.teacher_student_ids(school_id))
    )
  );

drop policy guardians_insert_self_or_admin on public.guardians;
create policy guardians_insert_self_or_admin on public.guardians for insert
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or (user_id = (select auth.uid()) and status = 'pending')
  );

drop policy guardians_update on public.guardians;
create policy guardians_update on public.guardians for update
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = (select auth.uid())
  )
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or user_id = (select auth.uid())
  );

drop policy event_codes_select on public.event_codes;
create policy event_codes_select on public.event_codes for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = (select auth.uid())
    or student_id in (select private.teacher_student_ids(school_id))
  );

drop policy event_codes_insert_guardian on public.event_codes;
create policy event_codes_insert_guardian on public.event_codes for insert
  with check (
    issued_by = (select auth.uid())
    and student_id in (select private.guardian_student_ids(school_id))
  );

drop policy event_codes_update on public.event_codes;
create policy event_codes_update on public.event_codes for update
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = (select auth.uid())
  )
  with check (
    private.has_role_in_school(school_id, array['school_admin'])
    or issued_by = (select auth.uid())
  );

drop policy chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert
  with check (
    sender_id = (select auth.uid())
    and thread_id in (
      select id from public.chat_threads
      where (sender_role = 'guardian' and guardian_id = private.guardian_id_for_school(chat_messages.school_id))
         or (sender_role = 'teacher' and teacher_id = private.staff_id_for_school(chat_messages.school_id))
    )
  );

drop policy chat_reports_select on public.chat_reports;
create policy chat_reports_select on public.chat_reports for select
  using (
    private.has_role_in_school(school_id, array['school_admin'])
    or reported_by = (select auth.uid())
  );

drop policy chat_reports_insert on public.chat_reports;
create policy chat_reports_insert on public.chat_reports for insert
  with check (
    reported_by = (select auth.uid())
    and thread_id in (
      select id from public.chat_threads
      where guardian_id = private.guardian_id_for_school(chat_reports.school_id)
         or teacher_id = private.staff_id_for_school(chat_reports.school_id)
    )
  );

drop policy audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert
  with check (
    actor_id = (select auth.uid())
    and school_id in (select private.current_school_ids())
  );

-- ── multiple_permissive_policies ──────────────────────────────────

drop policy classes_write_admin on public.classes;
create policy classes_insert_admin on public.classes for insert
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy classes_update_admin on public.classes for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy classes_delete_admin on public.classes for delete
  using (private.has_role_in_school(school_id, array['school_admin']));

drop policy gsl_write_admin on public.guardian_student_links;
create policy gsl_insert_admin on public.guardian_student_links for insert
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy gsl_update_admin on public.guardian_student_links for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy gsl_delete_admin on public.guardian_student_links for delete
  using (private.has_role_in_school(school_id, array['school_admin']));

drop policy students_write_admin on public.students;
create policy students_insert_admin on public.students for insert
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy students_update_admin on public.students for update
  using (private.has_role_in_school(school_id, array['school_admin']))
  with check (private.has_role_in_school(school_id, array['school_admin']));
create policy students_delete_admin on public.students for delete
  using (private.has_role_in_school(school_id, array['school_admin']));

-- ── unindexed_foreign_keys ─────────────────────────────────────────

create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index chat_messages_sender_id_idx on public.chat_messages (sender_id);
create index chat_reports_message_id_idx on public.chat_reports (message_id);
create index chat_reports_reported_by_idx on public.chat_reports (reported_by);
create index chat_reports_thread_id_idx on public.chat_reports (thread_id);
create index chat_threads_student_id_idx on public.chat_threads (student_id);
create index classes_teacher_id_idx on public.classes (teacher_id);
create index designees_requested_by_guardian_id_idx on public.designees (requested_by_guardian_id);
create index designees_reviewed_by_idx on public.designees (reviewed_by);
create index event_codes_designee_id_idx on public.event_codes (designee_id);
create index event_codes_issued_by_idx on public.event_codes (issued_by);
create index events_event_code_id_idx on public.events (event_code_id);
create index events_validated_by_staff_id_idx on public.events (validated_by_staff_id);
create index security_alerts_acknowledged_by_idx on public.security_alerts (acknowledged_by);
create index security_alerts_student_id_idx on public.security_alerts (student_id);
create index staff_class_id_idx on public.staff (class_id);
