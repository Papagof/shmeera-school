-- Shmeera core schema. See SPEC.md §7 for the reference data model.
-- Every table below carries school_id and gets RLS in the next migration —
-- no table is exempt (SPEC.md §3.1).

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'UTC',
  settings jsonb not null default '{
    "code_ttl_minutes": 10,
    "escalation_ladder": [
      {"after_minutes": 15, "action": "notify_guardian"},
      {"after_minutes": 30, "action": "notify_admin"},
      {"after_minutes": 45, "action": "voice_call_admin"}
    ],
    "designee_photo_required": false,
    "retention_days": 365,
    "quiet_hours": {"start": "18:00", "end": "07:00"}
  }'::jsonb,
  signing_secret_ref text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  role text not null check (role in ('super_admin', 'school_admin', 'teacher', 'guardian')),
  created_at timestamptz not null default now(),
  unique (user_id, school_id, role)
);
create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_school_id_idx on public.memberships (school_id);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null,
  teacher_id uuid, -- fk added below, after staff exists
  created_at timestamptz not null default now()
);
create index classes_school_id_idx on public.classes (school_id);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  class_id uuid references public.classes (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);
create index staff_school_id_idx on public.staff (school_id);
create index staff_user_id_idx on public.staff (user_id);

alter table public.classes
  add constraint classes_teacher_id_fkey foreign key (teacher_id) references public.staff (id) on delete set null;

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  phone_verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (school_id, user_id)
);
create index guardians_school_id_idx on public.guardians (school_id);
create index guardians_user_id_idx on public.guardians (user_id);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  class_id uuid references public.classes (id) on delete set null,
  full_name text not null,
  dob date,
  photo_url text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create index students_school_id_idx on public.students (school_id);
create index students_class_id_idx on public.students (class_id);

create table public.guardian_student_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  relationship text,
  is_primary boolean not null default false,
  pickup_authorized boolean not null default true,
  restriction_note text,
  created_at timestamptz not null default now(),
  unique (guardian_id, student_id)
);
create index gsl_school_id_idx on public.guardian_student_links (school_id);
create index gsl_guardian_id_idx on public.guardian_student_links (guardian_id);
create index gsl_student_id_idx on public.guardian_student_links (student_id);

create table public.designees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  requested_by_guardian_id uuid not null references public.guardians (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  full_name text not null,
  phone text,
  relationship text,
  photo_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index designees_school_id_idx on public.designees (school_id);
create index designees_student_id_idx on public.designees (student_id);

create table public.event_codes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  type text not null check (type in ('dropoff', 'pickup')),
  code text not null,
  qr_payload text not null,
  issued_by uuid not null references auth.users (id),
  designee_id uuid references public.designees (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index event_codes_school_id_idx on public.event_codes (school_id);
create index event_codes_student_id_idx on public.event_codes (student_id);
-- one live (unexpired, unused, unrevoked) code per student+type, enforced app-side
-- (generate-event-code checks this); indexed here to make that check cheap.
create index event_codes_active_idx on public.event_codes (student_id, type) where used_at is null and revoked = false;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  event_code_id uuid references public.event_codes (id),
  type text not null check (type in ('dropoff', 'pickup')),
  validated_by_staff_id uuid not null references public.staff (id),
  released_to_name text,
  geo jsonb not null,
  device_info jsonb,
  created_at timestamptz not null default now()
);
create index events_school_id_idx on public.events (school_id);
create index events_student_id_idx on public.events (student_id);

create table public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  acknowledged_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index security_alerts_school_id_idx on public.security_alerts (school_id);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  teacher_id uuid not null references public.staff (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'muted', 'closed')),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  -- strictly 1:1: exactly one guardian + one teacher per student context (SPEC.md §5.4.1)
  unique (guardian_id, teacher_id, student_id)
);
create index chat_threads_school_id_idx on public.chat_threads (school_id);
create index chat_threads_guardian_id_idx on public.chat_threads (guardian_id);
create index chat_threads_teacher_id_idx on public.chat_threads (teacher_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  sender_role text not null check (sender_role in ('guardian', 'teacher')),
  body text,
  attachment_url text,
  delivered_after_hours boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_messages_school_id_idx on public.chat_messages (school_id);
create index chat_messages_thread_id_idx on public.chat_messages (thread_id, created_at);

create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  message_id uuid references public.chat_messages (id) on delete cascade,
  reported_by uuid not null references auth.users (id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
create index chat_reports_school_id_idx on public.chat_reports (school_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  actor_id uuid references auth.users (id),
  actor_role text,
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_school_id_idx on public.audit_log (school_id, created_at desc);
