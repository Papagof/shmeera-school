import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setLoading(false);
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Shmeera</Text>
      <Text style={{ color: "#64748b", marginBottom: 12 }}>Sign in to generate pickup/drop-off codes.</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12 }}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12 }}
      />

      {error && <Text style={{ color: "#dc2626" }}>{error}</Text>}

      <Pressable
        onPress={handleSignIn}
        disabled={loading || !email || !password}
        style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 14, alignItems: "center", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "600" }}>Sign in</Text>}
      </Pressable>
    </View>
  );
}
