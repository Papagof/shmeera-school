// Hand-written to match supabase/migrations/*.sql. Once the project is
// connected, regenerate with:
//   supabase gen types typescript --project-id <ref> > packages/shared/src/database.types.ts
// (or the Supabase MCP `generate_typescript_types` tool) and reconcile any
// drift against this file.

export type Role = "super_admin" | "school_admin" | "teacher" | "guardian";
export type EventType = "dropoff" | "pickup";
export type GuardianStatus = "pending" | "active" | "suspended";
export type DesigneeStatus = "pending" | "approved" | "rejected";
export type ChatThreadStatus = "active" | "muted" | "closed";
export type ChatSenderRole = "guardian" | "teacher";
export type ChatReportStatus = "open" | "reviewed" | "dismissed";

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

export interface Database {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          settings: SchoolSettings;
          signing_secret_ref: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["schools"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["schools"]["Row"]>;
      };
      memberships: {
        Row: {
          id: string;
          user_id: string;
          school_id: string;
          role: Role;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["memberships"]["Row"]> & {
          user_id: string;
          school_id: string;
          role: Role;
        };
        Update: Partial<Database["public"]["Tables"]["memberships"]["Row"]>;
      };
      classes: {
        Row: { id: string; school_id: string; name: string; teacher_id: string | null; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["classes"]["Row"]> & { school_id: string; name: string };
        Update: Partial<Database["public"]["Tables"]["classes"]["Row"]>;
      };
      staff: {
        Row: {
          id: string;
          school_id: string;
          user_id: string;
          full_name: string;
          phone: string | null;
          class_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["staff"]["Row"]> & {
          school_id: string;
          user_id: string;
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff"]["Row"]>;
      };
      guardians: {
        Row: {
          id: string;
          school_id: string;
          user_id: string;
          full_name: string;
          phone: string | null;
          phone_verified: boolean;
          status: GuardianStatus;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["guardians"]["Row"]> & {
          school_id: string;
          user_id: string;
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["guardians"]["Row"]>;
      };
      students: {
        Row: {
          id: string;
          school_id: string;
          class_id: string | null;
          full_name: string;
          dob: string | null;
          photo_url: string | null;
          status: "active" | "inactive";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["students"]["Row"]> & { school_id: string; full_name: string };
        Update: Partial<Database["public"]["Tables"]["students"]["Row"]>;
      };
      guardian_student_links: {
        Row: {
          id: string;
          school_id: string;
          guardian_id: string;
          student_id: string;
          relationship: string | null;
          is_primary: boolean;
          pickup_authorized: boolean;
          restriction_note: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["guardian_student_links"]["Row"]> & {
          school_id: string;
          guardian_id: string;
          student_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["guardian_student_links"]["Row"]>;
      };
      designees: {
        Row: {
          id: string;
          school_id: string;
          requested_by_guardian_id: string;
          student_id: string;
          full_name: string;
          phone: string | null;
          relationship: string | null;
          photo_url: string | null;
          status: DesigneeStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["designees"]["Row"]> & {
          school_id: string;
          requested_by_guardian_id: string;
          student_id: string;
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["designees"]["Row"]>;
      };
      event_codes: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          type: EventType;
          code: string;
          qr_payload: string;
          issued_by: string;
          designee_id: string | null;
          expires_at: string;
          used_at: string | null;
          revoked: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["event_codes"]["Row"]> & {
          school_id: string;
          student_id: string;
          type: EventType;
          code: string;
          qr_payload: string;
          issued_by: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_codes"]["Row"]>;
      };
      events: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          event_code_id: string | null;
          type: EventType;
          validated_by_staff_id: string;
          released_to_name: string | null;
          geo: Record<string, unknown>;
          device_info: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["events"]["Row"]> & {
          school_id: string;
          student_id: string;
          type: EventType;
          validated_by_staff_id: string;
          geo: Record<string, unknown>;
        };
        Update: never;
      };
      security_alerts: {
        Row: {
          id: string;
          school_id: string;
          student_id: string | null;
          kind: string;
          details: Record<string, unknown>;
          acknowledged_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["security_alerts"]["Row"]> & { school_id: string; kind: string };
        Update: Partial<Database["public"]["Tables"]["security_alerts"]["Row"]>;
      };
      chat_threads: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          guardian_id: string;
          teacher_id: string;
          status: ChatThreadStatus;
          muted: boolean;
          created_at: string;
        };
        Insert: never; // auto-created by trg_auto_create_chat_thread
        Update: Partial<Pick<Database["public"]["Tables"]["chat_threads"]["Row"], "status" | "muted">>;
      };
      chat_messages: {
        Row: {
          id: string;
          school_id: string;
          thread_id: string;
          sender_id: string;
          sender_role: ChatSenderRole;
          body: string | null;
          attachment_url: string | null;
          delivered_after_hours: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]> & {
          school_id: string;
          thread_id: string;
          sender_id: string;
          sender_role: ChatSenderRole;
        };
        Update: never;
      };
      chat_reports: {
        Row: {
          id: string;
          school_id: string;
          thread_id: string;
          message_id: string | null;
          reported_by: string;
          reason: string;
          status: ChatReportStatus;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["chat_reports"]["Row"]> & {
          school_id: string;
          thread_id: string;
          reported_by: string;
          reason: string;
        };
        Update: Partial<Pick<Database["public"]["Tables"]["chat_reports"]["Row"], "status">>;
      };
      audit_log: {
        Row: {
          id: string;
          school_id: string;
          actor_id: string | null;
          actor_role: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_log"]["Row"]> & { school_id: string; action: string };
        Update: never;
      };
    };
  };
}
