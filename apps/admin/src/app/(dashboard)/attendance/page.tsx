import { createClient } from "@/lib/supabase/server";
import { AttendanceView, type ClassRow, type StudentRow, type EventRow } from "./attendance-view";

// No school_id filters anywhere below on purpose — RLS already scopes every
// query here to the admin's own school (SPEC.md §3.1); see events/page.tsx
// for the same convention.
export default async function AttendancePage() {
  const supabase = await createClient();

  // 48h window (not just "today") so the client can derive "today" from the
  // viewer's own local timezone rather than the server's — see
  // attendance-view.tsx, which only computes/render the day-boundary-
  // dependent status after mount to avoid a hydration mismatch (same
  // family of issue as CLAUDE.md's toLocaleTimeString() gotcha, but for a
  // whole derived list rather than a single text node).
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const [
    { data: classes, error: classesErr },
    { data: students, error: studentsErr },
    { data: events, error: eventsErr },
  ] = await Promise.all([
    supabase.from("classes").select("id, name").order("name"),
    supabase
      .from("students")
      .select("id, full_name, class_id, status")
      .eq("status", "active")
      .order("full_name"),
    supabase
      .from("events")
      .select("id, student_id, type, released_to_name, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const error = classesErr || studentsErr || eventsErr;
  if (error) {
    return <p className="text-sm text-red-600">Failed to load attendance: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Attendance</h1>
      <p className="mt-1 text-sm text-slate-500">
        Who&apos;s dropped off, who&apos;s been picked up, and when — grouped by classroom.
      </p>
      <div className="mt-6">
        <AttendanceView
          classes={(classes ?? []) as ClassRow[]}
          students={(students ?? []) as StudentRow[]}
          initialEvents={(events ?? []) as EventRow[]}
        />
      </div>
    </div>
  );
}
