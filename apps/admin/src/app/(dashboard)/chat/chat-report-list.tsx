"use client";

import { useState } from "react";
import { describeFunctionError } from "@shmeera/shared";
import { createClient } from "@/lib/supabase/client";

export interface ChatReportRow {
  id: string;
  thread_id: string;
  message_id: string | null;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
  chat_threads: {
    students: { full_name: string } | null;
    staff: { full_name: string } | null;
    guardians: { full_name: string } | null;
  } | null;
}

interface ThreadMessage {
  id: string;
  sender_role: "guardian" | "teacher";
  body: string | null;
  attachment_url: string | null;
  created_at: string;
}

export function ChatReportList({ initialReports }: { initialReports: ChatReportRow[] }) {
  const [reports, setReports] = useState(initialReports);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function viewThread(threadId: string) {
    if (openThreadId === threadId) {
      setOpenThreadId(null);
      return;
    }
    setOpenThreadId(threadId);
    setLoadingThread(true);
    setError(null);
    const supabase = createClient();
    const { data, error: invokeError } = await supabase.functions.invoke("get-chat-thread", {
      body: { thread_id: threadId },
    });
    if (invokeError) {
      setError(await describeFunctionError(invokeError));
    } else {
      const msgs = (data?.messages ?? []) as ThreadMessage[];
      setMessages(msgs);
      const withAttachments = msgs.filter((m) => m.attachment_url);
      if (withAttachments.length > 0) {
        const results = await Promise.all(
          withAttachments.map((m) => supabase.storage.from("shmeera").createSignedUrl(m.attachment_url as string, 3600)),
        );
        const next: Record<string, string> = {};
        withAttachments.forEach((m, i) => {
          const url = results[i]?.data?.signedUrl;
          if (url) next[m.id] = url;
        });
        setAttachmentUrls(next);
      }
    }
    setLoadingThread(false);
  }

  async function updateStatus(reportId: string, status: "reviewed" | "dismissed") {
    setUpdatingId(reportId);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("chat_reports").update({ status }).eq("id", reportId);
    if (!updateErr) {
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status } : r)));
    } else {
      setError(updateErr.message);
    }
    setUpdatingId(null);
  }

  if (reports.length === 0) {
    return <p className="text-sm text-slate-500">No chat reports.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {reports.map((report) => {
        const t = report.chat_threads;
        const label = t ? `${t.guardians?.full_name ?? "Guardian"} ↔ ${t.staff?.full_name ?? "Teacher"} · about ${t.students?.full_name ?? "student"}` : "Thread";
        return (
          <div key={report.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{label}</p>
              <p className="text-xs text-slate-400">{new Date(report.created_at).toLocaleString()}</p>
            </div>
            <p className="mt-1 text-sm text-slate-600">"{report.reason}"</p>

            <div className="mt-2 flex items-center justify-between">
              <p
                className={
                  "text-xs " +
                  (report.status === "open" ? "text-amber-600" : report.status === "reviewed" ? "text-emerald-600" : "text-slate-400")
                }
              >
                {report.status}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => viewThread(report.thread_id)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                >
                  {openThreadId === report.thread_id ? "Hide thread" : "View thread"}
                </button>
                {report.status === "open" && (
                  <>
                    <button
                      type="button"
                      disabled={updatingId === report.id}
                      onClick={() => updateStatus(report.id, "dismissed")}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === report.id}
                      onClick={() => updateStatus(report.id, "reviewed")}
                      className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Mark reviewed
                    </button>
                  </>
                )}
              </div>
            </div>

            {openThreadId === report.thread_id && (
              <div className="mt-3 space-y-1 rounded-md bg-slate-50 p-3">
                {loadingThread ? (
                  <p className="text-xs text-slate-500">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-slate-500">No messages.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={"text-xs " + (m.id === report.message_id ? "rounded bg-red-100 p-1" : "")}>
                      <span className="font-medium capitalize">{m.sender_role}:</span> {m.body}
                      <span className="ml-2 text-slate-400">{new Date(m.created_at).toLocaleTimeString()}</span>
                      {m.attachment_url && attachmentUrls[m.id] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={attachmentUrls[m.id]} alt="" className="mt-1 h-24 w-24 rounded object-cover" />
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
