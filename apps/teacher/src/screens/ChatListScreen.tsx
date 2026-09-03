import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

interface ThreadRow {
  id: string;
  status: string;
  students: { full_name: string } | null;
  guardians: { full_name: string } | null;
}

export function ChatListScreen({ onOpenThread }: { onOpenThread: (threadId: string, title: string) => void }) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No filter — chat_threads_select's RLS compares teacher_id directly to
    // the caller's own staff id, so this already returns exactly this
    // teacher's own threads (same convention as ChildListScreen's fix on
    // the parent side — see CLAUDE.md gotcha #6 for why that check matters).
    supabase
      .from("chat_threads")
      .select("id, status, students(full_name), guardians:guardian_id(full_name)")
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setThreads((data ?? []) as unknown as ThreadRow[]);
        setLoading(false);
      });
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
        <Text style={{ color: "#64748b" }}>{error ?? "No chat threads yet — these are created automatically once a guardian is linked to one of your students."}</Text>
      }
      renderItem={({ item }) => {
        const title = `${item.guardians?.full_name ?? "Guardian"} — ${item.students?.full_name ?? "Student"}`;
        return (
          <Pressable
            onPress={() => onOpenThread(item.id, title)}
            style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 14 }}
          >
            <Text style={{ fontSize: 16, fontWeight: "500" }}>{item.guardians?.full_name ?? "Guardian"}</Text>
            <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>About {item.students?.full_name ?? "your student"}</Text>
            {item.status === "muted" && <Text style={{ color: "#b45309", fontSize: 12, marginTop: 4 }}>Muted</Text>}
          </Pressable>
        );
      }}
    />
  );
}
