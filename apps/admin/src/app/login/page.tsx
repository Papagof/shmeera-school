"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// This is the one sign-in page for all three apps (SPEC.md's product is
// three-sided, but only the admin dashboard has a public web URL — the
// Expo apps don't). A teacher or guardian signing in here gets handed off
// to their own app's deployed URL with the session in the URL hash
// (#access_token=...&refresh_token=...), the exact mechanism the
// accept-invite page already uses for the invite-email handoff (see
// apps/admin/src/app/accept-invite/page.tsx) — reused here rather than
// invented fresh, since it's already proven to survive the
// @supabase/ssr-vs-plain-client difference between these apps.
const TEACHER_APP_URL = process.env.NEXT_PUBLIC_TEACHER_APP_URL ?? "https://shmeera-teacher.vercel.app";
const PARENT_APP_URL = process.env.NEXT_PUBLIC_PARENT_APP_URL ?? "https://shmeera-parent.vercel.app";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !signInData.session) {
      setError(signInError?.message ?? "Sign in failed");
      setLoading(false);
      return;
    }

    const { data: memberships } = await supabase.from("memberships").select("role").eq("user_id", signInData.user.id);
    const roles = new Set((memberships ?? []).map((m) => m.role as string));

    // school_admin/super_admin stay here — everyone else gets redirected to
    // their own app with the session handed off via the URL hash. Priority
    // matters only for the (currently nonexistent) case of someone holding
    // more than one role.
    let targetAppUrl: string | null = null;
    if (!roles.has("school_admin") && !roles.has("super_admin")) {
      if (roles.has("teacher")) targetAppUrl = TEACHER_APP_URL;
      else if (roles.has("guardian")) targetAppUrl = PARENT_APP_URL;
    }

    if (targetAppUrl) {
      const { access_token, refresh_token } = signInData.session;
      window.location.href = `${targetAppUrl}/#access_token=${access_token}&refresh_token=${refresh_token}`;
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Shmeera</h1>
          <p className="text-sm text-slate-500">
            Sign in with your school email. Admins land on the dashboard; teachers and guardians are sent to their
            own app.
          </p>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
