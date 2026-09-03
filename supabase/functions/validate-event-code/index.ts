import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { decodeQrPayload, getSchoolSigningSecret, hmacVerify } from "../_shared/signing.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";

interface Geo {
  lat: number;
  lng: number;
  accuracy?: number;
  captured_at?: string;
}

function isValidGeo(geo: unknown): geo is Geo {
  return !!geo && typeof geo === "object" && typeof (geo as Geo).lat === "number" &&
    typeof (geo as Geo).lng === "number";
}

async function flagInvalid(
  service: SupabaseClient,
  schoolId: string,
  staffId: string | null,
  kind: string,
  details: Record<string, unknown>,
) {
  await service.from("security_alerts").insert({
    school_id: schoolId,
    kind,
    details: { ...details, staff_id: staffId },
  });
}

// POST /validate-event-code  { code?, qr_payload?, geo: {lat,lng,...}, device_info? }
// Teacher-only. SPEC.md §5.2, §8.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["teacher"]);

    const body = await req.json().catch(() => ({}));
    const geo = body.geo;
    const deviceInfo = body.device_info ?? null;

    // Mandatory geolocation capture at scan-time (SPEC.md §6.7) — a required
    // control, not opt-in. No fix means no release through this normal flow;
    // the client must fall back to the offline manual-override path, which
    // is itself flagged for admin review on resync.
    if (!isValidGeo(geo)) {
      throw new HttpError(
        422,
        "A fresh device location is required to validate a code. Use the offline manual-override flow if location is unavailable.",
      );
    }

    const service = serviceClient();

    const { data: staff, error: staffErr } = await service
      .from("staff")
      .select("id, class_id")
      .eq("school_id", schoolId)
      .eq("user_id", identity.userId)
      .single();
    if (staffErr || !staff) throw new HttpError(403, "Not a staff member in this school");

    let code = body.code as string | undefined;
    const qrPayload = body.qr_payload as string | undefined;

    if (qrPayload) {
      const { payloadJson, signature } = decodeQrPayload(qrPayload);
      const parsed = JSON.parse(payloadJson) as {
        school_id: string;
        student_id: string;
        type: string;
        code: string;
        exp: string;
      };
      if (parsed.school_id !== schoolId) {
        await flagInvalid(service, schoolId, staff.id, "wrong_tenant_qr", { scanned_school_id: parsed.school_id });
        throw new HttpError(403, "STOP: this code does not belong to your school");
      }
      const secret = await getSchoolSigningSecret(service, schoolId);
      const valid = await hmacVerify(secret, payloadJson, signature);
      if (!valid) {
        await flagInvalid(service, schoolId, staff.id, "invalid_qr_signature", {});
        throw new HttpError(403, "STOP: code signature is invalid");
      }
      code = parsed.code;
    }

    if (!code) throw new HttpError(400, "code or qr_payload is required");

    const { data: eventCode, error: codeErr } = await service
      .from("event_codes")
      .select("id, student_id, type, expires_at, used_at, revoked, designee_id, issued_by")
      .eq("school_id", schoolId)
      .eq("code", code)
      .maybeSingle();

    if (codeErr || !eventCode) {
      await flagInvalid(service, schoolId, staff.id, "code_not_found", { code });
      throw new HttpError(404, "STOP: code not found for this school");
    }
    if (eventCode.revoked) {
      await flagInvalid(service, schoolId, staff.id, "code_revoked", { event_code_id: eventCode.id });
      throw new HttpError(410, "STOP: code has been revoked");
    }
    if (eventCode.used_at) {
      await flagInvalid(service, schoolId, staff.id, "code_reused", { event_code_id: eventCode.id });
      throw new HttpError(410, "STOP: code has already been used");
    }
    if (new Date(eventCode.expires_at).getTime() < Date.now()) {
      await flagInvalid(service, schoolId, staff.id, "code_expired", { event_code_id: eventCode.id });
      throw new HttpError(410, "STOP: code has expired");
    }

    const { data: student, error: studentErr } = await service
      .from("students")
      .select("id, full_name, class_id")
      .eq("id", eventCode.student_id)
      .single();
    if (studentErr || !student || student.class_id !== staff.class_id) {
      await flagInvalid(service, schoolId, staff.id, "wrong_class", { event_code_id: eventCode.id });
      throw new HttpError(403, "STOP: this student is not on your class roster");
    }

    let releasedToName = student.full_name;
    let designeePreview: { full_name: string; photo_url: string | null } | null = null;
    if (eventCode.designee_id) {
      const { data: designee } = await service
        .from("designees")
        .select("full_name, photo_url, status")
        .eq("id", eventCode.designee_id)
        .single();
      if (!designee || designee.status !== "approved") {
        await flagInvalid(service, schoolId, staff.id, "designee_not_approved", { event_code_id: eventCode.id });
        throw new HttpError(403, "STOP: designee is not approved");
      }
      releasedToName = designee.full_name;
      designeePreview = { full_name: designee.full_name, photo_url: designee.photo_url };
    }

    // Guard against two simultaneous scans racing on the same code: only
    // succeeds if used_at is still null at update time.
    const { data: claimed, error: updateErr } = await service
      .from("event_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", eventCode.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (updateErr || !claimed) throw new HttpError(409, "Code was just used by another scan");

    const { data: event, error: eventErr } = await service
      .from("events")
      .insert({
        school_id: schoolId,
        student_id: student.id,
        event_code_id: eventCode.id,
        type: eventCode.type,
        validated_by_staff_id: staff.id,
        released_to_name: releasedToName,
        geo,
        device_info: deviceInfo,
      })
      .select("id, created_at")
      .single();
    if (eventErr || !event) throw new HttpError(500, "Failed to record the event");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "teacher",
      action: "event_code_validated",
      target_table: "events",
      target_id: event.id,
      metadata: { student_id: student.id, type: eventCode.type },
    });

    // The admin live feed updates automatically via Realtime on `events`
    // (20260902100007_realtime.sql) — no extra code needed here.
    await notifyUsers(
      service,
      schoolId,
      [eventCode.issued_by],
      `${eventCode.type === "dropoff" ? "Drop-off" : "Pickup"} confirmed`,
      `${student.full_name} was released to ${releasedToName}.`,
      { kind: "code_validated", event_id: event.id },
    );

    return json({
      event_id: event.id,
      student_name: student.full_name,
      released_to_name: releasedToName,
      designee: designeePreview,
      validated_at: event.created_at,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
