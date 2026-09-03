import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";

// POST /review-designee  { designee_id, decision: 'approved'|'rejected' }
// Admin-only (SPEC.md §5.1.6, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["school_admin"]);

    const body = await req.json().catch(() => ({}));
    const designeeId = body.designee_id as string | undefined;
    const decision = body.decision as "approved" | "rejected" | undefined;
    if (!designeeId || !decision || !["approved", "rejected"].includes(decision)) {
      throw new HttpError(400, "designee_id and decision ('approved'|'rejected') are required");
    }

    const service = serviceClient();

    const { data: designee, error: fetchErr } = await service
      .from("designees")
      .select("id, status, school_id, full_name, requested_by_guardian_id, guardians!inner(user_id)")
      .eq("id", designeeId)
      .eq("school_id", schoolId)
      .single();
    if (fetchErr || !designee) throw new HttpError(404, "Designee request not found");
    if (designee.status !== "pending") throw new HttpError(409, "Designee request has already been reviewed");

    const { error: updateErr } = await service
      .from("designees")
      .update({ status: decision, reviewed_by: identity.userId, reviewed_at: new Date().toISOString() })
      .eq("id", designeeId);
    if (updateErr) throw new HttpError(500, "Failed to update designee request");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "school_admin",
      action: `designee_${decision}`,
      target_table: "designees",
      target_id: designeeId,
    });

    const guardianUserId = (designee as unknown as { guardians: { user_id: string } }).guardians.user_id;
    await notifyUsers(
      service,
      schoolId,
      [guardianUserId],
      decision === "approved" ? "Designee approved" : "Designee rejected",
      `${designee.full_name} was ${decision} by the school.`,
      { kind: "designee_reviewed", designee_id: designeeId, decision },
    );

    return json({ id: designeeId, status: decision });
  } catch (err) {
    return errorResponse(err);
  }
});
