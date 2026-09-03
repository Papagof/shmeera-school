import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";

// POST /get-chat-thread  { thread_id }
// Guardian/teacher participants, or school_admin (SPEC.md §5.4.3).
//
// This exists specifically so admin reads can be logged: Postgres has no
// SELECT trigger, so "every admin read of a thread they're not a
// participant in is logged" (SPEC.md §5.4.3) can only be enforced by
// routing admin reads through here instead of a direct table SELECT.
// Guardian/teacher participants may also read their own thread directly
// via RLS — this endpoint is not the only path for them, just a convenient
// one that returns the same shape.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian", "teacher", "school_admin"]);

    const body = await req.json().catch(() => ({}));
    const threadId = body.thread_id as string | undefined;
    if (!threadId) throw new HttpError(400, "thread_id is required");

    const service = serviceClient();

    const { data: thread, error: threadErr } = await service
      .from("chat_threads")
      .select("id, school_id, student_id, guardian_id, teacher_id, status, muted")
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
    const isAdmin = identity.memberships.some((m) => m.school_id === schoolId && m.role === "school_admin");

    if (!isParticipant && !isAdmin) throw new HttpError(403, "Not authorized to view this thread");

    if (isAdmin && !isParticipant) {
      await writeAudit(service, {
        school_id: schoolId,
        actor_id: identity.userId,
        actor_role: "school_admin",
        action: "chat_thread_viewed_by_admin",
        target_table: "chat_threads",
        target_id: threadId,
      });
    }

    const { data: messages, error: messagesErr } = await service
      .from("chat_messages")
      .select("id, sender_id, sender_role, body, attachment_url, delivered_after_hours, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (messagesErr) throw new HttpError(500, "Failed to load messages");

    return json({ thread, messages: messages ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
});
