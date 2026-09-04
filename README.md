# Shmeera

School pickup/drop-off safety platform. See [SPEC.md](SPEC.md) for the full spec and [CLAUDE.md](CLAUDE.md) for the non-negotiable architectural rules (tenant isolation above all).

## Layout

```
supabase/           Postgres schema, RLS policies, triggers, Edge Functions, isolation tests
apps/admin/         Next.js school admin dashboard (Vercel)
apps/parent/        Expo app — guardians generate pickup/drop-off codes, chat with teachers
apps/teacher/       Expo app — scan/validate codes, chat with guardians
packages/shared/    Shared TypeScript types (Database types, constants)
```

## Prerequisites

- Node.js 20+
- A Supabase project (local via Docker + Supabase CLI, or a hosted project)
- Docker, if running the Supabase stack locally

## 1. Backend

```bash
npm install                 # installs all workspaces

# Local dev:
npm run supabase:start      # requires Docker
npm run supabase:reset      # applies migrations + seed.sql (two demo schools, see supabase/seed.sql)
npm run supabase:test       # runs the cross-tenant isolation suite (supabase/tests/database)

# Or against a hosted project:
npx supabase link --project-ref <ref>
npx supabase db push
```

Each school needs a per-tenant QR-signing secret provisioned in Supabase Vault — this happens automatically via the `onboard-school` Edge Function (see `supabase/functions/onboard-school`), not by hand.

Deploy Edge Functions:

```bash
npx supabase functions deploy generate-event-code validate-event-code request-designee \
  review-designee revoke-code send-chat-message get-chat-thread report-chat \
  emergency-broadcast onboard-school twilio-webhook sweep-expired-codes purge-retention \
  register-push-token invite-member manual-override-release export-school-data offboard-school
```

