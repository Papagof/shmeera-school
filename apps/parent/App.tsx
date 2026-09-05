import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./src/lib/supabase";
import { registerForPushNotifications } from "./src/lib/pushRegistration";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ChildListScreen, type GeneratedCode } from "./src/screens/ChildListScreen";
import { DesigneesScreen } from "./src/screens/DesigneesScreen";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatThreadScreen } from "./src/screens/ChatThreadScreen";
import { CodeScreen } from "./src/screens/CodeScreen";

interface ActiveCode {
  studentName: string;
  type: "dropoff" | "pickup";
  result: GeneratedCode;
}
interface OpenThread {
  id: string;
  title: string;
}

const MY_ROLE = "guardian";

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: active ? "#0f172a" : "transparent" }}>
      <Text style={{ color: active ? "#0f172a" : "#94a3b8", fontWeight: active ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [activeCode, setActiveCode] = useState<ActiveCode | null>(null);
  const [tab, setTab] = useState<"children" | "designees" | "chat">("children");
  const [openThread, setOpenThread] = useState<OpenThread | null>(null);
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setActiveCode(null);
      setOpenThread(null);
    });

    // The unified sign-in page (apps/admin's /login — see the comment
    // there) hands a guardian off here with the session in the URL hash
    // (#access_token=...&refresh_token=...), same mechanism as the
    // invite-email accept-invite flow. supabase.ts sets
    // detectSessionInUrl: false, so this has to be done explicitly; `window`
    // only exists on the web build, hence the guard.
    async function init() {
      if (typeof window !== "undefined" && window.location?.hash) {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          window.history.replaceState(null, "", window.location.pathname);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    }
    init();

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) registerForPushNotifications();
  }, [session]);

  useEffect(() => {
    // App-wide badge: no push on web (README — Expo push tokens need a real
    // device), and ChatListScreen only knows about unread threads once it's
    // mounted, so this global subscription is what lets a guardian see a
    // new message arrived while sitting on the Children/Designees tab.
    // Marking a thread unread here is always safe even if it's the one
    // currently open — ChatThreadScreen's own onRead immediately clears it.
    if (!session) return;
    const channel = supabase
      .channel(`chat-badge:${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const msg = payload.new as { thread_id: string; sender_role: string };
          if (msg.sender_role === MY_ROLE) return;
          setUnreadThreadIds((prev) => new Set(prev).add(msg.thread_id));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  let content: React.ReactNode;
  let showTabs = false;
  if (session === undefined) {
    content = <ActivityIndicator />;
  } else if (!session) {
    content = <LoginScreen />;
  } else if (activeCode) {
    content = (
      <CodeScreen
        studentName={activeCode.studentName}
        type={activeCode.type}
        result={activeCode.result}
        onDone={() => setActiveCode(null)}
      />
    );
  } else if (tab === "chat" && openThread) {
    content = (
      <ChatThreadScreen
        threadId={openThread.id}
        title={openThread.title}
        myUserId={session.user.id}
        onBack={() => setOpenThread(null)}
        onRead={(threadId) =>
          setUnreadThreadIds((prev) => {
            if (!prev.has(threadId)) return prev;
            const next = new Set(prev);
            next.delete(threadId);
            return next;
          })
        }
      />
    );
  } else {
    showTabs = true;
    content =
      tab === "children" ? (
        <ChildListScreen
          userId={session.user.id}
          onSignOut={() => supabase.auth.signOut()}
          onCodeGenerated={(link, type, result) =>
            setActiveCode({ studentName: link.students?.full_name ?? "your child", type, result })
          }
        />
      ) : tab === "designees" ? (
        <DesigneesScreen userId={session.user.id} />
      ) : (
        <ChatListScreen
          onOpenThread={(id, title) => setOpenThread({ id, title })}
          onUnreadThreadsChange={setUnreadThreadIds}
        />
      );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flex: 1 }}>{content}</View>
      {showTabs && (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
          <Tab label="Children" active={tab === "children"} onPress={() => setTab("children")} />
          <Tab label="Designees" active={tab === "designees"} onPress={() => setTab("designees")} />
          <Tab
            label={unreadThreadIds.size > 0 ? `Chat (${unreadThreadIds.size})` : "Chat"}
            active={tab === "chat"}
            onPress={() => setTab("chat")}
          />
        </View>
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}
