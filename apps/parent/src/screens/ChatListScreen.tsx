import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { getLastRead } from "../lib/chatReadState";

interface ThreadRow {
  id: string;
  status: string;
  students: { full_name: string } | null;
  staff: { full_name: string } | null;
}

const MY_ROLE = "guardian";

export function ChatListScreen({
  onOpenThread,
  onUnreadThreadsChange,
}: {
  onOpenThread: (threadId: string, title: string) => void;
  onUnreadThreadsChange?: (threadIds: Set<string>) => void;
}) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No filter — chat_threads_select's RLS compares guardian_id directly to
    // the caller's own guardian id (unlike guardian_student_links, see
    // CLAUDE.md gotcha #6), so this already returns exactly this guardian's
    // own threads.
    supabase
      .from("chat_threads")
      .select("id, status, students(full_name), staff:teacher_id(full_name)")
      .then(async ({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as unknown as ThreadRow[];
        setThreads(rows);
        setLoading(false);

        if (rows.length === 0) return;
        // Latest message per thread, derived client-side (no server-side
        // GROUP BY via supabase-js): ordered desc, so the first row seen
        // per thread_id is that thread's latest message.
        const { data: recent } = await supabase
          .from("chat_messages")
          .select("thread_id, sender_role, created_at")
          .in("thread_id", rows.map((r) => r.id))
          .order("created_at", { ascending: false });

        const latestByThread = new Map<string, { sender_role: string; created_at: string }>();
        for (const m of recent ?? []) {
          if (!latestByThread.has(m.thread_id as string)) {
            latestByThread.set(m.thread_id as string, { sender_role: m.sender_role as string, created_at: m.created_at as string });
          }
        }

        const unread = new Set<string>();
        for (const [threadId, latest] of latestByThread) {
          if (latest.sender_role === MY_ROLE) continue; // my own last message — nothing to read
          const lastRead = await getLastRead(threadId);
          if (!lastRead || latest.created_at > lastRead) unread.add(threadId);
        }
        setUnreadIds(unread);
        onUnreadThreadsChange?.(unread);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={threads}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 24, gap: 10 }}
      ListHeaderComponent={<Text style={{ fontSize: 20, fontWeight: "600", marginBottom: 8 }}>Chat</Text>}
      ListEmptyComponent={
        <Text style={{ color: "#64748b" }}>{error ?? "No chat threads yet — these are created automatically once you're linked to a child."}</Text>
      }
      renderItem={({ item }) => {
        const title = `${item.staff?.full_name ?? "Teacher"} — ${item.students?.full_name ?? "Student"}`;
        const unread = unreadIds.has(item.id);
        return (
          <Pressable
            onPress={() => onOpenThread(item.id, title)}
            style={{ borderWidth: 1, borderColor: unread ? "#0f172a" : "#e2e8f0", borderRadius: 12, padding: 14 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#dc2626" }} />}
              <Text style={{ fontSize: 16, fontWeight: unread ? "700" : "500" }}>{item.staff?.full_name ?? "Teacher"}</Text>
            </View>
            <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>About {item.students?.full_name ?? "your child"}</Text>
            {item.status === "muted" && <Text style={{ color: "#b45309", fontSize: 12, marginTop: 4 }}>Muted</Text>}
          </Pressable>
        );
      }}
    />
  );
}
