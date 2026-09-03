import { serviceClient } from "../_shared/supabaseClients.ts";
import { json } from "../_shared/http.ts";
import type { SchoolSettings } from "../_shared/schoolSettings.ts";

// Scheduled via pg_cron, daily (SPEC.md §8, §6.11). Purges events and chat
// messages older than each school's own configured retention_days.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const service = serviceClient();
  const { data: schools, error } = await service.from("schools").select("id, settings");
  if (error || !schools) return json({ error: "failed to load schools" }, 500);

  let purgedEvents = 0;
  let purgedMessages = 0;

  for (const school of schools) {
    const settings = school.settings as SchoolSettings;
    const retentionDays = settings?.retention_days ?? 365;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { count: eventsCount } = await service
      .from("events")
      .delete({ count: "exact" })
      .eq("school_id", school.id)
      .lt("created_at", cutoff);
    purgedEvents += eventsCount ?? 0;

    const { count: messagesCount } = await service
      .from("chat_messages")
      .delete({ count: "exact" })
      .eq("school_id", school.id)
      .lt("created_at", cutoff);
    purgedMessages += messagesCount ?? 0;
  }

  return json({ purged_events: purgedEvents, purged_messages: purgedMessages });
});
