import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole, listSchoolAdminUserIds } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";

// POST /request-designee  { student_id, full_name, phone?, relationship?, photo_url? }
// Guardian-only, creates a 'pending' designee (SPEC.md §5.1.6, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian"]);

    const body = await req.json().catch(() => ({}));
    const studentId = body.student_id as string | undefined;
    const fullName = (body.full_name as string | undefined)?.trim();
    const photoUrl = (body.photo_url as string | undefined) ?? null;
    if (!studentId || !fullName) throw new HttpError(400, "student_id and full_name are required");

    const service = serviceClient();

    const { data: guardian, error: guardianErr } = await service
      .from("guardians")
      .select("id")
      .eq("school_id", schoolId)
      .eq("user_id", identity.userId)
      .single();
    if (guardianErr || !guardian) throw new HttpError(403, "Not a guardian in this school");

    // A guardian can only reference a photo path they actually own (storage
    // RLS already enforces they can only upload there) — otherwise nothing
    // stops one guardian's designee record from displaying another
    // guardian's photo to the admin at review time, undermining the whole
    // point of the photo requirement (visual identity confirmation).
    if (photoUrl && !photoUrl.startsWith(`schools/${schoolId}/designees/${guardian.id}/`)) {
      throw new HttpError(400, "photo_url must be under this guardian's own designees storage path");
    }

    const { data: link } = await service
      .from("guardian_student_links")
      .select("student_id")
      .eq("school_id", schoolId)
      .eq("guardian_id", guardian.id)
      .eq("student_id", studentId)
      .maybeSingle();
    if (!link) throw new HttpError(403, "Not linked to this student");

    const { data: designee, error: insertErr } = await service
      .from("designees")
      .insert({
        school_id: schoolId,
        requested_by_guardian_id: guardian.id,
        student_id: studentId,
        full_name: fullName,
        phone: body.phone ?? null,
        relationship: body.relationship ?? null,
        photo_url: photoUrl,
        status: "pending",
      })
      .select("id, status")
      .single();
    if (insertErr || !designee) throw new HttpError(500, "Failed to submit designee request");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "guardian",
      action: "designee_requested",
      target_table: "designees",
      target_id: designee.id,
      metadata: { student_id: studentId },
    });

    const adminUserIds = await listSchoolAdminUserIds(service, schoolId);
    await notifyUsers(
      service,
      schoolId,
      adminUserIds,
      "New designee request",
      `${fullName} was requested as a pickup designee.`,
      { kind: "designee_requested", designee_id: designee.id },
    );

    return json({ id: designee.id, status: designee.status });
  } catch (err) {
    return errorResponse(err);
  }
});
