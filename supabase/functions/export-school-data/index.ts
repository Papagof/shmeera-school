import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";

// Every table carrying school_id, per SPEC.md §7 — kept in sync with the
// schema by hand since there's no introspection step here.
const SCHOOL_SCOPED_TABLES = [
  "memberships",
  "classes",
  "staff",
  "guardians",
  "students",
  "guardian_student_links",
  "designees",
  "event_codes",
  "events",
  "security_alerts",
  "chat_threads",
  "chat_messages",
  "chat_reports",
  "audit_log",
  "push_tokens",
];

// POST /export-school-data  { school_id }
// super_admin only, MFA-gated (SPEC.md §3.3.10) — full tenant data export,
// the mandatory first step before offboard-school's hard delete. This is
// the "audited support tooling" carve-out SPEC.md §3.3.6 references: a
// super_admin has no membership in the target school, so authorization
// here is global-role-based rather than the usual per-school pattern, and
// every export is written to audit_log (with no FK back to the school, so
// the record survives even after offboard-school deletes it — see
// 20260902100019_school_offboarding_support.sql).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Missing Authorization header");
    const claims = decodeJwtPayload(token);
    if (claims.aal !== "aal2") throw new HttpError(403, "MFA (aal2) is required for school data export");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const isSuperAdmin = identity.memberships.some((m) => m.role === "super_admin");
    if (!isSuperAdmin) throw new HttpError(403, "super_admin only");

    const body = await req.json().catch(() => ({}));
    const schoolId = body.school_id as string | undefined;
    if (!schoolId) throw new HttpError(400, "school_id is required");

    const service = serviceClient();

    const { data: school, error: schoolErr } = await service.from("schools").select("*").eq("id", schoolId).single();
    if (schoolErr || !school) throw new HttpError(404, "School not found");

    const data: Record<string, unknown[]> = { schools: [school] };
    for (const table of SCHOOL_SCOPED_TABLES) {
      const { data: rows, error } = await service.from(table).select("*").eq("school_id", schoolId);
      if (error) throw new HttpError(500, `Failed to export ${table}: ${error.message}`);
      data[table] = rows ?? [];
    }

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "super_admin",
      action: "school_data_exported",
      target_table: "schools",
      target_id: schoolId,
    });

    return json({ exported_at: new Date().toISOString(), school_id: schoolId, data });
  } catch (err) {
    return errorResponse(err);
  }
});
