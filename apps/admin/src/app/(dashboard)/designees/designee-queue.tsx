"use client";

import { useEffect, useState } from "react";
import { describeFunctionError } from "@shmeera/shared";
import { createClient } from "@/lib/supabase/client";

export interface DesigneeRow {
  id: string;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  photo_url: string | null;
  status: string;
  created_at: string;
  students: { full_name: string } | null;
}

export function DesigneeQueue({ initialDesignees }: { initialDesignees: DesigneeRow[] }) {
  const [designees, setDesignees] = useState(initialDesignees);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    const withPhotos = designees.filter((d) => d.photo_url);
    if (withPhotos.length === 0) return;
    Promise.all(withPhotos.map((d) => supabase.storage.from("shmeera").createSignedUrl(d.photo_url as string, 3600))).then(
      (results) => {
        const next: Record<string, string> = {};
        withPhotos.forEach((d, i) => {
          const url = results[i]?.data?.signedUrl;
          if (url) next[d.id] = url;
        });
        setPhotoUrls(next);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function review(designeeId: string, decision: "approved" | "rejected") {
    setPendingId(designeeId);
    setError(null);
    const supabase = createClient();

    const { error: invokeError } = await supabase.functions.invoke("review-designee", {
      body: { designee_id: designeeId, decision },
    });

    if (invokeError) {
      setError(await describeFunctionError(invokeError));
    } else {
      setDesignees((prev) => prev.filter((d) => d.id !== designeeId));
    }
    setPendingId(null);
  }

  if (designees.length === 0) {
    return <p className="text-sm text-slate-500">No pending designee requests.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {designees.map((designee) => (
        <div
          key={designee.id}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center gap-3">
            {photoUrls[designee.id] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrls[designee.id]} alt="" className="h-12 w-12 rounded-full object-cover" />
            )}
            <div>
              <p className="font-medium text-slate-900">
                {designee.full_name}
                {designee.relationship && <span className="ml-2 text-sm text-slate-500">({designee.relationship})</span>}
              </p>
              <p className="text-sm text-slate-500">
                For {designee.students?.full_name ?? "unknown student"} · {designee.phone ?? "no phone on file"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendingId === designee.id}
              onClick={() => review(designee.id, "rejected")}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={pendingId === designee.id}
              onClick={() => review(designee.id, "approved")}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
