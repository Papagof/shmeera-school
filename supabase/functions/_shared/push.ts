import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Expo Push Notifications. No secret needed — Expo push tokens themselves
// authorize delivery.

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
  if (!res.ok) console.error("[expo:push] failed", res.status, await res.text());
}

// Looks up every registered device for the given users (in one school) and
// pushes the same notification to all of them. Failures are logged, not
// thrown — a missing/expired push token should never fail the caller's
// actual request (SPEC.md §9).
export async function notifyUsers(
  service: SupabaseClient,
  schoolId: string,
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;

  const { data: tokens, error } = await service
    .from("push_tokens")
    .select("expo_push_token")
    .eq("school_id", schoolId)
    .in("user_id", ids);
  if (error) {
    console.error("[push] failed to load push_tokens", error);
    return;
  }
  if (!tokens || tokens.length === 0) return;

  await sendExpoPush(tokens.map((t) => ({ to: t.expo_push_token, title, body, data })));
}
