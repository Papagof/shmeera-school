import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { describeFunctionError } from "@shmeera/shared";
import { supabase } from "../lib/supabase";

interface DesigneeRow {
  id: string;
  full_name: string;
  phone: string | null;
  relationship: string | null;
  photo_url: string | null;
  status: "pending" | "approved" | "rejected";
  student_id: string;
  students: { full_name: string } | null;
}
interface ChildOption {
  student_id: string;
  full_name: string;
}

const STATUS_COLOR: Record<string, string> = { pending: "#b45309", approved: "#15803d", rejected: "#dc2626" };

export function DesigneesScreen({ userId }: { userId: string }) {
  const [designees, setDesignees] = useState<DesigneeRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [photoRequired, setPhotoRequired] = useState(false);

  const [studentId, setStudentId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [taking, setTaking] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // designees_select's RLS policy compares requested_by_guardian_id
    // directly to the caller's own guardian id (unlike guardian_student_links'
    // student_id-scoped policy, which needed an explicit client-side filter
    // — see CLAUDE.md gotcha #6) — so an unfiltered query here already only
    // ever returns this guardian's own requests.
    const { data: guardian } = await supabase.from("guardians").select("id, school_id").eq("user_id", userId).maybeSingle();
    if (!guardian) {
      setError("No guardian record found for this account.");
      setLoading(false);
      return;
    }
    setGuardianId(guardian.id);
    setSchoolId(guardian.school_id);

    const { data: school } = await supabase.from("schools").select("settings").eq("id", guardian.school_id).maybeSingle();
    setPhotoRequired(!!(school?.settings as { designee_photo_required?: boolean } | null)?.designee_photo_required);

    const [designeesRes, linksRes] = await Promise.all([
      supabase
        .from("designees")
        .select("id, full_name, phone, relationship, photo_url, status, student_id, students(full_name)")
        .order("created_at", { ascending: false }),
      supabase.from("guardian_student_links").select("student_id, students(id, full_name)").eq("guardian_id", guardian.id),
    ]);

    if (designeesRes.error) setError(designeesRes.error.message);
    else {
      const rows = (designeesRes.data ?? []) as unknown as DesigneeRow[];
      setDesignees(rows);
      const withPhotos = rows.filter((d) => d.photo_url);
      if (withPhotos.length > 0) {
        const results = await Promise.all(
          withPhotos.map((d) => supabase.storage.from("shmeera").createSignedUrl(d.photo_url as string, 3600)),
        );
        const next: Record<string, string> = {};
        withPhotos.forEach((d, i) => {
          const url = results[i]?.data?.signedUrl;
          if (url) next[d.id] = url;
        });
        setPhotoUrls(next);
      }
    }

    const kids = (linksRes.data ?? [])
      .map((l) => {
        const student = l.students as unknown as { id: string; full_name: string } | null;
        return student ? { student_id: student.id, full_name: student.full_name } : null;
      })
      .filter((k): k is ChildOption => k !== null);
    setChildren(kids);
    if (kids.length > 0) setStudentId((prev) => prev || kids[0].student_id);

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function takePhoto() {
    setTaking(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.4 });
      // On web, expo-camera's base64 includes a data:image/jpeg;base64,
      // prefix that atob() rejects — see CLAUDE.md gotcha #13.
      const raw = photo?.base64?.replace(/^data:image\/\w+;base64,/, "");
      if (raw) {
        setPhotoBase64(raw);
        setShowCamera(false);
      }
    } finally {
      setTaking(false);
    }
  }

  async function submit() {
    setError(null);
    if (!studentId || !fullName.trim()) {
      setError("Choose a child and enter the designee's name.");
      return;
    }
    if (photoRequired && !photoBase64) {
      setError("This school requires a photo for every pickup designee.");
      return;
    }
    setSubmitting(true);

    let photoPath: string | undefined;
    if (photoBase64 && schoolId && guardianId) {
      const path = `schools/${schoolId}/designees/${guardianId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bytes = Uint8Array.from(atob(photoBase64), (c) => c.charCodeAt(0));
      const { error: uploadErr } = await supabase.storage.from("shmeera").upload(path, bytes, { contentType: "image/jpeg" });
      if (uploadErr) {
        setError(uploadErr.message);
        setSubmitting(false);
        return;
      }
      photoPath = path;
    }

    const { error: invokeError } = await supabase.functions.invoke("request-designee", {
      body: {
        student_id: studentId,
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        relationship: relationship.trim() || undefined,
        photo_url: photoPath,
      },
    });
    if (invokeError) {
      setError(await describeFunctionError(invokeError));
    } else {
      setFullName("");
      setPhone("");
      setRelationship("");
      setPhotoBase64(null);
      await load();
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={designees}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 24, gap: 12 }}
      ListHeaderComponent={
        <View style={{ marginBottom: 16, gap: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: "600" }}>Pickup designees</Text>
          <Text style={{ color: "#64748b", fontSize: 13 }}>
            Someone other than you who's allowed to pick up or drop off your child. A school admin must approve each one
            before it can be used.
          </Text>

          {children.length === 0 ? (
            <Text style={{ color: "#dc2626", fontSize: 13 }}>No linked children — a designee can't be requested yet.</Text>
          ) : (
            <View style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 14, gap: 8 }}>
              <Text style={{ fontSize: 13, color: "#64748b" }}>For child:</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {children.map((c) => (
                  <Pressable
                    key={c.student_id}
                    onPress={() => setStudentId(c.student_id)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: studentId === c.student_id ? "#0f172a" : "#f1f5f9",
                    }}
                  >
                    <Text style={{ color: studentId === c.student_id ? "#fff" : "#334155", fontSize: 13 }}>{c.full_name}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Designee's full name"
                style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10 }}
              />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone (optional)"
                style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10 }}
              />
              <TextInput
                value={relationship}
                onChangeText={setRelationship}
                placeholder="Relationship (e.g. grandparent, babysitter)"
                style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10 }}
              />

              <Text style={{ fontSize: 13, color: "#64748b" }}>
                Photo{photoRequired ? " (required by this school)" : " (optional)"}:
              </Text>
              {photoBase64 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={{ width: 48, height: 48, borderRadius: 24 }} />
                  <Pressable onPress={() => setPhotoBase64(null)}>
                    <Text style={{ color: "#64748b", fontSize: 13 }}>Retake</Text>
                  </Pressable>
                </View>
              ) : showCamera ? (
                !permission ? (
                  <ActivityIndicator />
                ) : !permission.granted ? (
                  <Pressable onPress={requestPermission} style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center" }}>
                    <Text style={{ color: "#fff" }}>Grant camera access</Text>
                  </Pressable>
                ) : (
                  <View style={{ gap: 8 }}>
                    <CameraView ref={cameraRef} style={{ height: 180, borderRadius: 12 }} />
                    <Pressable
                      disabled={taking}
                      onPress={takePhoto}
                      style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center", opacity: taking ? 0.6 : 1 }}
                    >
                      <Text style={{ color: "#fff" }}>{taking ? "…" : "Take photo"}</Text>
                    </Pressable>
                  </View>
                )
              ) : (
                <Pressable onPress={() => setShowCamera(true)} style={{ borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 10, alignItems: "center" }}>
                  <Text style={{ color: "#334155", fontSize: 13 }}>Add photo</Text>
                </Pressable>
              )}

              {error && <Text style={{ color: "#dc2626", fontSize: 13 }}>{error}</Text>}
              <Pressable
                disabled={submitting}
                onPress={submit}
                style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 12, alignItems: "center", opacity: submitting ? 0.6 : 1 }}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>{submitting ? "Submitting…" : "Request designee"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={{ color: "#64748b" }}>No designees requested yet.</Text>}
      renderItem={({ item }) => (
        <View style={{ flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 14 }}>
          {photoUrls[item.id] && <Image source={{ uri: photoUrls[item.id] }} style={{ width: 40, height: 40, borderRadius: 20 }} />}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "500" }}>{item.full_name}</Text>
              <Text style={{ color: STATUS_COLOR[item.status], fontSize: 13, fontWeight: "600", textTransform: "capitalize" }}>
                {item.status}
              </Text>
            </View>
            <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>
              For {item.students?.full_name ?? "unknown child"}
              {item.relationship ? ` · ${item.relationship}` : ""}
              {item.phone ? ` · ${item.phone}` : ""}
            </Text>
          </View>
        </View>
      )}
    />
  );
}
