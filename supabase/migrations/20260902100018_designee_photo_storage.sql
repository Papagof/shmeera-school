-- Path convention: schools/{school_id}/designees/{guardian_id}/{filename}.
-- Guardian uploads to their own folder (their guardian_id, resolved
-- server-side via private.guardian_id_for_school — never trusted from the
-- path itself for authorization, only used to construct where they're
-- allowed to write). Read is admin + any teacher in the school (they need
-- to see designee photos at the gate, SPEC.md §6.6) + the uploading
-- guardian themselves — not every guardian in the school, unlike the
-- broader same-role read policy used for override photos.
create policy designee_photos_insert_guardian on storage.objects for insert
  with check (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'designees'
    and (storage.foldername(name))[4] = private.guardian_id_for_school((storage.foldername(name))[2]::uuid)::text
  );

create policy designee_photos_select on storage.objects for select
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'designees'
    and (
      private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin', 'teacher'])
      or (storage.foldername(name))[4] = private.guardian_id_for_school((storage.foldername(name))[2]::uuid)::text
    )
  );
