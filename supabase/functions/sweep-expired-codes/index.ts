import { serviceClient } from "../_shared/supabaseClients.ts";
import { json } from "../_shared/http.ts";
import { listSchoolAdminUserIds } from "../_shared/identity.ts";
import { notifyUsers } from "../_shared/push.ts";
import { sendSms } from "../_shared/twilio.ts";
import type { SchoolSettings } from "../_shared/schoolSettings.ts";

// Scheduled via pg_cron, every minute (SPEC.md §8, §6.9). Not user-invoked —
// pg_cron's net.http_post call to this function should include the same
// secret in an `x-cron-secret` header.
//
// event_codes naturally "expire" just by expires_at passing (no column to
// flip); what this sweep actually does is walk each school's own late-pickup
// escalation ladder (schools.settings.escalation_ladder) for pickup codes
// that lapsed unused, firing each step at most once per code via a
// security_alerts row as the idempotency marker.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const service = serviceClient();

  const { data: schools, error: schoolsErr } = await service.from("schools").select("id, settings");
  if (schoolsErr || !schools) return json({ error: "failed to load schools" }, 500);

  let escalationsFired = 0;

  for (const school of schools) {
    const settings = school.settings as SchoolSettings;
    const ladder = settings?.escalation_ladder ?? [];
    if (ladder.length === 0) continue;

    const { data: latePickups } = await service
      .from("event_codes")
      .select("id, student_id, issued_by, expires_at, students(full_name)")
      .eq("school_id", school.id)
      .eq("type", "pickup")
      .is("used_at", null)
      .eq("revoked", false)
      .lt("expires_at", new Date().toISOString());

    for (const code of latePickups ?? []) {
      const minutesLate = (Date.now() - new Date(code.expires_at).getTime()) / 60_000;
      const studentName = (code.students as unknown as { full_name: string } | null)?.full_name ?? "the student";

      for (const step of ladder) {
        if (minutesLate < step.after_minutes) continue;
        const stepKind = `late_pickup_${step.action}_${step.after_minutes}m`;

        const { data: alreadyFired } = await service
          .from("security_alerts")
          .select("id")
          .eq("school_id", school.id)
          .eq("kind", stepKind)
          .contains("details", { event_code_id: code.id })
          .maybeSingle();
        if (alreadyFired) continue;

        await service.from("security_alerts").insert({
          school_id: school.id,
          student_id: code.student_id,
          kind: stepKind,
          details: { event_code_id: code.id, minutes_late: Math.floor(minutesLate) },
        });
        escalationsFired++;

        if (step.action === "notify_guardian") {
          const { data: guardian } = await service
            .from("guardians")
            .select("phone")
            .eq("school_id", school.id)
            .eq("user_id", code.issued_by)
            .maybeSingle();
          await notifyUsers(
            service,
            school.id,
            [code.issued_by],
            "Late pickup",
            `${studentName}'s pickup code expired ${Math.floor(minutesLate)} minute(s) ago and hasn't been used.`,
            { kind: stepKind, event_code_id: code.id },
          );
          if (guardian?.phone) {
            await sendSms(guardian.phone, `[Shmeera] ${studentName}'s pickup is late — please pick up as soon as possible.`);
          }
        } else {
          // 'notify_admin' | 'voice_call_admin'. There's no admin phone
          // number in the data model (SPEC.md §7 only gives guardians/staff
          // a `phone` column), so voice_call_admin currently degrades to a
          // push notification rather than a real Twilio Voice call —
          // adding an admin contact number is follow-up work.
          const adminUserIds = await listSchoolAdminUserIds(service, school.id);
          await notifyUsers(
            service,
            school.id,
            adminUserIds,
            "Late pickup",
            `${studentName}'s pickup code expired ${Math.floor(minutesLate)} minute(s) ago and hasn't been used.`,
            { kind: stepKind, event_code_id: code.id },
          );
        }
      }
    }
  }

  return json({ schools_checked: schools.length, escalations_fired: escalationsFired });
});
