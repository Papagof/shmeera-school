import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";

// The admin dashboard is the only web-reachable surface in this stack (the
// parent/teacher apps are Expo, with no stable public URL) — the invite
// email's "set your password" link always lands there, regardless of which
// role is being invited. Without this, Supabase falls back to the
// project's default Site URL, which happened to already be the admin
// dashboard's root — but with no page there to actually accept an invite
// and collect a password (found live: the link "worked" but just opened
// the admin login screen with no way to proceed).
const ADMIN_APP_URL = Deno.env.get("ADMIN_APP_URL") ?? "http://localhost:3000";

// POST /invite-member  { role: 'teacher'|'guardian', email, full_name, phone?, class_id? }
// school_admin only. Invites a real person by email (Supabase Auth invite
// link — they set their own password), then links them into this admin's
// own school via memberships + staff/guardians (SPEC.md §8, CLAUDE.md rule
// #2: school_id is always resolved from the caller's JWT, never trusted
// from the body).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["school_admin"]);

    const body = await req.json().catch(() => ({}));
    const role = body.role as "teacher" | "guardian" | undefined;
    const email = (body.email as string | undefined)?.trim().toLowerCase();
    const fullName = (body.full_name as string | undefined)?.trim();
    const phone = (body.phone as string | undefined)?.trim() || null;
    const classId = (body.class_id as string | undefined) || null;

    if (!role || !["teacher", "guardian"].includes(role)) {
      throw new HttpError(400, "role must be 'teacher' or 'guardian'");
    }
    if (!email || !fullName) throw new HttpError(400, "email and full_name are required");

    const service = serviceClient();

    if (classId && role === "teacher") {
      const { data: cls, error: clsErr } = await service
        .from("classes")
        .select("id")
        .eq("id", classId)
        .eq("school_id", schoolId)
        .maybeSingle();
      if (clsErr || !cls) throw new HttpError(404, "class_id not found in this school");
    }

    let userId: string;
    let invited: boolean;

    const { data: created, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${ADMIN_APP_URL}/accept-invite`,
    });
    if (created?.user) {
      userId = created.user.id;
      invited = true;
    } else if (inviteErr && /already.*registered/i.test(inviteErr.message)) {
      const { data: existingId, error: lookupErr } = await service.rpc("lookup_auth_user_id", { p_email: email });
      if (lookupErr || !existingId) throw new HttpError(500, "Failed to resolve existing user");
      userId = existingId as string;
      invited = false;
    } else {
      throw new HttpError(500, `Failed to invite ${role}: ${inviteErr?.message ?? "unknown error"}`);
    }

    const { error: membershipErr } = await service
      .from("memberships")
      .upsert({ user_id: userId, school_id: schoolId, role }, { onConflict: "user_id,school_id,role" });
    if (membershipErr) throw new HttpError(500, "Failed to grant membership");

    if (role === "teacher") {
      const { error: staffErr } = await service
        .from("staff")
        .upsert(
          { school_id: schoolId, user_id: userId, full_name: fullName, phone, class_id: classId },
          { onConflict: "school_id,user_id" },
        );
      if (staffErr) throw new HttpError(500, "Failed to create staff record");
    } else {
      const { error: guardianErr } = await service
        .from("guardians")
        .upsert(
          { school_id: schoolId, user_id: userId, full_name: fullName, phone, status: "active" },
          { onConflict: "school_id,user_id" },
        );
      if (guardianErr) throw new HttpError(500, "Failed to create guardian record");
    }

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "school_admin",
      action: invited ? `${role}_invited` : `${role}_linked_existing_user`,
      target_table: role === "teacher" ? "staff" : "guardians",
      metadata: { email, full_name: fullName },
    });

    return json({ user_id: userId, email, role, invited });
  } catch (err) {
    return errorResponse(err);
  }
});
