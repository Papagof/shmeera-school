-- Local dev seed: two independent schools with one admin, one teacher, one
-- guardian, one class, and one student each, plus the links between them.
-- Used for `supabase db reset` / local development. Every login below uses
-- the password 'Password123!'.
--
-- This file exists to make cross-tenant isolation *visible* during manual
-- testing: log in as Alpha Academy's admin and Beta Elementary's data
-- should be completely invisible, and vice versa.

-- ─────────────────────────── auth.users + identities ───────────────────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-aaaa-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@alpha.shmeera.dev',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '11111111-aaaa-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher@alpha.shmeera.dev', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '11111111-aaaa-0000-0000-000000000003', 'authenticated', 'authenticated', 'guardian@alpha.shmeera.dev', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-bbbb-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@beta.shmeera.dev',   crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-bbbb-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher@beta.shmeera.dev', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-bbbb-0000-0000-000000000003', 'authenticated', 'authenticated', 'guardian@beta.shmeera.dev', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
from auth.users u
where u.id in (
  '11111111-aaaa-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000002', '11111111-aaaa-0000-0000-000000000003',
  '22222222-bbbb-0000-0000-000000000001', '22222222-bbbb-0000-0000-000000000002', '22222222-bbbb-0000-0000-000000000003'
);

-- ─────────────────────────── schools ───────────────────────────
insert into public.schools (id, name, timezone, signing_secret_ref) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Academy', 'America/New_York', 'schools/aaaaaaaa-0000-0000-0000-000000000001/qr-signing-secret'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Beta Elementary', 'America/Chicago', 'schools/bbbbbbbb-0000-0000-0000-000000000001/qr-signing-secret');

-- Real Vault secrets matching signing_secret_ref above, so
-- generate-event-code / validate-event-code work against the demo schools
-- too, not just schools created through onboard-school.
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'schools/aaaaaaaa-0000-0000-0000-000000000001/qr-signing-secret');
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'schools/bbbbbbbb-0000-0000-0000-000000000001/qr-signing-secret');

-- ─────────────────────────── memberships ───────────────────────────
insert into public.memberships (user_id, school_id, role) values
  ('11111111-aaaa-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'school_admin'),
  ('11111111-aaaa-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'teacher'),
  ('11111111-aaaa-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'guardian'),
  ('22222222-bbbb-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'school_admin'),
  ('22222222-bbbb-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'teacher'),
  ('22222222-bbbb-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'guardian');

-- ─────────────────────────── classes ───────────────────────────
insert into public.classes (id, school_id, name) values
  ('aaaaaaaa-c1a5-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alpha Kindergarten'),
  ('bbbbbbbb-c1a5-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Beta Kindergarten');

-- ─────────────────────────── staff ───────────────────────────
insert into public.staff (id, school_id, user_id, full_name, phone, class_id) values
  ('aaaaaaaa-57af-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000002', 'Alpha Teacher', '+15550000001', 'aaaaaaaa-c1a5-0000-0000-000000000001'),
  ('bbbbbbbb-57af-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-bbbb-0000-0000-000000000002', 'Beta Teacher', '+15550000002', 'bbbbbbbb-c1a5-0000-0000-000000000001');

update public.classes set teacher_id = 'aaaaaaaa-57af-0000-0000-000000000001' where id = 'aaaaaaaa-c1a5-0000-0000-000000000001';
update public.classes set teacher_id = 'bbbbbbbb-57af-0000-0000-000000000001' where id = 'bbbbbbbb-c1a5-0000-0000-000000000001';

-- ─────────────────────────── guardians ───────────────────────────
insert into public.guardians (id, school_id, user_id, full_name, phone, phone_verified, status) values
  ('aaaaaaaa-9d41-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000003', 'Alpha Guardian', '+15550000003', true, 'active'),
  ('bbbbbbbb-9d41-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-bbbb-0000-0000-000000000003', 'Beta Guardian', '+15550000004', true, 'active');

-- ─────────────────────────── students ───────────────────────────
insert into public.students (id, school_id, class_id, full_name, dob, status) values
  ('aaaaaaaa-5c0d-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-c1a5-0000-0000-000000000001', 'Alpha Student', '2020-04-01', 'active'),
  ('bbbbbbbb-5c0d-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-c1a5-0000-0000-000000000001', 'Beta Student', '2020-06-15', 'active');

-- ─────────────────────────── guardian_student_links ───────────────────────────
-- (this also fires trg_auto_create_chat_thread, so each guardian already has
-- a 1:1 thread with their child's teacher after this insert)
insert into public.guardian_student_links (school_id, guardian_id, student_id, relationship, is_primary, pickup_authorized) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-9d41-0000-0000-000000000001', 'aaaaaaaa-5c0d-0000-0000-000000000001', 'parent', true, true),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-9d41-0000-0000-000000000001', 'bbbbbbbb-5c0d-0000-0000-000000000001', 'parent', true, true);
