import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { sendSms } from "../_shared/twilio.ts";
import { notifyUsers } from "../_shared/push.ts";

// POST /emergency-broadcast  { message }
// Admin-only, fans out to guardians + staff within the admin's own school
// only (SPEC.md §5.3, §8, §9).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["school_admin"]);

    const body = await req.json().catch(() => ({}));
    const message = (body.message as string | undefined)?.trim();
    if (!message) throw new HttpError(400, "message is required");

    const service = serviceClient();

    const [{ data: guardians, error: guardiansErr }, { data: staff, error: staffErr }] = await Promise.all([
      service.from("guardians").select("user_id, phone").eq("school_id", schoolId).eq("status", "active"),
      service.from("staff").select("user_id, phone").eq("school_id", schoolId),
    ]);
    if (guardiansErr || staffErr) throw new HttpError(500, "Failed to load recipients");

    const people = [...(guardians ?? []), ...(staff ?? [])];
    const phones = people.map((r) => r.phone).filter((phone): phone is string => Boolean(phone));
    const userIds = people.map((r) => r.user_id);

    await Promise.all(phones.map((phone) => sendSms(phone, `[Shmeera Emergency] ${message}`)));
    await notifyUsers(service, schoolId, userIds, "School emergency broadcast", message, { kind: "emergency_broadcast" });

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "school_admin",
      action: "emergency_broadcast_sent",
      metadata: { recipient_count: people.length },
    });

    return json({ recipients_notified: people.length });
  } catch (err) {
    return errorResponse(err);
  }
});
