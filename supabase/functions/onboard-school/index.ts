import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";

// See invite-member/index.ts for why this is needed — without an explicit
// redirectTo, the invite email lands the new admin on the dashboard's
// root/login page with no way to actually set a password.
const ADMIN_APP_URL = Deno.env.get("ADMIN_APP_URL") ?? "http://localhost:3000";

// POST /onboard-school  { name, timezone?, admin_email, admin_full_name }
// super_admin only, MFA-gated (SPEC.md §3.3.6, §3.3.10, §8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Missing Authorization header");
    const claims = decodeJwtPayload(token);
    if (claims.aal !== "aal2") {
      throw new HttpError(403, "MFA (aal2) is required for school onboarding");
    }

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const isSuperAdmin = identity.memberships.some((m) => m.role === "super_admin");
    if (!isSuperAdmin) throw new HttpError(403, "super_admin only");

    const body = await req.json().catch(() => ({}));
    const name = (body.name as string | undefined)?.trim();
    const timezone = (body.timezone as string | undefined)?.trim() || "UTC";
    const adminEmail = (body.admin_email as string | undefined)?.trim();
    const adminFullName = (body.admin_full_name as string | undefined)?.trim();
    if (!name || !adminEmail || !adminFullName) {
      throw new HttpError(400, "name, admin_email, and admin_full_name are required");
    }

    const service = serviceClient();

    const { data: school, error: schoolErr } = await service
      .from("schools")
      .insert({ name, timezone })
      .select("id")
      .single();
    if (schoolErr || !school) throw new HttpError(500, "Failed to create school");

    // Per-tenant HMAC signing secret (SPEC.md §3.3.2), stored in Vault.
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secretHex = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const secretName = `schools/${school.id}/qr-signing-secret`;

    // The Data API only exposes public/graphql_public — `vault` isn't
    // reachable via `.schema("vault")`, even for service_role. Go through
    // the public.vault_create_secret RPC wrapper instead (see
    // 20260902100011_vault_rpc.sql).
    const { error: vaultErr } = await service.rpc("vault_create_secret", {
      p_secret: secretHex,
      p_name: secretName,
    });
    if (vaultErr) throw new HttpError(500, `Failed to provision signing secret: ${vaultErr.message}`);

    const { error: refErr } = await service.from("schools").update({ signing_secret_ref: secretName }).eq(
      "id",
      school.id,
    );
    if (refErr) throw new HttpError(500, "Failed to link signing secret to school");

    const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(adminEmail, {
      data: { full_name: adminFullName },
      redirectTo: `${ADMIN_APP_URL}/accept-invite`,
    });
    if (inviteErr || !invited?.user) {
      throw new HttpError(500, `Failed to invite school admin: ${inviteErr?.message ?? "unknown error"}`);
    }

    const { error: membershipErr } = await service
      .from("memberships")
      .insert({ user_id: invited.user.id, school_id: school.id, role: "school_admin" });
    if (membershipErr) throw new HttpError(500, "Failed to grant school_admin membership");

    await writeAudit(service, {
      school_id: school.id,
      actor_id: identity.userId,
      actor_role: "super_admin",
      action: "school_onboarded",
      target_table: "schools",
      target_id: school.id,
      metadata: { admin_email: adminEmail },
    });

    return json({ school_id: school.id, admin_user_id: invited.user.id });
  } catch (err) {
    return errorResponse(err);
  }
});
