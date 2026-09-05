"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { describeFunctionError } from "@shmeera/shared";
import { createClient } from "@/lib/supabase/client";

// super_admin is platform-wide, not scoped to any one school, so this page
// deliberately lives outside the (dashboard) route group — that layout's
// access check is specifically "has a school_admin membership" and would
// otherwise 403 a super_admin who isn't also a school_admin (see CLAUDE.md
// gotcha #15 for why memberships.school_id is non-null even for
// super_admin despite the role being conceptually school-agnostic).
//
// onboard-school requires an aal2 (MFA-verified) session (SPEC.md
// §3.3.10) — there was no MFA enrollment UI anywhere in this app before
// this page, since onboard-school/offboard-school/export-school-data had
// only ever been called directly via the Supabase API, never from the
// dashboard. This page has to complete that step-up itself: enroll a TOTP
// factor if none exists, or challenge+verify an existing one, before the
// New School form is usable.
type Status = "loading" | "no-session" | "no-access" | "needs-mfa-enroll" | "needs-mfa-verify" | "ready";

export default function SuperAdminPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // React StrictMode double-invokes effects in dev — without this guard,
  // checkAccess() (which can call mfa.enroll(), a side effect with no
  // idempotency key) ran twice per mount and created two colliding
  // unverified TOTP factors, found live via a stray "a factor with this
  // friendly name already exists" error on next load.
  const checkedRef = useRef(false);
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    checkAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAccess() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setStatus("no-session");
      return;
    }

    const { data: memberships } = await supabase.from("memberships").select("role").eq("user_id", user.id);
    const isSuperAdmin = (memberships ?? []).some((m) => m.role === "super_admin");
    if (!isSuperAdmin) {
      setStatus("no-access");
      return;
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") {
      setStatus("ready");
      return;
    }

    // A verified factor just needs a step-up challenge this session. An
    // unverified one (an enrollment that was started but never finished,
    // e.g. the page was closed before scanning the QR code) can't be
    // resumed — Supabase only returns the QR/secret once, at enroll time —
    // so it's unenrolled and replaced with a fresh one below rather than
    // sending the user to a "enter your code" screen with no code to enter.
    // Re-calling mfa.enroll() while that stale factor still exists fails
    // with "a factor with this friendly name already exists" instead of
    // either of the above — found live from a crashed test run leaving one
    // behind.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const existingTotp = factors?.totp?.[0];
    if (existingTotp?.status === "verified") {
      setFactorId(existingTotp.id);
      setStatus("needs-mfa-verify");
      return;
    }
    if (existingTotp) {
      await supabase.auth.mfa.unenroll({ factorId: existingTotp.id });
    }

    // No usable factor — enroll one now.
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (enrollError || !enrolled) {
      setError(enrollError?.message ?? "Failed to start MFA enrollment");
      setStatus("no-access");
      return;
    }
    setFactorId(enrolled.id);
    setQrCode(enrolled.totp.qr_code);
    setSecret(enrolled.totp.secret);
    setStatus("needs-mfa-enroll");
  }

  async function submitMfaCode() {
    if (!factorId || mfaCode.length < 6) return;
    setVerifying(true);
    setError(null);
    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message ?? "Failed to start MFA challenge");
      setVerifying(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: mfaCode.trim(),
    });
    if (verifyError) {
      setError(verifyError.message);
      setVerifying(false);
      return;
    }
    setMfaCode("");
    setVerifying(false);
    setStatus("ready");
  }

  async function submitNewSchool(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke("onboard-school", {
      body: { name: name.trim(), timezone: timezone.trim() || undefined, admin_email: adminEmail.trim(), admin_full_name: adminFullName.trim() },
    });
    if (invokeError) {
      setError(await describeFunctionError(invokeError));
    } else {
      setResult(`"${name.trim()}" created. An invite email was sent to ${adminEmail.trim()} to set up their school_admin account.`);
      setName("");
      setAdminEmail("");
      setAdminFullName("");
    }
    setSubmitting(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Shmeera — Platform Admin</h1>
          <p className="text-sm text-slate-500">Onboard a new school.</p>
        </div>

        {status === "loading" && <p className="text-sm text-slate-500">Checking access…</p>}

        {status === "no-session" && (
          <div className="space-y-2">
            <p className="text-sm text-red-600">You need to sign in first.</p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Go to sign in
            </button>
          </div>
        )}

        {status === "no-access" && (
          <p className="text-sm text-red-600">{error ?? "Your account doesn't hold a super_admin membership."}</p>
        )}

        {status === "needs-mfa-enroll" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Onboarding a school requires two-factor authentication. Scan this QR code with an authenticator app
              (Google Authenticator, 1Password, Authy, etc.), then enter the 6-digit code it shows.
            </p>
            {qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCode} alt="TOTP QR code" className="mx-auto h-40 w-40" />
            )}
            {secret && (
              <p className="text-center text-xs text-slate-400">
                Can&apos;t scan? Enter this key manually: <span className="font-mono">{secret}</span>
              </p>
            )}
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={verifying || mfaCode.length < 6}
              onClick={submitMfaCode}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Verify & continue"}
            </button>
          </div>
        )}

        {status === "needs-mfa-verify" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator app to continue.</p>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={verifying || mfaCode.length < 6}
              onClick={submitMfaCode}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {verifying ? "Verifying…" : "Verify & continue"}
            </button>
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={submitNewSchool} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              School name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Timezone
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              School admin&apos;s full name
              <input
                required
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              School admin&apos;s email
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-slate-500">
              Sends a real invite email — the school admin sets their own password via /accept-invite.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {result && <p className="text-sm text-green-700">{result}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create school"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
