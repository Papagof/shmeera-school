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
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Before this, the only way to get a forgotten password reset was for
  // someone with direct Supabase API access to call resetPasswordForEmail
  // manually (found live: a real user had no self-service path at all).
  // window.location.origin rather than a hardcoded URL so this keeps
  // working if the admin app's domain ever changes.
  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Enter your email above first, then click \"Forgot password?\".");
      return;
    }
    setResetting(true);
    setError(null);
    setResetStatus(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/accept-invite`,
    });
    if (resetError) setError(resetError.message);
    else setResetStatus("If that email has an account, a reset link is on its way — check your inbox.");
    setResetting(false);
  }

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

    // school_admin lands on the per-school dashboard here; super_admin (who
    // may not also be a school_admin — it's a platform-wide role, see
    // apps/admin/src/app/super-admin/page.tsx) goes to the school-onboarding
    // page instead. Anyone else gets redirected to their own app with the
    // session handed off via the URL hash. Priority only matters for
    // someone holding more than one role.
    if (roles.has("school_admin")) {
      router.replace("/");
      router.refresh();
      return;
    }
    if (roles.has("super_admin")) {
      router.replace("/super-admin");
      router.refresh();
      return;
    }

    let targetAppUrl: string | null = null;
    if (roles.has("teacher")) targetAppUrl = TEACHER_APP_URL;
    else if (roles.has("guardian")) targetAppUrl = PARENT_APP_URL;

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
        {resetStatus && <p className="text-sm text-green-700">{resetStatus}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={resetting}
          className="w-full text-center text-sm text-slate-500 underline disabled:opacity-50"
        >
          {resetting ? "Sending…" : "Forgot password?"}
        </button>
      </form>
    </div>
  );
}
