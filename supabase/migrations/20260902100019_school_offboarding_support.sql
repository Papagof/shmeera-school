-- audit_log is meant to be an immutable historical record (SPEC.md §3.3.8,
-- CLAUDE.md rule #8) — cascading it away when the school itself is deleted
-- would destroy the one thing that's supposed to survive: the record that
-- an offboarding happened, by whom, and when. Drop the FK's cascade so the
-- column keeps its historical value after the school row is gone, without
-- enforcing referential integrity against a row that may no longer exist.
alter table public.audit_log drop constraint audit_log_school_id_fkey;

-- Vault secret cleanup for offboarding, mirroring the existing
-- vault_create_secret / vault_get_decrypted_secret wrappers
-- (20260902100011_vault_rpc.sql) — vault isn't reachable via
-- .schema("vault") from an Edge Function, even for service_role.
create or replace function public.vault_delete_secret(p_name text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where name = p_name;
end;
$$;

revoke all on function public.vault_delete_secret(text) from public, anon, authenticated;
grant execute on function public.vault_delete_secret(text) to service_role;
