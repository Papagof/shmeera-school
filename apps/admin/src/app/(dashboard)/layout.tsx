import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/events", label: "Live feed" },
  { href: "/people", label: "People" },
  { href: "/designees", label: "Designees" },
  { href: "/alerts", label: "Alerts" },
  { href: "/chat", label: "Chat" },
  { href: "/broadcast", label: "Broadcast" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // school_admin is scoped to exactly one school via memberships (SPEC.md
  // §3.3.6) — RLS on `schools` already limits this to schools the caller
  // belongs to, so no extra filtering is needed here.
  const { data: school } = await supabase
    .from("memberships")
    .select("role, schools(id, name)")
    .eq("user_id", user.id)
    .eq("role", "school_admin")
    .maybeSingle();

  if (!school) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-center">
        <div>
          <p className="text-lg font-medium text-slate-900">No admin access</p>
          <p className="mt-1 text-sm text-slate-500">
            Your account doesn&apos;t hold a school_admin membership for any school.
          </p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  const schoolName = (school.schools as unknown as { name: string } | null)?.name ?? "Your school";

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-6 truncate text-sm font-semibold text-slate-900" title={schoolName}>
          {schoolName}
        </p>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
