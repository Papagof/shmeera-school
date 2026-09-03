import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";
import { writeAudit } from "../_shared/audit.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";

// Storage has no recursive delete — list() only returns one level, and a
// folder entry is indistinguishable from a file except by its null `id`.
// Depth-bounded (5) purely as a sanity cap; the deepest real path here is
// schools/{id}/{kind}/{sub}/{file}, three levels below the prefix passed in.
async function listAllFiles(storage: ReturnType<SupabaseClient["storage"]["from"]>, prefix: string, depth = 5): Promise<string[]> {
  if (depth <= 0) return [];
  const { data: entries } = await storage.list(prefix, { limit: 1000 });
  if (!entries) return [];
  const files: string[] = [];
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      files.push(...(await listAllFiles(storage, path, depth - 1)));
    } else {
      files.push(path);
    }
  }
  return files;
}

// POST /offboard-school  { school_id, confirm_school_name }
// super_admin only, MFA-gated (SPEC.md §3.3.10). Hard deletion, not a soft
// disable flag — call export-school-data first, this cannot be undone.
// `confirm_school_name` must exactly match the school's current name, the
// same "type the name to confirm" pattern used for any irreversible bulk
// delete, since school_id alone is just a UUID a caller could pass in error.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Missing Authorization header");
    const claims = decodeJwtPayload(token);
    if (claims.aal !== "aal2") throw new HttpError(403, "MFA (aal2) is required for school offboarding");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const isSuperAdmin = identity.memberships.some((m) => m.role === "super_admin");
    if (!isSuperAdmin) throw new HttpError(403, "super_admin only");

    const body = await req.json().catch(() => ({}));
    const schoolId = body.school_id as string | undefined;
    const confirmName = (body.confirm_school_name as string | undefined)?.trim();
    if (!schoolId || !confirmName) throw new HttpError(400, "school_id and confirm_school_name are required");

    const service = serviceClient();

    const { data: school, error: schoolErr } = await service
      .from("schools")
      .select("id, name, signing_secret_ref")
      .eq("id", schoolId)
      .single();
    if (schoolErr || !school) throw new HttpError(404, "School not found");
    if (confirmName !== school.name) {
      throw new HttpError(400, "confirm_school_name does not match this school's name");
    }

    // A person may belong to more than one school — only delete their auth
    // identity if this offboarded school was their only membership anywhere,
    // never just because they had a role in the school being removed. A
    // super_admin's membership row still has to point at *some* school (the
    // column is not-null), so never auto-delete one just because the one
    // school their row happens to reference is the one being offboarded —
    // that would silently delete a platform operator's own account as a
    // side effect of an unrelated school's removal.
    const { data: members } = await service.from("memberships").select("user_id, role").eq("school_id", schoolId);
    const memberUserIds = [...new Set((members ?? []).filter((m) => m.role !== "super_admin").map((m) => m.user_id as string))];

    const userIdsToDeleteAuth: string[] = [];
    for (const userId of memberUserIds) {
      const { count } = await service
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("school_id", schoolId);
      if (!count) userIdsToDeleteAuth.push(userId);
    }

    const filePaths = await listAllFiles(service.storage.from("shmeera"), `schools/${schoolId}`);
    if (filePaths.length > 0) {
      const { error: removeErr } = await service.storage.from("shmeera").remove(filePaths);
      if (removeErr) throw new HttpError(500, `Failed to delete storage objects: ${removeErr.message}`);
    }

    if (school.signing_secret_ref) {
      const { error: vaultErr } = await service.rpc("vault_delete_secret", { p_name: school.signing_secret_ref });
      if (vaultErr) throw new HttpError(500, `Failed to delete signing secret: ${vaultErr.message}`);
    }

    // Cascades every school-scoped table except audit_log, which no longer
    // has a cascading FK (20260902100019) so the record of this offboarding
    // survives the delete it describes.
    const { error: deleteErr } = await service.from("schools").delete().eq("id", schoolId);
    if (deleteErr) throw new HttpError(500, `Failed to delete school: ${deleteErr.message}`);

    for (const userId of userIdsToDeleteAuth) {
      await service.auth.admin.deleteUser(userId).catch((err) => console.error("[offboard-school] failed to delete auth user", userId, err));
    }

    await writeAudit(service, {
      school_id: schoolId,
      actor_id: identity.userId,
      actor_role: "super_admin",
      action: "school_offboarded",
      target_table: "schools",
      target_id: schoolId,
      metadata: { school_name: school.name, auth_users_deleted: userIdsToDeleteAuth.length, files_deleted: filePaths.length },
    });

    return json({
      school_id: schoolId,
      deleted: true,
      auth_users_deleted: userIdsToDeleteAuth.length,
      files_deleted: filePaths.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
