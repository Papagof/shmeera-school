import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole, listSchoolAdminUserIds } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";

// POST /manual-override-release  { student_id, type: 'dropoff'|'pickup', released_to_name, note, photo_path }
// Teacher-only. The offline fallback (SPEC.md §6.13): used when a fresh
// location fix or connectivity isn't available and validate-event-code's
// mandatory-geolocation control (§6.7, CLAUDE.md rule #9) can't be
// satisfied — no event_code is involved at all, this is a fully manual
// release the teacher directly attests to, with a mandatory photo + note
// standing in for the normal code-and-location verification. Every use is
// flagged as a security_alerts row for admin review, not silently logged.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["teacher"]);

    const body = await req.json().catch(() => ({}));
    const studentId = body.student_id as string | undefined;
    const type = body.type as "dropoff" | "pickup" | undefined;
    const releasedToName = (body.released_to_name as string | undefined)?.trim();
    const note = (body.note as string | undefined)?.trim();
    const photoPath = (body.photo_path as string | undefined)?.trim();

    if (!studentId || !type || !["dropoff", "pickup"].includes(type)) {
      throw new HttpError(400, "student_id and type ('dropoff'|'pickup') are required");
    }
    if (!releasedToName || !note) {
      throw new HttpError(400, "released_to_name and note are mandatory for a manual override (SPEC.md §6.13)");
    }
    if (!photoPath) throw new HttpError(400, "photo_path is mandatory for a manual override (SPEC.md §6.13)");
    if (!photoPath.startsWith(`schools/${schoolId}/overrides/`)) {
      throw new HttpError(400, "photo_path must be under this school's own overrides path");
    }

    const service = serviceClient();

    const { data: staff, error: staffErr } = await service
      .from("staff")
      .select("id, class_id")
      .eq("school_id", schoolId)
      .eq("user_id", identity.userId)
      .single();
    if (staffErr || !staff) throw new HttpError(403, "Not a staff member in this school");

    const { data: student, error: studentErr } = await service
      .from("students")
      .select("id, full_name, class_id")
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .single();
    if (studentErr || !student || student.class_id !== staff.class_id) {
      throw new HttpError(403, "This student is not on your class roster");
    }

    const { data: event, error: eventErr } = await service
      .from("events")
      .insert({
        school_id: schoolId,
        student_id: student.id,
        event_code_id: null,
        type,
        validated_by_staff_id: staff.id,
        released_to_name: releasedToName,
        geo: null,
        device_info: { manual_override: true },
        manual_override: true,
        override_note: note,
        override_photo_path: photoPath,
      })
      .select("id, created_at")
      .single();
    if (eventErr || !event) throw new HttpError(500, "Failed to record the manual override event");

    await service.from("security_alerts").insert({
      school_id: schoolId,
      student_id: student.id,
      kind: "manual_override_release",
      details: { event_id: event.id, staff_id: staff.id, released_to_name: releasedToName, note, photo_path: photoPath },
    });

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "teacher",
      action: "manual_override_release",
      target_table: "events",
      target_id: event.id,
      metadata: { student_id: student.id, type },
    });

    const adminUserIds = await listSchoolAdminUserIds(service, schoolId);
    await notifyUsers(
      service,
      schoolId,
      adminUserIds,
      "Manual override release",
      `${student.full_name} was released to ${releasedToName} without a code or location fix — needs review.`,
      { kind: "manual_override_release", event_id: event.id },
    );

    return json({ event_id: event.id, student_name: student.full_name, released_to_name: releasedToName, created_at: event.created_at });
  } catch (err) {
    return errorResponse(err);
  }
});
