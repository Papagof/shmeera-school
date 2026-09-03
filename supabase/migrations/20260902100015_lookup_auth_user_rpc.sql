-- SECURITY DEFINER wrapper so the invite-member Edge Function can look up
-- an existing auth.users row by email (auth.users isn't in a Data-API
-- exposed schema for anon/authenticated, and there's no email filter on
-- supabase-js's admin.listUsers() in this SDK version) without granting any
-- broader access to auth. service_role only, same pattern as the vault RPC
-- wrappers in 20260902100011_vault_rpc.sql.
create or replace function public.lookup_auth_user_id(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.lookup_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_id(text) to service_role;
