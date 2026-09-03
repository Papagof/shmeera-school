import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { getSchoolSigningSecret, hmacSign } from "../_shared/signing.ts";
import { writeAudit } from "../_shared/audit.ts";
import { generateNumericCode } from "../_shared/code.ts";
import type { SchoolSettings } from "../_shared/schoolSettings.ts";

// POST /generate-event-code  { student_id, type: 'dropoff'|'pickup', designee_id? }
// Guardian-only. SPEC.md §5.1, §8.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    // First line: resolve who's calling and which school they belong to as
    // a guardian, from their JWT — never from the request body.
    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian"]);

    const body = await req.json().catch(() => ({}));
    const studentId = body.student_id as string | undefined;
    const type = body.type as "dropoff" | "pickup" | undefined;
    const designeeId = (body.designee_id as string | undefined) ?? null;
    if (!studentId || !type || !["dropoff", "pickup"].includes(type)) {
      throw new HttpError(400, "student_id and type ('dropoff'|'pickup') are required");
    }

    const service = serviceClient();

    const { data: guardian, error: guardianErr } = await service
      .from("guardians")
      .select("id, status")
      .eq("school_id", schoolId)
      .eq("user_id", identity.userId)
      .single();
    if (guardianErr || !guardian) throw new HttpError(403, "Not a guardian in this school");
    if (guardian.status !== "active") throw new HttpError(403, "Guardian account is not active");

    const { data: link, error: linkErr } = await service
      .from("guardian_student_links")
      .select("pickup_authorized, restriction_note")
      .eq("school_id", schoolId)
      .eq("guardian_id", guardian.id)
      .eq("student_id", studentId)
      .maybeSingle();
    if (linkErr || !link) throw new HttpError(403, "Not linked to this student");

    if (!link.pickup_authorized || link.restriction_note) {
      // Custody restriction flag: block AND escalate immediately (SPEC.md §6.5).
      await service.from("security_alerts").insert({
        school_id: schoolId,
        student_id: studentId,
        kind: "custody_restricted_attempt",
        details: { guardian_id: guardian.id, type, restriction_note: link.restriction_note },
      });
      throw new HttpError(403, "This guardian is not authorized to release this student");
    }

    if (designeeId) {
      const { data: designee, error: designeeErr } = await service
        .from("designees")
        .select("id, status, student_id")
        .eq("school_id", schoolId)
        .eq("id", designeeId)
        .single();
      if (designeeErr || !designee) throw new HttpError(404, "Designee not found");
      if (designee.status !== "approved") throw new HttpError(403, "Designee has not been approved by the school");
      if (designee.student_id !== studentId) throw new HttpError(400, "Designee is not linked to this student");
    }

    const { data: existing } = await service
      .from("event_codes")
      .select("id")
      .eq("school_id", schoolId)
      .eq("student_id", studentId)
      .eq("type", type)
      .is("used_at", null)
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (existing) throw new HttpError(409, "An active code already exists for this student and type");

    const { data: school, error: schoolErr } = await service
      .from("schools")
      .select("settings")
      .eq("id", schoolId)
      .single();
    if (schoolErr || !school) throw new HttpError(500, "School not found");
    const settings = school.settings as SchoolSettings;
    const ttlMinutes = settings?.code_ttl_minutes ?? 10;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    const code = generateNumericCode(6);
    const secret = await getSchoolSigningSecret(service, schoolId);
    const payload = { school_id: schoolId, student_id: studentId, type, code, exp: expiresAt.toISOString() };
    const payloadJson = JSON.stringify(payload);
    const signature = await hmacSign(secret, payloadJson);
    const qrPayload = `${btoa(payloadJson)}.${signature}`;

    const { data: eventCode, error: insertErr } = await service
      .from("event_codes")
      .insert({
        school_id: schoolId,
        student_id: studentId,
        type,
        code,
        qr_payload: qrPayload,
        issued_by: identity.userId,
        designee_id: designeeId,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, code, qr_payload, expires_at")
      .single();
    if (insertErr || !eventCode) throw new HttpError(500, "Failed to create event code");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "guardian",
      action: "event_code_generated",
      target_table: "event_codes",
      target_id: eventCode.id,
      metadata: { student_id: studentId, type, designee_id: designeeId },
    });

    // TODO(build order step 8): SMS the code as a backup via Twilio when the
    // guardian opts in (SPEC.md §5.1.5) — needs the guardian's verified phone,
    // already on public.guardians.phone.

    return json({
      id: eventCode.id,
      code: eventCode.code,
      qr_payload: eventCode.qr_payload,
      expires_at: eventCode.expires_at,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
