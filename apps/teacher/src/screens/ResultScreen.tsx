import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { supabase } from "../lib/supabase";

export type ValidationResult =
  | {
      ok: true;
      event_id: string;
      student_name: string;
      released_to_name: string;
      designee: { full_name: string; photo_url: string | null } | null;
      validated_at: string;
    }
  | { ok: false; message: string };

// A hard red STOP screen on any invalid/expired/reused/wrong-tenant code
// attempt (SPEC.md §5.2.6) — deliberately unmissable, not a toast.
export function ResultScreen({ result, onDismiss }: { result: ValidationResult; onDismiss: () => void }) {
  const [designeePhotoUrl, setDesigneePhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const photoPath = result.ok ? result.designee?.photo_url : null;
    if (!photoPath) {
      setDesigneePhotoUrl(null);
      return;
    }
    // storage RLS (designee_photos_select, 20260902100018) grants any
    // teacher in the school read access — this is exactly the "visual
    // confirmation at the gate" the photo requirement exists for (SPEC.md
    // §6.6), so it has to actually render here, not just remind the
    // teacher to look at it (found live: the data was already flowing
    // through, the screen just never displayed it).
    supabase.storage
      .from("shmeera")
      .createSignedUrl(photoPath, 3600)
      .then(({ data }) => setDesigneePhotoUrl(data?.signedUrl ?? null));
  }, [result]);

  if (!result.ok) {
    return (
      <View style={{ flex: 1, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 40, fontWeight: "800", color: "#fff" }}>STOP</Text>
        <Text style={{ fontSize: 16, color: "#fff", textAlign: "center" }}>{result.message}</Text>
        <Pressable onPress={onDismiss} style={{ backgroundColor: "#fff", borderRadius: 8, padding: 14, paddingHorizontal: 32, marginTop: 16 }}>
          <Text style={{ color: "#dc2626", fontWeight: "700" }}>Scan again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "800", color: "#fff" }}>Release confirmed</Text>
      <Text style={{ fontSize: 18, color: "#fff", textAlign: "center" }}>{result.student_name}</Text>
      <Text style={{ fontSize: 16, color: "#dcfce7", textAlign: "center" }}>Released to {result.released_to_name}</Text>
      {result.designee && (
        <>
          {designeePhotoUrl && (
            <Image source={{ uri: designeePhotoUrl }} style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: "#fff" }} />
          )}
          <Text style={{ color: "#dcfce7", fontSize: 13 }}>Approved designee — confirm identity visually.</Text>
        </>
      )}
      <Pressable onPress={onDismiss} style={{ backgroundColor: "#fff", borderRadius: 8, padding: 14, paddingHorizontal: 32, marginTop: 16 }}>
        <Text style={{ color: "#16a34a", fontWeight: "700" }}>Scan next</Text>
      </Pressable>
    </View>
  );
}
