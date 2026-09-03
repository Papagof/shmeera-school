"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLE_LABEL: Record<string, string> = {
  teacher: "the Shmeera Teacher app",
  guardian: "the Shmeera Parent app",
  school_admin: "this admin dashboard",
  super_admin: "this admin dashboard",
};

type Status = "loading" | "ready" | "no-session" | "done";

export default function AcceptInvitePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [appLabel, setAppLabel] = useState("your app");

  useEffect(() => {
    const supabase = createClient();

    // The invite email redirects here with the session in the URL hash
    // (#access_token=...&refresh_token=...&type=invite), not a query param
    // — that's Supabase's own hosted verify endpoint completing the
    // implicit flow before handing off. The cookie-backed @supabase/ssr
    // browser client doesn't parse this automatically, so it's done
    // explicitly here (found live: without it, the invite link just landed
    // on the admin login page with no way to actually set a password).
    async function establishSession() {
      const hash = window.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
          window.history.replaceState(null, "", window.location.pathname);
          if (sessionError) {
            setError(sessionError.message);
            setStatus("no-session");
            return;
          }
          setStatus("ready");
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      setStatus(data.session ? "ready" : "no-session");
    }

    establishSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    const { data: membership } = await supabase.from("memberships").select("role").limit(1).maybeSingle();
    if (membership?.role && ROLE_LABEL[membership.role]) setAppLabel(ROLE_LABEL[membership.role]);

    await supabase.auth.signOut();
    setStatus("done");
    setSaving(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Shmeera</h1>

        {status === "loading" && <p className="mt-4 text-sm text-slate-500">Confirming your invite…</p>}

        {status === "no-session" && (
          <p className="mt-4 text-sm text-red-600">
            {error ?? "This invite link is invalid or has expired."} Ask your school admin to send a new invite.
          </p>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <p className="text-sm text-slate-500">Set a password for your account.</p>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Confirm password
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Set password"}
            </button>
          </form>
        )}

        {status === "done" && (
          <p className="mt-4 text-sm text-slate-600">
            Password set. Open {appLabel} and sign in with your email and new password.
          </p>
        )}
      </div>
    </div>
  );
}
