-- RLS helper functions. All SECURITY DEFINER + STABLE, all resolve identity
-- from auth.uid() / the caller's memberships row — never from a client-supplied
-- school_id (SPEC.md §3.3.4). Kept in `private` so PostgREST never exposes
-- them as RPC endpoints (see 20260902100001_extensions.sql).

create or replace function private.current_school_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.memberships where user_id = auth.uid();
$$;

create or replace function private.has_role_in_school(p_school_id uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and school_id = p_school_id and role = any(p_roles)
  );
$$;

create or replace function private.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships where user_id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function private.guardian_id_for_school(p_school_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.guardians where user_id = auth.uid() and school_id = p_school_id;
$$;

create or replace function private.staff_id_for_school(p_school_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where user_id = auth.uid() and school_id = p_school_id;
$$;

-- Student ids reachable by the caller as a guardian, in one school.
create or replace function private.guardian_student_ids(p_school_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select gsl.student_id
  from public.guardian_student_links gsl
  join public.guardians g on g.id = gsl.guardian_id
  where g.user_id = auth.uid() and gsl.school_id = p_school_id;
$$;

-- Class ids the caller teaches, in one school.
create or replace function private.teacher_class_ids(p_school_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id
  from public.classes c
  join public.staff s on s.id = c.teacher_id
  where s.user_id = auth.uid() and c.school_id = p_school_id;
$$;

-- Student ids reachable by the caller as a teacher (their own class roster), in one school.
create or replace function private.teacher_student_ids(p_school_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select st.id
  from public.students st
  where st.school_id = p_school_id
    and st.class_id in (select private.teacher_class_ids(p_school_id));
$$;

grant execute on all functions in schema private to authenticated;
