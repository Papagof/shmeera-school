-- A chat thread is auto-created the first time a guardian is linked to a
-- student, scoped to that one guardian + the student's assigned primary
-- teacher (SPEC.md §5.4.1). SECURITY DEFINER so it runs regardless of the
-- inserting caller's own row-level access to chat_threads.
create or replace function public.trg_auto_create_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
begin
  select c.teacher_id into v_teacher_id
  from public.students st
  join public.classes c on c.id = st.class_id
  where st.id = new.student_id;

  if v_teacher_id is not null then
    insert into public.chat_threads (school_id, student_id, guardian_id, teacher_id)
    values (new.school_id, new.student_id, new.guardian_id, v_teacher_id)
    on conflict (guardian_id, teacher_id, student_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_auto_create_chat_thread
after insert on public.guardian_student_links
for each row execute function public.trg_auto_create_chat_thread();

-- If a student is assigned a class (and therefore a primary teacher) after
-- their guardian links already exist, backfill threads for all of that
-- student's guardians at that point too.
create or replace function public.trg_backfill_chat_threads_on_class_assign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
begin
  if new.class_id is distinct from old.class_id and new.class_id is not null then
    select teacher_id into v_teacher_id from public.classes where id = new.class_id;
    if v_teacher_id is not null then
      insert into public.chat_threads (school_id, student_id, guardian_id, teacher_id)
      select gsl.school_id, gsl.student_id, gsl.guardian_id, v_teacher_id
      from public.guardian_student_links gsl
      where gsl.student_id = new.id
      on conflict (guardian_id, teacher_id, student_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_backfill_chat_threads_on_class_assign
after update on public.students
for each row execute function public.trg_backfill_chat_threads_on_class_assign();
