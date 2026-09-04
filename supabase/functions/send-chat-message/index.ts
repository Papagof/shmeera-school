import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { notifyUsers } from "../_shared/push.ts";
import type { SchoolSettings } from "../_shared/schoolSettings.ts";

function isQuietHours(settings: SchoolSettings, timezone: string): boolean {
  const { start, end } = settings.quiet_hours ?? { start: "18:00", end: "07:00" };
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  // now, start, end are all "HH:MM" strings — comparable lexicographically.
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end; // window wraps midnight
}

// POST /send-chat-message  { thread_id, body?, attachment_url? }
// Guardian or teacher, must be a participant of the thread (SPEC.md §5.4, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian", "teacher"]);

    const body = await req.json().catch(() => ({}));
    const threadId = body.thread_id as string | undefined;
    const messageBody = (body.body as string | undefined)?.trim() ?? null;
    const attachmentUrl = (body.attachment_url as string | undefined) ?? null;
    if (!threadId || (!messageBody && !attachmentUrl)) {
      throw new HttpError(400, "thread_id and (body or attachment_url) are required");
    }
    // Same defensive check as manual-override-release / request-designee:
    // a caller can only reference an attachment path under this exact
    // thread, so nothing stops one thread's messages from displaying an
    // attachment uploaded to (and only readable via) a different thread.
    if (attachmentUrl && !attachmentUrl.startsWith(`schools/${schoolId}/chat/${threadId}/`)) {
      throw new HttpError(400, "attachment_url must be under this thread's own chat storage path");
    }

    const service = serviceClient();

    const { data: thread, error: threadErr } = await service
      .from("chat_threads")
      .select("id, school_id, guardian_id, teacher_id, muted, status")
      .eq("id", threadId)
      .eq("school_id", schoolId)
      .single();
    if (threadErr || !thread) throw new HttpError(404, "Thread not found");
    if (thread.status === "closed") throw new HttpError(409, "This thread is closed");

    // Determine which side of the 1:1 thread the caller is on.
    const [{ data: guardian }, { data: staff }] = await Promise.all([
      service.from("guardians").select("id").eq("school_id", schoolId).eq("user_id", identity.userId).maybeSingle(),
      service.from("staff").select("id").eq("school_id", schoolId).eq("user_id", identity.userId).maybeSingle(),
    ]);

    let senderRole: "guardian" | "teacher";
    if (guardian && thread.guardian_id === guardian.id) {
      senderRole = "guardian";
    } else if (staff && thread.teacher_id === staff.id) {
      senderRole = "teacher";
    } else {
      throw new HttpError(403, "Not a participant of this thread");
    }

    const { data: school, error: schoolErr } = await service
      .from("schools")
      .select("timezone, settings")
      .eq("id", schoolId)
      .single();
    if (schoolErr || !school) throw new HttpError(500, "School not found");
    const deliveredAfterHours = isQuietHours(school.settings as SchoolSettings, school.timezone);

    const { data: message, error: insertErr } = await service
      .from("chat_messages")
      .insert({
        school_id: schoolId,
        thread_id: threadId,
        sender_id: identity.userId,
        sender_role: senderRole,
        body: messageBody,
        attachment_url: attachmentUrl,
        delivered_after_hours: deliveredAfterHours,
      })
      .select("id, created_at")
      .single();
    if (insertErr || !message) throw new HttpError(500, "Failed to send message");

    // Push the other participant — unless this landed in quiet hours, where
    // it's queued and labeled rather than pushed immediately (SPEC.md §5.4).
    // TODO(build order step 8, remainder): Twilio SMS fallback for
    // urgent/flagged messages only, not ordinary chat volume.
    if (!deliveredAfterHours) {
      const { data: recipient } = senderRole === "guardian"
        ? await service.from("staff").select("user_id").eq("id", thread.teacher_id).maybeSingle()
        : await service.from("guardians").select("user_id").eq("id", thread.guardian_id).maybeSingle();
      if (recipient) {
        await notifyUsers(
          service,
          schoolId,
          [recipient.user_id],
          "New message",
          messageBody ?? "Sent an attachment",
          { kind: "chat_message", thread_id: threadId, message_id: message.id },
        );
      }
    }

    return json({
      id: message.id,
      created_at: message.created_at,
      delivered_after_hours: deliveredAfterHours,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
