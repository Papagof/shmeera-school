import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { describeFunctionError } from "@shmeera/shared";
import { supabase } from "../lib/supabase";

interface Message {
  id: string;
  sender_id: string;
  sender_role: "guardian" | "teacher";
  body: string | null;
  attachment_url: string | null;
  delivered_after_hours: boolean;
  created_at: string;
}

export function ChatThreadScreen({
  threadId,
  title,
  myUserId,
  onBack,
}: {
  threadId: string;
  title: string;
  myUserId: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    supabase.functions
      .invoke("get-chat-thread", { body: { thread_id: threadId } })
      .then(async ({ data, error: invokeError }) => {
        if (invokeError) setError(await describeFunctionError(invokeError));
        else setMessages((data?.messages ?? []) as Message[]);
        setLoading(false);
      });

    // chat_messages is in the supabase_realtime publication
    // (20260902100007_realtime.sql), RLS-gated the same as every other
    // subscription in this app (SPEC.md §3.3.5) — a new message here only
    // ever arrives if this participant could already SELECT it directly.
    const channel = supabase
      .channel(`chat:${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new as Message]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft("");
    const { error: invokeError } = await supabase.functions.invoke("send-chat-message", {
      body: { thread_id: threadId, body: text },
    });
    if (invokeError) setError(await describeFunctionError(invokeError));
    setSending(false);
  }

  async function submitReport() {
    if (!reportReason.trim()) return;
    const { error: invokeError } = await supabase.functions.invoke("report-chat", {
      body: { thread_id: threadId, reason: reportReason.trim() },
    });
    if (invokeError) setReportStatus(await describeFunctionError(invokeError));
    else {
      setReportStatus("Reported to the school.");
      setReportReason("");
      setReporting(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
        <Pressable onPress={onBack}>
          <Text style={{ color: "#64748b" }}>{"< Back"}</Text>
        </Pressable>
        <Text style={{ fontWeight: "600" }}>{title}</Text>
        <Pressable onPress={() => setReporting((v) => !v)}>
          <Text style={{ color: "#dc2626", fontSize: 13 }}>Report</Text>
        </Pressable>
      </View>

      {reporting && (
        <View style={{ padding: 12, gap: 8, backgroundColor: "#fef2f2" }}>
          <TextInput
            value={reportReason}
            onChangeText={setReportReason}
            placeholder="Why are you reporting this conversation?"
            style={{ borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, padding: 10, backgroundColor: "#fff" }}
          />
          <Pressable onPress={submitReport} style={{ backgroundColor: "#dc2626", borderRadius: 8, padding: 10, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Submit report</Text>
          </Pressable>
        </View>
      )}
      {reportStatus && <Text style={{ color: "#15803d", fontSize: 13, padding: 8, textAlign: "center" }}>{reportStatus}</Text>}

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={{ color: "#64748b", textAlign: "center" }}>No messages yet — say hello.</Text>}
          renderItem={({ item }) => {
            const mine = item.sender_id === myUserId;
            return (
              <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                <View
                  style={{
                    maxWidth: "80%",
                    backgroundColor: mine ? "#0f172a" : "#f1f5f9",
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <Text style={{ color: mine ? "#fff" : "#1e293b" }}>{item.body}</Text>
                </View>
                <Text style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                  {new Date(item.created_at).toLocaleTimeString()}
                  {item.delivered_after_hours ? " · sent after hours" : ""}
                </Text>
              </View>
            );
          }}
        />
      )}

      {error && <Text style={{ color: "#dc2626", fontSize: 13, padding: 8 }}>{error}</Text>}

      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          style={{ flex: 1, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }}
        />
        <Pressable
          disabled={sending || !draft.trim()}
          onPress={send}
          style={{ backgroundColor: "#0f172a", borderRadius: 20, paddingHorizontal: 16, justifyContent: "center", opacity: !draft.trim() ? 0.4 : 1 }}
        >
          <Text style={{ color: "#fff" }}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}
