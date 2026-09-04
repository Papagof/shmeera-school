import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
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
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [taking, setTaking] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    supabase.from("memberships").select("school_id").eq("user_id", myUserId).limit(1).maybeSingle().then(({ data }) => {
      if (data?.school_id) setSchoolId(data.school_id as string);
    });

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
  }, [threadId, myUserId]);

  useEffect(() => {
    const withAttachments = messages.filter((m) => m.attachment_url && !attachmentUrls[m.id]);
    if (withAttachments.length === 0) return;
    Promise.all(
      withAttachments.map((m) => supabase.storage.from("shmeera").createSignedUrl(m.attachment_url as string, 3600)),
    ).then((results) => {
      setAttachmentUrls((prev) => {
        const next = { ...prev };
        withAttachments.forEach((m, i) => {
          const url = results[i]?.data?.signedUrl;
          if (url) next[m.id] = url;
        });
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

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

  async function sendPhoto() {
    setTaking(true);
    setError(null);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.4 });
      // On web, expo-camera's base64 includes a data:image/jpeg;base64,
      // prefix that atob() rejects — see CLAUDE.md gotcha #13.
      const raw = photo?.base64?.replace(/^data:image\/\w+;base64,/, "");
      if (!raw || !schoolId) return;

      const path = `schools/${schoolId}/chat/${threadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      const { error: uploadErr } = await supabase.storage.from("shmeera").upload(path, bytes, { contentType: "image/jpeg" });
      if (uploadErr) {
        setError(uploadErr.message);
        return;
      }
      const { error: invokeError } = await supabase.functions.invoke("send-chat-message", {
        body: { thread_id: threadId, attachment_url: path },
      });
      if (invokeError) setError(await describeFunctionError(invokeError));
      else setShowCamera(false);
    } finally {
      setTaking(false);
    }
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
                    padding: item.attachment_url ? 6 : 10,
                    overflow: "hidden",
                  }}
                >
                  {item.attachment_url &&
                    (attachmentUrls[item.id] ? (
                      <Image source={{ uri: attachmentUrls[item.id] }} style={{ width: 180, height: 180, borderRadius: 8 }} />
                    ) : (
                      <View style={{ width: 180, height: 180, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
                        <ActivityIndicator color={mine ? "#fff" : "#0f172a"} />
                      </View>
                    ))}
                  {item.body && <Text style={{ color: mine ? "#fff" : "#1e293b", padding: item.attachment_url ? 4 : 0 }}>{item.body}</Text>}
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

      {showCamera && (
        <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
          {!permission ? (
            <ActivityIndicator />
          ) : !permission.granted ? (
            <Pressable onPress={requestPermission} style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center" }}>
              <Text style={{ color: "#fff" }}>Grant camera access</Text>
            </Pressable>
          ) : (
            <>
              <CameraView ref={cameraRef} style={{ height: 200, borderRadius: 12 }} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => setShowCamera(false)} style={{ flex: 1, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10, alignItems: "center" }}>
                  <Text style={{ color: "#334155" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={taking}
                  onPress={sendPhoto}
                  style={{ flex: 1, backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center", opacity: taking ? 0.6 : 1 }}
                >
                  <Text style={{ color: "#fff" }}>{taking ? "Sending…" : "Take & send"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
        <Pressable
          onPress={() => setShowCamera((v) => !v)}
          style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 20, paddingHorizontal: 14, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 16 }}>📷</Text>
        </Pressable>
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
