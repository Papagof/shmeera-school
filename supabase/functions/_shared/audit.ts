import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface AuditEntry {
  school_id: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  target_table?: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
}

// audit_log is append-only (no update/delete policy exists for any role,
// SPEC.md §3.3.8) — this just centralizes the insert shape and swallows
// failures loudly rather than letting a logging error break the caller's
// actual request.
export async function writeAudit(service: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await service.from("audit_log").insert(entry);
  if (error) console.error("[audit_log] insert failed", error, entry);
}
