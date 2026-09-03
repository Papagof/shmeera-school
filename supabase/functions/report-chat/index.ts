import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole, listSchoolAdminUserIds } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";

// POST /report-chat  { thread_id, message_id?, reason }
// Either thread participant (SPEC.md §5.4, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian", "teacher"]);

    const body = await req.json().catch(() => ({}));
    const threadId = body.thread_id as string | undefined;
    const messageId = (body.message_id as string | undefined) ?? null;
    const reason = (body.reason as string | undefined)?.trim();
    if (!threadId || !reason) throw new HttpError(400, "thread_id and reason are required");

    const service = serviceClient();

    const { data: thread, error: threadErr } = await service
      .from("chat_threads")
      .select("id, guardian_id, teacher_id")
      .eq("id", threadId)
      .eq("school_id", schoolId)
      .single();
    if (threadErr || !thread) throw new HttpError(404, "Thread not found");

    const [{ data: guardian }, { data: staff }] = await Promise.all([
      service.from("guardians").select("id").eq("school_id", schoolId).eq("user_id", identity.userId).maybeSingle(),
      service.from("staff").select("id").eq("school_id", schoolId).eq("user_id", identity.userId).maybeSingle(),
    ]);
    const isParticipant = (guardian && thread.guardian_id === guardian.id) ||
      (staff && thread.teacher_id === staff.id);
    if (!isParticipant) throw new HttpError(403, "Not a participant of this thread");

    const { data: report, error: insertErr } = await service
      .from("chat_reports")
      .insert({ school_id: schoolId, thread_id: threadId, message_id: messageId, reported_by: identity.userId, reason })
      .select("id")
      .single();
    if (insertErr || !report) throw new HttpError(500, "Failed to file report");

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      action: "chat_report_filed",
      target_table: "chat_reports",
      target_id: report.id,
      metadata: { thread_id: threadId, message_id: messageId },
    });

    const adminUserIds = await listSchoolAdminUserIds(service, schoolId);
    await notifyUsers(
      service,
      schoolId,
      adminUserIds,
      "Chat report filed",
      `A message or thread was reported: ${reason}`,
      { kind: "chat_report_filed", thread_id: threadId, report_id: report.id },
    );

    return json({ id: report.id });
  } catch (err) {
    return errorResponse(err);
  }
});
