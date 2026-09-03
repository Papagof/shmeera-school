"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AlertRow {
  id: string;
  kind: string;
  details: Record<string, unknown>;
  student_id: string | null;
  acknowledged_by: string | null;
  created_at: string;
  students: { full_name: string } | null;
}

export function AlertList({ initialAlerts }: { initialAlerts: AlertRow[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [ackingId, setAckingId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const photoAlerts = alerts.filter((a) => a.kind === "manual_override_release" && typeof a.details.photo_path === "string");
    if (photoAlerts.length === 0) return;
    Promise.all(
      photoAlerts.map((a) => supabase.storage.from("shmeera").createSignedUrl(a.details.photo_path as string, 3600)),
    ).then((results) => {
      const next: Record<string, string> = {};
      photoAlerts.forEach((a, i) => {
        const url = results[i]?.data?.signedUrl;
        if (url) next[a.id] = url;
      });
      setPhotoUrls(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acknowledge(alertId: string) {
    setAckingId(alertId);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("security_alerts")
      .update({ acknowledged_by: userData.user?.id })
      .eq("id", alertId);
    if (!error) {
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, acknowledged_by: userData.user?.id ?? "" } : a)));
    }
    setAckingId(null);
  }

  if (alerts.length === 0) {
    return <p className="text-sm text-slate-500">No alerts.</p>;
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const isManualOverride = alert.kind === "manual_override_release";
        return (
          <div key={alert.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{alert.kind.replace(/_/g, " ")}</p>
              <p className="text-xs text-slate-400">{new Date(alert.created_at).toLocaleString()}</p>
            </div>
            {alert.students && <p className="text-sm text-slate-500">{alert.students.full_name}</p>}

            {isManualOverride && (
              <div className="mt-3 flex gap-3">
                {photoUrls[alert.id] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[alert.id]} alt="" className="h-16 w-16 rounded-md object-cover" />
                )}
                <div className="text-sm text-slate-700">
                  {typeof alert.details.released_to_name === "string" && (
                    <p>
                      Released to <span className="font-medium">{alert.details.released_to_name}</span>
                    </p>
                  )}
                  {typeof alert.details.note === "string" && <p className="mt-0.5 text-slate-500">"{alert.details.note}"</p>}
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              {alert.acknowledged_by ? (
                <p className="text-xs text-emerald-600">Acknowledged</p>
              ) : (
                <p className="text-xs text-amber-600">Needs review</p>
              )}
              {!alert.acknowledged_by && (
                <button
                  type="button"
                  disabled={ackingId === alert.id}
                  onClick={() => acknowledge(alert.id)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                >
                  Acknowledge
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