Set function secrets (`npx supabase secrets set KEY=value`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WEBHOOK_URL`, `CRON_SECRET`. Functions run without them (with a console warning) so the rest of a flow can still be exercised in dev.

`sweep-expired-codes` (every minute) and `purge-retention` (daily) are wired via `pg_cron` + `pg_net` on the live project already (`20260902100021_enable_pg_net_and_schedule_cron_jobs.sql`), calling each function's URL with an `x-cron-secret` header. **Both functions are deployed with `verify_jwt: false`**, so until `CRON_SECRET` is set as an Edge Function secret, they're fully public, unauthenticated endpoints — set it before relying on this in production. The migration file itself has the header value redacted to a placeholder (never commit a real secret to git); the live cron jobs have the actual value applied directly.

## 2. Admin dashboard

```bash
cd apps/admin
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
npm run dev
```

## 3. Parent / Teacher apps

```bash
cd apps/parent   # or apps/teacher
cp .env.example .env   # fill in EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm run start
```

## Regenerating types

`packages/shared/src/database.types.ts` is hand-written to match the migrations. Once a project is connected, regenerate and reconcile:

```bash
npx supabase gen types typescript --project-id <ref> > packages/shared/src/database.types.ts
```

## Status

The backend (schema, RLS, triggers, 15 Edge Functions) and the admin dashboard are deployed to a live Supabase project and verified end-to-end: a guardian generating a code, a teacher validating it, and the event showing up in the admin live feed all work against real infrastructure, not just locally. See CLAUDE.md's "Supabase platform gotchas" for the non-obvious fixes that made this work (Vault access, cross-schema grants, service-role detection in triggers) — don't reintroduce them.

The parent/teacher Expo apps' web builds (`expo start --web`) have been driven the same way as the admin dashboard, both against the live project. Confirmed: guardian login → code generation → QR render; teacher login → manual code entry → green "Release confirmed" screen on success and a red STOP screen with the real failure reason (e.g. "code has already been used") on failure. Only the camera-scan path is unverified — a headless browser has no camera to grant, so that needs a simulator/device.

**Push notifications** (build order step 8) are implemented end-to-end: `push_tokens` table, `register-push-token` function, both apps register on login (best-effort — no-ops gracefully without a physical device or an EAS project ID), and every relevant Edge Function (`validate-event-code`, `review-designee`, `request-designee`, `report-chat`, `send-chat-message`, `emergency-broadcast`, `sweep-expired-codes`) sends real Expo pushes. Verified live: registered a token, validated a code, confirmed the push send completed without error. `voice_call_admin` escalation currently degrades to a push (no admin phone-number field exists in the data model, only guardian/staff `phone` — see CLAUDE.md).

**People management** is live: the admin dashboard's `/people` page lets a school_admin create, edit, and delete classes, students, and guardian↔student links; invite teachers and guardians (real email invite via `invite-member`, which creates the Supabase Auth user and links `memberships` + `staff`/`guardians` — the invitee sets their own password); and edit or remove a teacher/guardian from the school (their account and other-school memberships are untouched — only the `staff`/`guardians` row and this school's `memberships` row are deleted). A student can have more than one guardian/emergency contact. The teacher app has a "My class" tab (`RosterScreen`) showing the signed-in teacher's own class roster with each child's guardians. All of this was live-tested end to end with real (non-demo) accounts — see "Real accounts" below.

**Invite / accept-invite flow**: `/accept-invite` in the admin app is where an invited teacher or guardian lands to set their password — it's the only web-reachable surface in the stack, so every invite (`invite-member`, `onboard-school`) redirects there regardless of role. It parses the Supabase session out of the URL hash fragment the invite link redirects with (`#access_token=...`) and is listed as a public path in `proxy.ts` — miss either of those two things and the link either 404s, silently sends the visitor back to `/login`, or lands on a page with no way to actually set a password (all three were live bugs, now fixed — see CLAUDE.md gotchas #6–#9). `ADMIN_APP_URL` (defaults to `http://localhost:3000`) is the Edge Function secret controlling where invite links point; set it via `supabase secrets set ADMIN_APP_URL=<your deployed admin URL>` once the admin dashboard has a real deployment, otherwise invite links sent from a machine other than the one running `npm run dev` won't be reachable. The built-in Supabase email sender is dev-only and rate-limited (`over_email_send_rate_limit` after a handful of sends／hour) — set up a real SMTP provider (Authentication → Emails → SMTP Settings) before inviting real people at any volume.

The demo seed data (`Alpha Academy` / `Beta Elementary`, `supabase/seed.sql`) has been deleted from the live project. That file is still useful for **local** dev (`supabase db reset`) but no longer reflects what's in the hosted project.

**Designees** (SPEC.md §5.1.6, §6.6): the `request-designee`/`review-designee` backend and the admin's approval queue existed already, but the parent app had no screen to actually request one — `DesigneesScreen` (a "Designees" tab alongside "Children") fills that gap: pick a child, enter the designee's name/phone/relationship, optionally attach a photo, submit, and see its status (pending/approved/rejected). A deeper gap found along the way: `ChildListScreen`'s code-generation flow never let a guardian pick a designee at all, even though `generate-event-code` fully supported it server-side — no UI path meant no designee code could ever actually be generated. Both are fixed: a guardian picks "Myself" or an approved designee per child before generating a code, and the designee's photo now renders on the teacher's gate confirmation screen for visual identity confirmation, not just a text reminder. Verified live end to end: guardian attaches a photo and requests a designee → admin sees the thumbnail and approves → guardian generates a pickup code naming that designee → teacher validates it and sees the photo on the green confirmation screen.

**Storage** (SPEC.md §3.3.3): a private `shmeera` bucket holds **student photos** (`schools/{school_id}/students/{student_id}/{filename}`, admin-managed, RLS mirroring the `students` table) and **designee photos** (`schools/{school_id}/designees/{guardian_id}/{filename}`, guardian-uploaded to their own folder only, readable by admin/any teacher/the uploading guardian). Chat attachments aren't wired up yet — SPEC.md §5.4 also requires virus/type scanning before a message is marked delivered, which is a bigger follow-on than the bucket + policy pattern used here.

### Real accounts

The live project now has one real pilot school ("Riverbend Primary School") instead of demo data, seeded directly (not via `seed.sql`, which would put personal email addresses in git). It uses Gmail `+` aliases so every login lands in one inbox:

| Role | Email | Password |
|---|---|---|
| school_admin | `oseomenai+admin@gmail.com` | `Shmeera#2026Live` |
| teacher (Sunrise Room) | `oseomenai+teacher1@gmail.com` | `Shmeera#2026Live` |
| teacher (Rainbow Room) | `oseomenai+teacher2@gmail.com` | `Shmeera#2026Live` |
| guardian (Casey Cole) | `oseomenai+parent1@gmail.com` | `Shmeera#2026Live` |
| guardian (Riley Musa) | `oseomenai+parent2@gmail.com` | `Shmeera#2026Live` |

5 students across the 2 classes, with realistic multi-guardian relationships (two siblings with both a primary guardian and an emergency contact). New real people (an actual teacher or parent, not another alias) should go through `/people` → invite, not raw SQL — they'll get a real invite email and pick their own password.

**Offline manual-override** (SPEC.md §6.13) is implemented end-to-end: the teacher app caches its last-synced roster and school_id (`src/lib/rosterCache.ts`) on every successful "My class" fetch; `ScanScreen`'s location-blocked path and `RosterScreen` both offer a "Manual override release" button leading to `OverrideScreen`, which requires a photo (via the camera, `expo-camera`'s `takePictureAsync`) and a note — no event_code or location involved at all. It tries to submit immediately (covers "no location but network is fine"); if that fails with no server response (genuinely offline), it queues the release locally (`src/lib/overrideQueue.ts`, photo included as base64) and retries automatically every 20s or via a "Sync now" button, in addition to on the next successful roster fetch. Every manual override writes a `security_alerts` row (`kind: 'manual_override_release'`), which the existing admin Alerts page now renders in full (photo, note, released-to name) with an Acknowledge action — reusing infrastructure that already existed rather than building new admin UI. Verified live end to end, including a genuine offline submission (network cut mid-session) queuing and later syncing correctly.

