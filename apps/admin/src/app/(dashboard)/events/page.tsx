import { createClient } from "@/lib/supabase/server";
import { LiveEventsFeed, type EventRow } from "./live-events-feed";

export default async function EventsPage() {
  const supabase = await createClient();

  // No school_id filter here on purpose — RLS already scopes this to the
  // admin's own school (SPEC.md §3.1); adding a client-side filter would
  // just be redundant UX sugar, never the actual security boundary.
  const { data: events, error } = await supabase
    .from("events")
    .select(
      "id, school_id, type, released_to_name, created_at, geo, students(full_name), staff:validated_by_staff_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return <p className="text-sm text-red-600">Failed to load events: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Live pickup / drop-off feed</h1>
      <p className="mt-1 text-sm text-slate-500">Updates in real time as codes are validated at the gate.</p>
      <div className="mt-6">
        <LiveEventsFeed initialEvents={(events ?? []) as unknown as EventRow[]} />
      </div>
    </div>
  );
}
