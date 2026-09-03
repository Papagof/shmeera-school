alter table public.events alter column geo drop not null;
alter table public.events add column manual_override boolean not null default false;
alter table public.events add column override_note text;
alter table public.events add column override_photo_path text;

-- Teacher-writable override photos, separate from the admin-only student
-- photo path (20260902100016) — path convention:
-- schools/{school_id}/overrides/{staff_id}/{timestamp}-{filename}.
-- Same isolation pattern: private.* helpers, no cross-school reachability.
create policy override_photos_insert_teacher on storage.objects for insert
  with check (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'overrides'
    and private.has_role_in_school((storage.foldername(name))[2]::uuid, array['teacher'])
  );

create policy override_photos_select on storage.objects for select
  using (
    bucket_id = 'shmeera'
    and (storage.foldername(name))[1] = 'schools'
    and (storage.foldername(name))[3] = 'overrides'
    and private.has_role_in_school((storage.foldername(name))[2]::uuid, array['school_admin', 'teacher'])
  );
