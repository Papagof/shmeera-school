import { createClient } from "@/lib/supabase/server";
import { AlertList, type AlertRow } from "./alert-list";

export default async function AlertsPage() {
  const supabase = await createClient();

  const { data: alerts, error } = await supabase
    .from("security_alerts")
    .select("id, kind, details, student_id, acknowledged_by, created_at, students(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return <p className="text-sm text-red-600">Failed to load alerts: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Security alerts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Invalid codes, custody-restricted attempts, late pickups, manual overrides, and chat reports.
      </p>
      <div className="mt-6">
        <AlertList initialAlerts={(alerts ?? []) as unknown as AlertRow[]} />
      </div>
    </div>
  );
}
