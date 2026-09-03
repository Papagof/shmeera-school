import { createClient } from "@/lib/supabase/server";
import { DesigneeQueue, type DesigneeRow } from "./designee-queue";

export default async function DesigneesPage() {
  const supabase = await createClient();

  const { data: designees, error } = await supabase
    .from("designees")
    .select("id, full_name, relationship, phone, photo_url, status, created_at, students(full_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return <p className="text-sm text-red-600">Failed to load designee requests: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Designee approval queue</h1>
      <p className="mt-1 text-sm text-slate-500">
        A guardian can&apos;t generate a code for anyone here until you approve them.
      </p>
      <div className="mt-6">
        <DesigneeQueue initialDesignees={(designees ?? []) as unknown as DesigneeRow[]} />
      </div>
    </div>
  );
}
