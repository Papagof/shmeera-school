import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./src/lib/supabase";
import { registerForPushNotifications } from "./src/lib/pushRegistration";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { RosterScreen } from "./src/screens/RosterScreen";
import { OverrideScreen } from "./src/screens/OverrideScreen";
import { ChatListScreen } from "./src/screens/ChatListScreen";
import { ChatThreadScreen } from "./src/screens/ChatThreadScreen";
import { ResultScreen, type ValidationResult } from "./src/screens/ResultScreen";

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
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [tab, setTab] = useState<"scan" | "roster" | "chat">("scan");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [openThread, setOpenThread] = useState<OpenThread | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setResult(null);
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
  } else if (result) {
    content = <ResultScreen result={result} onDismiss={() => setResult(null)} />;
  } else if (overrideOpen) {
    content = <OverrideScreen onDone={() => setOverrideOpen(false)} />;
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
      tab === "scan" ? (
        <ScanScreen onResult={setResult} onOpenOverride={() => setOverrideOpen(true)} />
      ) : tab === "roster" ? (
        <RosterScreen onOpenOverride={() => setOverrideOpen(true)} />
      ) : (
        <ChatListScreen onOpenThread={(id, title) => setOpenThread({ id, title })} />
      );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {showTabs && (
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
          <Tab label="Scan" active={tab === "scan"} onPress={() => setTab("scan")} />
          <Tab label="My class" active={tab === "roster"} onPress={() => setTab("roster")} />
          <Tab label="Chat" active={tab === "chat"} onPress={() => setTab("chat")} />
        </View>
      )}
      <View style={{ flex: 1 }}>{content}</View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}
