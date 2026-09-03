// Mirrors packages/shared/src/database.types.ts SchoolSettings — duplicated
// here because Edge Functions run on Deno and don't share a module
// resolver with the Node/Expo workspace packages. Keep both in sync.

export interface EscalationStep {
  after_minutes: number;
  action: "notify_guardian" | "notify_admin" | "voice_call_admin";
}

export interface SchoolSettings {
  code_ttl_minutes: number;
  escalation_ladder: EscalationStep[];
  designee_photo_required: boolean;
  retention_days: number;
  quiet_hours: { start: string; end: string };
}
