import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { cacheRoster, cacheSchoolId, getCachedRoster } from "../lib/rosterCache";
import { flushOverrideQueue, getQueueSize } from "../lib/overrideQueue";

interface GuardianLink {
  relationship: string | null;
  is_primary: boolean;
  guardians: { full_name: string; phone: string | null } | null;
}
interface RosterStudent {
  id: string;
  full_name: string;
  photo_url: string | null;
  classes: { name: string } | null;
  guardian_student_links: GuardianLink[];
}

export function RosterScreen({ onOpenOverride }: { onOpenOverride: () => void }) {
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

  async function trySync() {
    setSyncing(true);
    const { flushed, remaining } = await flushOverrideQueue();
    if (flushed > 0) setSyncStatus(`Synced ${flushed} queued manual override${flushed === 1 ? "" : "s"}.`);
    setPendingCount(remaining);
    setSyncing(false);
  }

  useEffect(() => {
    getQueueSize().then(setPendingCount);
    // A tab switch away-and-back remounts this screen and retries then, but
    // a teacher who just stays on this screen while connectivity returns
    // needs a backstop too — poll every 20s rather than depending on
    // navigation timing to eventually flush a queued manual override.
    const interval = setInterval(async () => {
      const size = await getQueueSize();
      if (size > 0) await trySync();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // No school_id / class_id filter — RLS already scopes this to exactly
    // the caller's own class roster (private.teacher_student_ids, SPEC.md
    // §3.1), same convention as ChildListScreen on the parent side.
    supabase
      .from("students")
      .select(
        "id, full_name, photo_url, classes(name), guardian_student_links(relationship, is_primary, guardians(full_name, phone))",
      )
      .order("full_name")
      .then(async ({ data, error: fetchError }) => {
        if (fetchError) {
          // Offline fallback (SPEC.md §6.13): "the teacher app caches the
          // last-synced roster" — a fetch failure falls back to it instead
          // of just showing an error, since this may be a genuinely offline
          // session where the manual-override screen is the only option.
          const cached = await getCachedRoster();
          if (cached.length > 0) {
            setStudents(
              cached.map((s) => ({ id: s.id, full_name: s.full_name, photo_url: null, classes: null, guardian_student_links: [] })),
            );
            setOffline(true);
          } else {
            setError(fetchError.message);
          }
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as unknown as RosterStudent[];
        setStudents(rows);
        await cacheRoster(rows.map((s) => ({ id: s.id, full_name: s.full_name, class_id: null })));

        const { data: membership } = await supabase.from("memberships").select("school_id").eq("role", "teacher").limit(1).maybeSingle();
        if (membership?.school_id) await cacheSchoolId(membership.school_id as string);

        // storage RLS (student_photos_select, 20260902100016) allows this
        // the same way it allows the admin dashboard — a teacher can only
        // sign their own class's photo paths.
        const withPhotos = rows.filter((s) => s.photo_url);
        if (withPhotos.length > 0) {
          const results = await Promise.all(
            withPhotos.map((s) => supabase.storage.from("shmeera").createSignedUrl(s.photo_url as string, 3600)),
          );
          const next: Record<string, string> = {};
          withPhotos.forEach((s, i) => {
            const url = results[i]?.data?.signedUrl;
            if (url) next[s.id] = url;
          });
          setPhotoUrls(next);
        }
        setLoading(false);

        // Back online (this fetch just succeeded) — flush any manual
        // overrides queued while offline.
        await trySync();
      });
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12 }}>
        <Text style={{ color: "#dc2626" }}>{error}</Text>
        <Text style={{ color: "#64748b", fontSize: 13 }}>
          No cached roster is available either — manual override needs at least one successful online visit to this
          screen first.
        </Text>
      </View>
    );
  }

  const searchTerm = search.trim().toLowerCase();
  const filteredStudents = searchTerm
    ? students.filter((s) => s.full_name.toLowerCase().includes(searchTerm))
    : students;

  return (
    <FlatList
      data={filteredStudents}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 24, gap: 12 }}
      ListHeaderComponent={
        <View style={{ marginBottom: 12, gap: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search students by name…"
            style={{
              borderWidth: 1,
              borderColor: "#e2e8f0",
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 15,
            }}
          />
          {offline && (
            <Text style={{ color: "#b45309", fontSize: 13 }}>
              Offline — showing your last-synced roster. Use manual override to record a release.
            </Text>
          )}
          {syncStatus && <Text style={{ color: "#15803d", fontSize: 13 }}>{syncStatus}</Text>}
          {pendingCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: "#b45309", fontSize: 13 }}>
                {pendingCount} manual override{pendingCount === 1 ? "" : "s"} waiting to sync.
              </Text>
              <Pressable onPress={trySync} disabled={syncing}>
                <Text style={{ color: "#0f172a", fontSize: 13, fontWeight: "600", opacity: syncing ? 0.5 : 1 }}>
                  {syncing ? "Syncing…" : "Sync now"}
                </Text>
              </Pressable>
            </View>
          )}
          <Pressable
            onPress={onOpenOverride}
            style={{ borderWidth: 1, borderColor: "#dc2626", borderRadius: 8, padding: 10, alignItems: "center" }}
          >
            <Text style={{ color: "#dc2626", fontWeight: "600", fontSize: 13 }}>Manual override release</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <Text style={{ color: "#64748b" }}>
          {searchTerm ? "No students match your search." : "No students in your class yet."}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 14, flexDirection: "row", gap: 12 }}>
          {photoUrls[item.id] ? (
            <Image source={{ uri: photoUrls[item.id] }} style={{ width: 44, height: 44, borderRadius: 22 }} />
          ) : (
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "#f1f5f9",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#94a3b8", fontSize: 12 }}>—</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "600" }}>{item.full_name}</Text>
          <Text style={{ color: "#64748b", fontSize: 13, marginTop: 2 }}>{item.classes?.name ?? "No class"}</Text>
          {item.guardian_student_links.length === 0 ? (
            <Text style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>No guardian on file</Text>
          ) : (
            <View style={{ marginTop: 6, gap: 2 }}>
              {item.guardian_student_links.map((link, i) => (
                <Text key={i} style={{ fontSize: 13, color: "#334155" }}>
                  {link.guardians?.full_name ?? "Unknown guardian"}
                  {link.relationship ? ` (${link.relationship})` : ""}
                  {link.is_primary ? " · primary" : ""}
                  {link.guardians?.phone ? ` · ${link.guardians.phone}` : ""}
                </Text>
              ))}
            </View>
          )}
          </View>
        </View>
      )}
    />
  );
}
