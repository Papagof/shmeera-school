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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setActiveCode(null);
      setOpenThread(null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) registerForPushNotifications();
  }, [session]);

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
        <ChatListScreen onOpenThread={(id, title) => setOpenThread({ id, title })} />
      );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flex: 1 }}>{content}</View>
      {showTabs && (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e2e8f0" }}>
          <Tab label="Children" active={tab === "children"} onPress={() => setTab("children")} />
          <Tab label="Designees" active={tab === "designees"} onPress={() => setTab("designees")} />
          <Tab label="Chat" active={tab === "chat"} onPress={() => setTab("chat")} />
        </View>
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}
