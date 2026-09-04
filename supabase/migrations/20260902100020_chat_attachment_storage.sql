-- Path convention: schools/{school_id}/chat/{thread_id}/{filename}.
-- Mirrors chat_messages/chat_threads RLS exactly: either thread participant
-- can upload/read, admin can read any (SPEC.md §5.4.3 always-on oversight).
create policy chat_attachments_insert on storage.objects for insert
  with check (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'chat'
    and exists (
      select 1 from public.chat_threads t
      where t.id::text = (storage.foldername(name))[4]
        and t.school_id = (storage.foldername(name))[2]::uuid
        and (
          t.guardian_id = private.guardian_id_for_school(t.school_id)
          or t.teacher_id = private.staff_id_for_school(t.school_id)
        )
    )
  );

create policy chat_attachments_select on storage.objects for select
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'chat'
    and (
      private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin'])
      or exists (
        select 1 from public.chat_threads t
        where t.id::text = (storage.foldername(name))[4]
          and t.school_id = (storage.foldername(name))[2]::uuid
          and (
            t.guardian_id = private.guardian_id_for_school(t.school_id)
            or t.teacher_id = private.staff_id_for_school(t.school_id)
          )
      )
    )
  );
