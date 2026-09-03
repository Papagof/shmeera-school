import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./errors.ts";

export interface CallerIdentity {
  userId: string;
  memberships: { school_id: string; role: string }[];
}

// Resolves the caller's identity and school(s) from their JWT — the very
// first thing every function does, before looking at the request body at
// all. A school_id in the body is never used for authorization decisions
// (SPEC.md §3.3.4, CLAUDE.md rule #2).
export async function resolveCaller(supabase: SupabaseClient): Promise<CallerIdentity> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) throw new HttpError(401, "Not authenticated");

  const { data: memberships, error: memErr } = await supabase
    .from("memberships")
    .select("school_id, role")
    .eq("user_id", userData.user.id);
  if (memErr) throw new HttpError(500, "Failed to resolve membership");

  return { userId: userData.user.id, memberships: memberships ?? [] };
}

export function requireSchoolRole(identity: CallerIdentity, schoolId: string, roles: string[]): void {
  const match = identity.memberships.some((m) => m.school_id === schoolId && roles.includes(m.role));
  if (!match) throw new HttpError(403, "Not authorized for this school/role");
}

// Picks the school where the caller holds one of the given roles. A caller
// can belong to more than one school (rare, but not forbidden) — the first
// eligible match is used, which is fine for the guardian/teacher/admin
// single-role-per-request flows this app has today.
export function resolveSchoolForRole(identity: CallerIdentity, roles: string[]): string {
  const match = identity.memberships.find((m) => roles.includes(m.role));
  if (!match) throw new HttpError(403, "No membership with an eligible role");
  return match.school_id;
}

// user_ids of every school_admin in a school, for notifying admins of
// things like designee requests and chat reports (SPEC.md §9).
export async function listSchoolAdminUserIds(supabase: SupabaseClient, schoolId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("school_id", schoolId)
    .eq("role", "school_admin");
  if (error || !data) return [];
  return data.map((m) => m.user_id);
}
