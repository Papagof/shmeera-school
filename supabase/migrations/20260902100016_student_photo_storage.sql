insert into storage.buckets (id, name, public)
values ('shmeera', 'shmeera', false)
on conflict (id) do nothing;

-- Path convention: schools/{school_id}/students/{student_id}/{filename}
-- (SPEC.md §3.3.3). Storage RLS mirrors the students table's own RLS
-- (students_select / students_write_admin, 20260902100005_rls_policies.sql)
-- exactly, using the same private.* helper functions — a signed URL for
-- one school's photo can't be produced by a caller outside that school's
-- membership graph, matching CLAUDE.md rule #5 (storage isolation).
create policy student_photos_select on storage.objects for select
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'students'
    and (
      private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin'])
      or (storage.foldername(name))[4]::uuid in (select private.guardian_student_ids((storage.foldername(name))[2]::uuid))
      or (storage.foldername(name))[4]::uuid in (select private.teacher_student_ids((storage.foldername(name))[2]::uuid))
    )
  );

create policy student_photos_insert_admin on storage.objects for insert
  with check (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'students'
    and private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin'])
  );

create policy student_photos_update_admin on storage.objects for update
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'students'
    and private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin'])
  );

create policy student_photos_delete_admin on storage.objects for delete
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'students'
    and private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin'])
  );
