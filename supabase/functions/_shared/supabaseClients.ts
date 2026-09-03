import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./errors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Scoped to the caller's own JWT — every query through this client is still
// subject to RLS, so it's the safe default for reads/writes a role should
// already be allowed to do directly (SPEC.md §3.1).
export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Missing Authorization header");
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

// Bypasses RLS entirely. Only for the specific privileged steps a function
// genuinely needs elevated access for (Vault secrets, cross-guardian
// visibility checks, writes to immutable tables) — every such use must
// re-derive and re-check the caller's own school/role first via userClient,
// never trust the request body for authorization (SPEC.md §3.3.4).
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
