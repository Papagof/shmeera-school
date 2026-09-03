-- Defense-in-depth: cross-school foreign key enforcement independent of RLS.
-- RLS controls *who* can see/write a row; these triggers guarantee that rows
-- which reference each other always agree on school_id, so a bug or a
-- service_role-authored insert can never wire School A to School B.
-- (SPEC.md §3.3.1)

create or replace function private.assert_same_school(p_a uuid, p_b uuid, p_context text)
returns void
language plpgsql
as $$
begin
  if p_a is null or p_b is null or p_a <> p_b then
    raise exception 'tenant isolation violation: % (% <> %)', p_context, p_a, p_b;
  end if;
end;
$$;

-- classes.teacher_id -> staff.school_id
create or replace function public.trg_classes_same_school()
returns trigger language plpgsql as $$
declare v_staff_school uuid;
begin
  if new.teacher_id is not null then
    select school_id into v_staff_school from public.staff where id = new.teacher_id;
    perform private.assert_same_school(new.school_id, v_staff_school, 'classes.teacher_id');
  end if;
  return new;
end;
$$;
create trigger trg_classes_same_school
before insert or update on public.classes
for each row execute function public.trg_classes_same_school();

-- staff.class_id -> classes.school_id
create or replace function public.trg_staff_same_school()
returns trigger language plpgsql as $$
declare v_class_school uuid;
begin
  if new.class_id is not null then
    select school_id into v_class_school from public.classes where id = new.class_id;
    perform private.assert_same_school(new.school_id, v_class_school, 'staff.class_id');
  end if;
  return new;
end;
$$;
create trigger trg_staff_same_school
before insert or update on public.staff
for each row execute function public.trg_staff_same_school();

-- students.class_id -> classes.school_id
create or replace function public.trg_students_same_school()
returns trigger language plpgsql as $$
declare v_class_school uuid;
begin
  if new.class_id is not null then
    select school_id into v_class_school from public.classes where id = new.class_id;
    perform private.assert_same_school(new.school_id, v_class_school, 'students.class_id');
  end if;
  return new;
end;
$$;
create trigger trg_students_same_school
before insert or update on public.students
for each row execute function public.trg_students_same_school();

-- guardian_student_links: guardian, student, and link row must all share school_id
create or replace function public.trg_gsl_same_school()
returns trigger language plpgsql as $$
declare v_guardian_school uuid; v_student_school uuid;
begin
  select school_id into v_guardian_school from public.guardians where id = new.guardian_id;
  select school_id into v_student_school from public.students where id = new.student_id;
  perform private.assert_same_school(new.school_id, v_guardian_school, 'guardian_student_links.guardian_id');
  perform private.assert_same_school(new.school_id, v_student_school, 'guardian_student_links.student_id');
  return new;
end;
$$;
create trigger trg_gsl_same_school
before insert or update on public.guardian_student_links
for each row execute function public.trg_gsl_same_school();

-- designees: requesting guardian + student must share the link's school_id
create or replace function public.trg_designees_same_school()
returns trigger language plpgsql as $$
declare v_guardian_school uuid; v_student_school uuid;
begin
  select school_id into v_guardian_school from public.guardians where id = new.requested_by_guardian_id;
  select school_id into v_student_school from public.students where id = new.student_id;
  perform private.assert_same_school(new.school_id, v_guardian_school, 'designees.requested_by_guardian_id');
  perform private.assert_same_school(new.school_id, v_student_school, 'designees.student_id');
  return new;
end;
$$;
create trigger trg_designees_same_school
before insert or update on public.designees
for each row execute function public.trg_designees_same_school();

-- event_codes: student + (optional) designee must share school_id
create or replace function public.trg_event_codes_same_school()
returns trigger language plpgsql as $$
declare v_student_school uuid; v_designee_school uuid; v_designee_status text;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  perform private.assert_same_school(new.school_id, v_student_school, 'event_codes.student_id');
  if new.designee_id is not null then
    select school_id, status into v_designee_school, v_designee_status from public.designees where id = new.designee_id;
    perform private.assert_same_school(new.school_id, v_designee_school, 'event_codes.designee_id');
    if v_designee_status <> 'approved' then
      raise exception 'event_codes.designee_id: designee is not approved';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_event_codes_same_school