**Chat** (SPEC.md §5.4) had a fully working, previously-untested backend (`send-chat-message`, `get-chat-thread`, `report-chat`, auto-created 1:1 threads) but no UI anywhere — neither app, not even an admin moderation view. Now built on all three surfaces: parent and teacher apps each get a "Chat" tab (thread list → open thread → send/report), sharing an identical `ChatThreadScreen` (it's role-agnostic — messages just align by whether `sender_id` is the viewer); the admin dashboard gets `/chat`, listing filed reports with a "View thread" action (routed through `get-chat-thread` specifically so the read gets audit-logged per §5.4.3) and Dismiss/Mark reviewed actions. Messages update live via Realtime (`chat_messages` was already in the publication, just unused). Verified live end to end: guardian sends → teacher sees it and replies → guardian sees the reply arrive in realtime with no refresh → guardian files a report → it appears in the admin queue → admin views the full thread (confirmed audit-logged) → marks it reviewed.

**Designee photos, end to end** (SPEC.md §6.6): closed the loop that storage buckets left open. A guardian can now attach a photo (camera capture, `expo-camera`) when requesting a designee — enforced as mandatory if the school's `designee_photo_required` setting is on — and it's now actually *displayed* everywhere it matters, not just stored: the admin's approval queue shows a thumbnail before approve/reject, and the teacher's gate confirmation screen shows the designee's photo for visual identity confirmation on release. Along the way, found and fixed a bigger gap: the parent app's code-generation screen never let a guardian pick a designee at all — `generate-event-code` fully supported it server-side, but there was no UI path to it, so no designee code could ever actually be generated. `ChildListScreen` now lets a guardian choose "Myself" or any of their own approved designees per child before generating a code. Verified live end to end: guardian attaches a photo → admin sees the thumbnail and approves → guardian generates a pickup code naming that designee → teacher validates it and sees "Released to [designee]" with their photo rendered on the green confirmation screen.

**School offboarding** (SPEC.md §3.3.10): `export-school-data` and `offboard-school` (both super_admin-only, MFA/aal2-gated like `onboard-school`) implement the "full tenant export, then hard delete" requirement — no dashboard UI yet, called directly (matching `onboard-school`'s precedent of being API-only). `offboard-school` requires `confirm_school_name` to exactly match the school's current name (a fat-finger guard on an irreversible operation), deletes every school-scoped table (cascading via existing FKs), all storage objects under `schools/{id}/`, and the Vault signing secret; it also deletes the auth identity of anyone whose *only* membership was at this school — except a `super_admin`, whose membership row has to reference some school by schema but isn't tied to it in spirit, so offboarding a school a super_admin happens to have their one membership row in no longer silently deletes their own account (a real bug caught before it shipped, not after). Along the way, fixed a schema gap: `audit_log.school_id` cascaded on school delete, which would have destroyed the very record that an offboarding happened — that FK is now dropped so audit history survives. Verified live end to end against a disposable test school, including actually exercising the MFA gate (enrolled real TOTP, verified to aal2, confirmed a non-MFA call is rejected first): export returns correct per-table row counts, a mismatched confirmation name is rejected, and after a correct offboard the school/memberships/classes/students are gone, the Vault secret is gone, the school-admin's auth account is gone (had no other school), the *super_admin's* account survives, and the two audit_log rows for the export and the offboarding itself persist with no school to point back to.

**Chat photo attachments** (SPEC.md §3.3.3, §5.4): both apps' chat threads now have a 📷 button — capture a photo (same `expo-camera` pattern as manual overrides/designees), it uploads to `schools/{school_id}/chat/{thread_id}/{filename}` and sends as a message with no text body, rendered inline (not just a text placeholder) in the thread on both sides and in the admin's `/chat` moderation view. Storage RLS mirrors `chat_messages`/`chat_threads` exactly — either thread participant or admin. `send-chat-message` validates `attachment_url` is under the caller's own thread path, same pattern as the designee/override photo checks. Scoped to photos only (documents would need a different picker, `expo-document-picker`, not added); true virus/type scanning per §5.4 is not implemented — that needs a third-party scanning service, which needs credentials I don't have. Verified live end to end including realtime delivery of a photo message to the other participant.

## What's not built yet

- Chat attachment virus/type scanning (SPEC.md §5.4) — upload works (see above); the actual scanning step before a message is marked delivered needs a third-party API and credentials.
- Document attachments in chat (PDFs etc.) — only photo capture is wired up.
- A dashboard UI for onboarding/offboarding a school — both are implemented as super_admin Edge Functions only, called directly.
- Twilio SMS/Voice — functions are wired but no-op with a console warning until `TWILIO_*` secrets are set. `voice_call_admin` also needs an admin phone-number field added before it can call `placeVoiceCall` at all.
- Twilio SMS fallback for urgent/flagged chat messages specifically (ordinary chat messages intentionally use push only, per SPEC.md §5.4).
