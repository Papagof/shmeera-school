import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { describeFunctionError } from "@shmeera/shared";
import { supabase } from "../lib/supabase";
import { getCachedRoster, getCachedSchoolId, type CachedStudent } from "../lib/rosterCache";
import { enqueueOverride } from "../lib/overrideQueue";

// Offline fallback (SPEC.md §6.13). Reached only when the normal
// validate-event-code path can't be used — no fresh location fix, or no
// connectivity at all — so this never involves an event_code: the teacher
// directly attests to the release, with a mandatory photo + note standing
// in for the code-and-location verification, and every use is flagged for
// admin review (manual-override-release inserts a security_alerts row).
export function OverrideScreen({ onDone }: { onDone: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [roster, setRoster] = useState<CachedStudent[]>([]);
  const [studentId, setStudentId] = useState("");
  const [type, setType] = useState<"dropoff" | "pickup">("pickup");
  const [releasedToName, setReleasedToName] = useState("");
  const [note, setNote] = useState("");
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    getCachedRoster().then((cached) => {
      setRoster(cached);
      if (cached.length > 0) setStudentId((prev) => prev || cached[0].id);
    });
  }, []);

  async function takePhoto() {
    setTaking(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.4 });
      // On web, expo-camera's base64 includes a `data:image/jpeg;base64,`
      // prefix (from the underlying canvas.toDataURL()) that atob() rejects
      // as invalid base64 — stripped once here so every downstream consumer
      // (immediate upload, the offline queue) always gets a bare string.
      // Native devices return a bare base64 string already, so this is a
      // no-op there.
      const raw = photo?.base64?.replace(/^data:image\/\w+;base64,/, "");
      if (raw) setPhotoBase64(raw);
    } finally {
      setTaking(false);
    }
  }

  async function submit() {
    setStatus(null);
    if (!studentId || !releasedToName.trim() || !note.trim() || !photoBase64) {
      setStatus("Choose a student, take a photo, and fill in both fields — all are required for a manual override.");
      return;
    }
    setSubmitting(true);

    // Cached on the last successful "My class" fetch (RosterScreen) — read
    // from there first so this never depends on network, which would defeat
    // the entire point of an offline path. Only falls back to a live query
    // if the cache was somehow never populated (e.g. this is the very first
    // screen visited this session).
    let schoolId = await getCachedSchoolId();
    if (!schoolId) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("school_id")
        .eq("role", "teacher")
        .limit(1)
        .maybeSingle();
      schoolId = (membership?.school_id as string | undefined) ?? null;
    }
    if (!schoolId) {
      setStatus("Could not resolve your school — visit \"My class\" once while online, then try again.");
      setSubmitting(false);
      return;
    }

    const path = `schools/${schoolId}/overrides/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const bytes = Uint8Array.from(atob(photoBase64), (c) => c.charCodeAt(0));

    // Try to submit immediately — this covers "location unavailable but
    // network is fine." Only fall back to the local queue when the failure
    // looks like a genuine connectivity problem (no server response at
    // all), not a real rejection (bad input, not-your-student, etc.),
    // which should surface as an error instead of silently queuing forever.
    const { error: uploadErr } = await supabase.storage.from("shmeera").upload(path, bytes, { contentType: "image/jpeg" });
    const uploadLooksOffline = uploadErr && /network|fetch/i.test(uploadErr.message ?? "");

    if (uploadErr && !uploadLooksOffline) {
      setStatus(uploadErr.message);
      setSubmitting(false);
      return;
    }

    if (!uploadErr) {
      const { error: invokeErr } = await supabase.functions.invoke("manual-override-release", {
        body: { student_id: studentId, type, released_to_name: releasedToName.trim(), note: note.trim(), photo_path: path },
      });
      const hadServerResponse = !!(invokeErr as { context?: Response } | null)?.context;
      if (!invokeErr) {
        setStatus("Release recorded — flagged for admin review.");
        setSubmitting(false);
        setTimeout(onDone, 1200);
        return;
      }
      if (hadServerResponse) {
        setStatus(await describeFunctionError(invokeErr));
        setSubmitting(false);
        return;
      }
      // No server response reached at all — genuinely offline; fall through to queue below.
    }

    await enqueueOverride({
      local_id: Math.random().toString(36).slice(2),
      student_id: studentId,
      type,
      released_to_name: releasedToName.trim(),
      note: note.trim(),
      photo_base64: photoBase64,
      school_id: schoolId,
      queued_at: new Date().toISOString(),
    });
    setStatus("No connection — saved on this device and will sync automatically once you're back online.");
    setSubmitting(false);
    setTimeout(onDone, 1600);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Manual override release</Text>
      <Text style={{ color: "#64748b", fontSize: 13 }}>
        No code and no location fix required — but a photo and a note are mandatory, and this is always flagged for
        admin review.
      </Text>

      {roster.length === 0 ? (
        <Text style={{ color: "#dc2626", fontSize: 13 }}>
          No cached roster yet — open "My class" once while online before you can use this offline.
        </Text>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {roster.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setStudentId(s.id)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: studentId === s.id ? "#0f172a" : "#f1f5f9",
              }}
            >
              <Text style={{ color: studentId === s.id ? "#fff" : "#334155", fontSize: 13 }}>{s.full_name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 6 }}>
        {(["dropoff", "pickup"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setType(t)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: type === t ? "#0f172a" : "#f1f5f9",
            }}
          >
            <Text style={{ color: type === t ? "#fff" : "#334155", fontSize: 13, textTransform: "capitalize" }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={releasedToName}
        onChangeText={setReleasedToName}
        placeholder="Released to (name)"
        style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10 }}
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (why the normal process wasn't available, ID shown, etc.)"
        multiline
        numberOfLines={3}
        style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10, minHeight: 70, textAlignVertical: "top" }}
      />

      {photoBase64 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, color: "#15803d" }}>Photo captured.</Text>
          <Pressable onPress={() => setPhotoBase64(null)} style={{ alignSelf: "flex-start" }}>
            <Text style={{ color: "#64748b", fontSize: 13 }}>Retake</Text>
          </Pressable>
        </View>
      ) : !permission ? (
        <ActivityIndicator />
      ) : !permission.granted ? (
        <Pressable onPress={requestPermission} style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 12, alignItems: "center" }}>
          <Text style={{ color: "#fff" }}>Grant camera access</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          <CameraView ref={cameraRef} style={{ height: 220, borderRadius: 12 }} />
          <Pressable
            disabled={taking}
            onPress={takePhoto}
            style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 12, alignItems: "center", opacity: taking ? 0.6 : 1 }}
          >
            <Text style={{ color: "#fff" }}>{taking ? "…" : "Take photo"}</Text>
          </Pressable>
        </View>
      )}

      {status && <Text style={{ color: status.startsWith("Release recorded") || status.startsWith("No connection") ? "#15803d" : "#dc2626", fontSize: 13 }}>{status}</Text>}

      <Pressable
        disabled={submitting}
        onPress={submit}
        style={{ backgroundColor: "#dc2626", borderRadius: 8, padding: 14, alignItems: "center", opacity: submitting ? 0.6 : 1 }}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "600" }}>Confirm manual release</Text>}
      </Pressable>
      <Pressable onPress={onDone}>
        <Text style={{ color: "#64748b", textAlign: "center" }}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}
