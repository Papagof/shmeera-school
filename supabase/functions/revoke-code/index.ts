import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";

// POST /revoke-code  { event_code_id }
// Admin or the issuing guardian (SPEC.md §5.3, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["school_admin", "guardian"]);

    const body = await req.json().catch(() => ({}));
    const eventCodeId = body.event_code_id as string | undefined;
    if (!eventCodeId) throw new HttpError(400, "event_code_id is required");

    const service = serviceClient();

    const { data: eventCode, error: fetchErr } = await service
      .from("event_codes")
      .select("id, school_id, issued_by, revoked, used_at")
      .eq("id", eventCodeId)
      .eq("school_id", schoolId)
      .single();
    if (fetchErr || !eventCode) throw new HttpError(404, "Code not found");

    const isAdmin = identity.memberships.some((m) => m.school_id === schoolId && m.role === "school_admin");
    if (!isAdmin && eventCode.issued_by !== identity.userId) {
      throw new HttpError(403, "Only the issuing guardian or a school admin can revoke this code");
    }
    if (eventCode.used_at) throw new HttpError(409, "Code has already been used and cannot be revoked");
    if (eventCode.revoked) return json({ id: eventCode.id, revoked: true });

    const { error: updateErr } = await service.from("event_codes").update({ revoked: true }).eq("id", eventCodeId);
    if (updateErr) throw new HttpError(500, "Failed to revoke code");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: isAdmin ? "school_admin" : "guardian",
      action: "event_code_revoked",
      target_table: "event_codes",
      target_id: eventCodeId,
    });

    return json({ id: eventCode.id, revoked: true });
  } catch (err) {
    return errorResponse(err);
  }
});
