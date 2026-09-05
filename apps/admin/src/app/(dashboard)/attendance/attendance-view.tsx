"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ClassRow {
  id: string;
  name: string;
}
export interface StudentRow {
  id: string;
  full_name: string;
  class_id: string | null;
  status: string;
}
export interface EventRow {
  id: string;
  student_id: string;
  type: "dropoff" | "pickup";
  released_to_name: string | null;
  created_at: string;
}

type Status =
  | { kind: "not_arrived" }
  | { kind: "present"; since: string }
  | { kind: "picked_up"; at: string; releasedTo: string | null };

const badgeClass: Record<Status["kind"], string> = {
  not_arrived: "bg-slate-100 text-slate-500",
  present: "bg-green-100 text-green-700",
  picked_up: "bg-slate-800 text-white",
};

const badgeLabel: Record<Status["kind"], string> = {
  not_arrived: "Not yet arrived",
  present: "Present",
  picked_up: "Picked up",
};

function statusForStudent(studentId: string, events: EventRow[], todayStart: number): Status {
  const todays = events.filter((e) => e.student_id === studentId && new Date(e.created_at).getTime() >= todayStart);
  if (todays.length === 0) return { kind: "not_arrived" };
  const latest = todays.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
  if (latest.type === "pickup") return { kind: "picked_up", at: latest.created_at, releasedTo: latest.released_to_name };
  return { kind: "present", since: latest.created_at };
}

export function AttendanceView({
  classes,
  students,
  initialEvents,
}: {
  classes: ClassRow[];
  students: StudentRow[];
  initialEvents: EventRow[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  // Rendered only after mount (see page.tsx) — the day boundary is
  // inherently viewer-timezone-dependent, so computing/rendering it during
  // SSR would produce a different set of rows than the client hydrates
  // with, not just different text (suppressHydrationWarning only covers
  // the latter).
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("admin:attendance")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          setEvents((prev) => [
            {
              id: payload.new.id,
              student_id: payload.new.student_id,
              type: payload.new.type,
              released_to_name: payload.new.released_to_name,
              created_at: payload.new.created_at,
            } as EventRow,
            ...prev,
          ]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!mounted) {
    return <p className="text-sm text-slate-500">Loading attendance…</p>;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const visibleStudents = activeClassId ? students.filter((s) => s.class_id === activeClassId) : students;

  const statuses = new Map<string, Status>();
  for (const s of visibleStudents) statuses.set(s.id, statusForStudent(s.id, events, todayStartMs));

  const counts = { not_arrived: 0, present: 0, picked_up: 0 };
  for (const status of statuses.values()) counts[status.kind]++;

  const groups = [
    ...classes.map((c) => ({ id: c.id, name: c.name, students: visibleStudents.filter((s) => s.class_id === c.id) })),
    { id: "__unassigned__", name: "Unassigned", students: visibleStudents.filter((s) => s.class_id === null) },
  ].filter((g) => g.id !== "__unassigned__" || g.students.length > 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveClassId(null)}
          className={`px-3 py-2 text-sm font-medium ${
            activeClassId === null ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          All classes
        </button>
        {classes.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveClassId(c.id)}
            className={`px-3 py-2 text-sm font-medium ${
              activeClassId === c.id ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <span className="text-slate-900">
          <span className="font-semibold">{visibleStudents.length}</span> students
        </span>
        <span className="text-green-700">
          <span className="font-semibold">{counts.present}</span> present
        </span>
        <span className="text-slate-800">
          <span className="font-semibold">{counts.picked_up}</span> picked up
        </span>
        <span className="text-slate-500">
          <span className="font-semibold">{counts.not_arrived}</span> not yet arrived
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.id} className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.name}</h3>
          <ul className="space-y-2">
            {group.students.map((s) => {
              const status = statuses.get(s.id) as Status;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-900">{s.full_name}</span>
                  <span className="flex items-center gap-2">
                    {status.kind === "present" && (
                      <span className="text-xs text-slate-500" suppressHydrationWarning>
                        since {new Date(status.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                    {status.kind === "picked_up" && (
                      <span className="text-xs text-slate-500" suppressHydrationWarning>
                        {new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        {status.releasedTo ? ` · by ${status.releasedTo}` : ""}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass[status.kind]}`}>
                      {badgeLabel[status.kind]}
                    </span>
                  </span>
                </li>
              );
            })}
            {group.students.length === 0 && <li className="text-sm text-slate-400">No students.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
