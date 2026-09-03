import { createClient } from "@/lib/supabase/server";
import { ChatReportList, type ChatReportRow } from "./chat-report-list";

export default async function ChatPage() {
  const supabase = await createClient();

  const { data: reports, error } = await supabase
    .from("chat_reports")
    .select("id, thread_id, message_id, reason, status, created_at, chat_threads(students(full_name), staff:teacher_id(full_name), guardians:guardian_id(full_name))")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return <p className="text-sm text-red-600">Failed to load chat reports: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Chat moderation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Reports filed by a guardian or teacher on a conversation. Viewing a reported thread here is logged (SPEC.md §5.4.3).
      </p>
      <div className="mt-6">
        <ChatReportList initialReports={(reports ?? []) as unknown as ChatReportRow[]} />
      </div>
    </div>
  );
}
