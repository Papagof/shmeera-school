"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface EventRow {
  id: string;
  school_id: string;
  type: "dropoff" | "pickup";
  released_to_name: string | null;
  created_at: string;
  geo: { lat: number; lng: number };
  students: { full_name: string; class_id: string | null } | null;
  staff: { full_name: string } | null;
}

export interface ClassRow {
  id: string;
  name: string;
}

export function LiveEventsFeed({ initialEvents, classes }: { initialEvents: EventRow[]; classes: ClassRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Realtime Postgres Changes still evaluate the subscriber's RLS policy
    // per row (SPEC.md §3.3.5) — this channel name is purely organizational,
    // not the security boundary. A new row only reaches this client if the
    // signed-in admin could already SELECT it directly.
    const channel = supabase
      .channel("admin:events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        async (payload) => {
          const { data: student } = await supabase
            .from("students")
            .select("full_name, class_id")
            .eq("id", payload.new.student_id)
            .maybeSingle();
          const { data: staff } = await supabase
            .from("staff")
            .select("full_name")
            .eq("id", payload.new.validated_by_staff_id)
            .maybeSingle();

          setEvents((prev) => [
            {
              id: payload.new.id,
              school_id: payload.new.school_id,
              type: payload.new.type,
              released_to_name: payload.new.released_to_name,
              created_at: payload.new.created_at,
              geo: payload.new.geo,
              students: student,
              staff: staff,
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

  const classNameById = (id: string | null) => classes.find((c) => c.id === id)?.name ?? "Unassigned";
  const visibleEvents = activeClassId ? events.filter((e) => e.students?.class_id === activeClassId) : events;

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

      {visibleEvents.length === 0 ? (
        <p className="text-sm text-slate-500">No events yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Student</th>
              <th className="py-2 pr-4">Class</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Released to</th>
              <th className="py-2 pr-4">Validated by</th>
            </tr>
          </thead>
          <tbody>
            {visibleEvents.map((event) => (
              <tr key={event.id} className="border-b border-slate-100">
                {/* toLocaleTimeString() intentionally renders in the viewer's own
                    locale/timezone, which the server can't know in advance — the
                    server-rendered value legitimately differs from the client's,
                    so this is React's documented escape hatch rather than a bug
                    to work around structurally (found live: Next.js hydration
                    warning on this exact node). */}
                <td className="py-2 pr-4 text-slate-500" suppressHydrationWarning>
                  {new Date(event.created_at).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4 font-medium text-slate-900">{event.students?.full_name ?? "—"}</td>
                <td className="py-2 pr-4 text-slate-500">{classNameById(event.students?.class_id ?? null)}</td>
                <td className="py-2 pr-4 capitalize">{event.type}</td>
                <td className="py-2 pr-4">{event.released_to_name ?? "—"}</td>
                <td className="py-2 pr-4 text-slate-500">{event.staff?.full_name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
