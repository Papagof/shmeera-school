import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../lib/supabase";
import type { GeneratedCode } from "./ChildListScreen";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function CodeScreen({
  studentName,
  type,
  result,
  onDone,
}: {
  studentName: string;
  type: "dropoff" | "pickup";
  result: GeneratedCode;
  onDone: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = new Date(result.expires_at).getTime() - now;

  async function revoke() {
    setRevoking(true);
    await supabase.functions.invoke("revoke-code", { body: { event_code_id: result.id } });
    setRevoking(false);
    onDone();
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>
        {type === "dropoff" ? "Drop-off" : "Pickup"} code for {studentName}
      </Text>

      <View style={{ padding: 16, backgroundColor: "#fff", borderRadius: 16 }}>
        <QRCode value={result.qr_payload} size={220} />
      </View>

      <Text style={{ fontSize: 32, fontWeight: "700", letterSpacing: 8 }}>{result.code}</Text>
      <Text style={{ color: remainingMs <= 0 ? "#dc2626" : "#64748b" }}>
        {remainingMs <= 0 ? "Expired" : `Expires in ${formatRemaining(remainingMs)}`}
      </Text>

      <Pressable
        onPress={revoke}
        disabled={revoking || remainingMs <= 0}
        style={{ borderWidth: 1, borderColor: "#dc2626", borderRadius: 8, padding: 12, paddingHorizontal: 24 }}
      >
        <Text style={{ color: "#dc2626" }}>{revoking ? "Revoking…" : "Revoke code"}</Text>
      </Pressable>

      <Pressable onPress={onDone}>
        <Text style={{ color: "#64748b", marginTop: 8 }}>Back to children</Text>
      </Pressable>
    </View>
  );
}
