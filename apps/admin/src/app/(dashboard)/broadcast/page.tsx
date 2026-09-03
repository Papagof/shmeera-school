"use client";

import { useState } from "react";
import { describeFunctionError } from "@shmeera/shared";
import { createClient } from "@/lib/supabase/client";

export default function BroadcastPage() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);

    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("emergency-broadcast", { body: { message } });

    if (error) {
      setStatus(`Failed: ${await describeFunctionError(error)}`);
    } else {
      setStatus(`Sent to ${data?.recipients_notified ?? 0} recipients.`);
      setMessage("");
    }
    setSending(false);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Emergency broadcast</h1>
      <p className="mt-1 text-sm text-slate-500">
        Sends an SMS to every active guardian and staff member — this school only.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 max-w-lg space-y-3">
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="e.g. School is closing early today at 1pm due to weather."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || !message.trim()}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send broadcast"}
        </button>
        {status && <p className="text-sm text-slate-600">{status}</p>}
      </form>
    </div>
  );
}
