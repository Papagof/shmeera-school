-- Supabase's Data API only exposes the `public`/`graphql_public` schemas
-- (api.schemas in config.toml) — the `vault` schema is deliberately not
-- reachable through PostgREST's schema-switching (`.schema("vault")` from
-- supabase-js), even for service_role. Wrap the two Vault operations the
-- Edge Functions need in SECURITY DEFINER functions living in `public` so
-- service_role can call them via `.rpc(...)` instead.

create or replace function public.vault_create_secret(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  return vault.create_secret(p_secret, p_name);
end;
$$;

create or replace function public.vault_get_decrypted_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = p_name;
  return v_secret;
end;
$$;

revoke execute on function public.vault_create_secret(text, text) from public, anon, authenticated;
revoke execute on function public.vault_get_decrypted_secret(text) from public, anon, authenticated;
grant execute on function public.vault_create_secret(text, text) to service_role;
grant execute on function public.vault_get_decrypted_secret(text) to service_role;
