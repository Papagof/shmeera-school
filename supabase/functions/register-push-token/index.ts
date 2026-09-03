import { userClient, serviceClient } from "../_shared/supabaseClients.ts";
import { resolveCaller, resolveSchoolForRole } from "../_shared/identity.ts";
import { HttpError, errorResponse } from "../_shared/errors.ts";
import { json, corsHeaders } from "../_shared/http.ts";

// POST /register-push-token  { expo_push_token, platform: 'ios'|'android'|'web' }
// Any signed-in guardian, teacher, or school_admin. SPEC.md §9 (build order step 8).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const supabase = userClient(req);
    const identity = await resolveCaller(supabase);
    const schoolId = resolveSchoolForRole(identity, ["guardian", "teacher", "school_admin"]);

    const body = await req.json().catch(() => ({}));
    const expoPushToken = (body.expo_push_token as string | undefined)?.trim();
    const platform = body.platform as "ios" | "android" | "web" | undefined;
    if (!expoPushToken || !platform || !["ios", "android", "web"].includes(platform)) {
      throw new HttpError(400, "expo_push_token and platform ('ios'|'android'|'web') are required");
    }

    const service = serviceClient();

    // A token belongs to whichever user most recently registered it (e.g.
    // a shared device, or the same device re-registering after a re-login).
    const { error } = await service
      .from("push_tokens")
      .upsert(
        { school_id: schoolId, user_id: identity.userId, expo_push_token: expoPushToken, platform },
        { onConflict: "expo_push_token" },
      );
    if (error) throw new HttpError(500, "Failed to register push token");

    return json({ registered: true });
  } catch (err) {
    return errorResponse(err);
  }
});