before insert or update on public.event_codes
for each row execute function public.trg_event_codes_same_school();

-- events: student, event_code, validating staff must share school_id
create or replace function public.trg_events_same_school()
returns trigger language plpgsql as $$
declare v_student_school uuid; v_code_school uuid; v_staff_school uuid;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  perform private.assert_same_school(new.school_id, v_student_school, 'events.student_id');
  select school_id into v_staff_school from public.staff where id = new.validated_by_staff_id;
  perform private.assert_same_school(new.school_id, v_staff_school, 'events.validated_by_staff_id');
  if new.event_code_id is not null then
    select school_id into v_code_school from public.event_codes where id = new.event_code_id;
    perform private.assert_same_school(new.school_id, v_code_school, 'events.event_code_id');
  end if;
  return new;
end;
$$;
create trigger trg_events_same_school
before insert on public.events
for each row execute function public.trg_events_same_school();

-- chat_threads: student, guardian, teacher must all share school_id
create or replace function public.trg_chat_threads_same_school()
returns trigger language plpgsql as $$
declare v_student_school uuid; v_guardian_school uuid; v_teacher_school uuid;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  select school_id into v_guardian_school from public.guardians where id = new.guardian_id;
  select school_id into v_teacher_school from public.staff where id = new.teacher_id;
  perform private.assert_same_school(new.school_id, v_student_school, 'chat_threads.student_id');
  perform private.assert_same_school(new.school_id, v_guardian_school, 'chat_threads.guardian_id');
  perform private.assert_same_school(new.school_id, v_teacher_school, 'chat_threads.teacher_id');
  return new;
end;
$$;
create trigger trg_chat_threads_same_school
before insert or update on public.chat_threads
for each row execute function public.trg_chat_threads_same_school();

-- chat_messages / chat_reports: thread must share school_id
create or replace function public.trg_chat_messages_same_school()
returns trigger language plpgsql as $$
declare v_thread_school uuid;
begin
  select school_id into v_thread_school from public.chat_threads where id = new.thread_id;
  perform private.assert_same_school(new.school_id, v_thread_school, 'chat_messages.thread_id');
  return new;
end;
$$;
create trigger trg_chat_messages_same_school
before insert on public.chat_messages
for each row execute function public.trg_chat_messages_same_school();

create or replace function public.trg_chat_reports_same_school()
returns trigger language plpgsql as $$
declare v_thread_school uuid;
begin
  select school_id into v_thread_school from public.chat_threads where id = new.thread_id;
  perform private.assert_same_school(new.school_id, v_thread_school, 'chat_reports.thread_id');
  return new;
end;
$$;
create trigger trg_chat_reports_same_school
before insert on public.chat_reports
for each row execute function public.trg_chat_reports_same_school();

-- event_codes: once issued, a client (non service_role) may only ever flip
-- revoked false -> true. Marking a code used, or changing anything else,
-- must go through the service-role validate-event-code Edge Function.
create or replace function public.trg_event_codes_protect_fields()
returns trigger language plpgsql as $$
begin
  -- auth.role() checks both the flattened request.jwt.claim.role GUC and
  -- the JSON request.jwt.claims fallback; PostgREST doesn't always set the
  -- former, so a raw current_setting('request.jwt.claim.role', ...) check
  -- here would silently treat service-role calls as non-service-role ones.
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.used_at is distinct from old.used_at
     or new.code is distinct from old.code
     or new.qr_payload is distinct from old.qr_payload
     or new.expires_at is distinct from old.expires_at
     or new.student_id is distinct from old.student_id
     or new.school_id is distinct from old.school_id
     or (old.revoked = true and new.revoked = false) then
    raise exception 'event_codes: only revoked may be set (false -> true) outside the service role';
  end if;
  return new;
end;
$$;
create trigger trg_event_codes_protect_fields
before update on public.event_codes
for each row execute function public.trg_event_codes_protect_fields();

-- schools: signing_secret_ref is provisioned once at onboarding by service_role only.
create or replace function public.trg_schools_protect_secret()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.signing_secret_ref is distinct from old.signing_secret_ref then
    raise exception 'schools.signing_secret_ref can only be changed by the service role';
  end if;
  return new;
end;
$$;
create trigger trg_schools_protect_secret
before update on public.schools
for each row execute function public.trg_schools_protect_secret();
