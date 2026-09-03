import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { describeFunctionError } from "@shmeera/shared";
import { supabase } from "../lib/supabase";

interface LinkedStudent {
  student_id: string;
  pickup_authorized: boolean;
  restriction_note: string | null;
  students: { id: string; full_name: string } | null;
}
interface ApprovedDesignee {
  id: string;
  full_name: string;
  student_id: string;
}

export interface GeneratedCode {
  id: string;
  code: string;
  qr_payload: string;
  expires_at: string;
}

export function ChildListScreen({
  userId,
  onSignOut,
  onCodeGenerated,
}: {
  userId: string;
  onSignOut: () => void;
  onCodeGenerated: (student: LinkedStudent, type: "dropoff" | "pickup", result: GeneratedCode) => void;
}) {
  const [links, setLinks] = useState<LinkedStudent[]>([]);
  const [designees, setDesignees] = useState<ApprovedDesignee[]>([]);
  const [selectedDesignee, setSelectedDesignee] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // gsl_select's RLS policy scopes by student_id membership, not by
    // guardian_id — a shared child (two guardians, or a guardian + an
    // emergency contact) means *every* guardian_student_links row for that
    // student is visible to each of them, not just their own. Querying
    // unfiltered would render one card per link row instead of one per
    // child, duplicating any shared child (found via live testing with a
    // real multi-guardian family). Resolve this guardian's own id first,
    // then filter explicitly to their own relationship to each child.
    // `userId` comes from the already-resolved session in App.tsx — calling
    // supabase.auth.getUser() here instead raced session hydration on a
    // real (non-freshly-logged-in) browser load and returned no user,
    // producing `invalid input syntax for type uuid: ""` (found live).
    const { data: guardian, error: guardianError } = await supabase
      .from("guardians")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (guardianError || !guardian) {
      setError(guardianError?.message ?? "No guardian record found for this account.");
      setLoading(false);
      return;
    }

    const [linksRes, designeesRes] = await Promise.all([
      supabase
        .from("guardian_student_links")
        .select("student_id, pickup_authorized, restriction_note, students(id, full_name)")
        .eq("guardian_id", guardian.id),
      // designees_select's RLS already scopes this to designees THIS
      // guardian requested (requested_by_guardian_id = own guardian id) —
      // a code can only ever be generated for an approved designee this
      // guardian personally vetted, not one a co-guardian requested.
      supabase.from("designees").select("id, full_name, student_id").eq("status", "approved"),
    ]);
    if (linksRes.error) setError(linksRes.error.message);
    else setLinks((linksRes.data ?? []) as unknown as LinkedStudent[]);
    setDesignees((designeesRes.data ?? []) as ApprovedDesignee[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(link: LinkedStudent, type: "dropoff" | "pickup") {
    setGeneratingFor(`${link.student_id}:${type}`);
    setError(null);

    const designeeId = selectedDesignee[link.student_id];
    const { data, error: invokeError } = await supabase.functions.invoke("generate-event-code", {
      body: { student_id: link.student_id, type, designee_id: designeeId || undefined },
    });

    if (invokeError) {
      setError(await describeFunctionError(invokeError));
    } else if (data) {
      onCodeGenerated(link, type, data as GeneratedCode);
    }
    setGeneratingFor(null);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "600" }}>Your children</Text>
        <Pressable onPress={onSignOut}>
          <Text style={{ color: "#64748b" }}>Sign out</Text>
        </Pressable>
      </View>

      {error && <Text style={{ color: "#dc2626", marginBottom: 12 }}>{error}</Text>}

      <FlatList
        data={links}
        keyExtractor={(item) => item.student_id}
        renderItem={({ item }) => {
          const childDesignees = designees.filter((d) => d.student_id === item.student_id);
          const selected = selectedDesignee[item.student_id] ?? "";
          return (
          <View style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "500" }}>{item.students?.full_name ?? "Unknown"}</Text>
            {(!item.pickup_authorized || item.restriction_note) && (
              <Text style={{ color: "#dc2626", marginTop: 4 }}>You are not authorized to release this student.</Text>
            )}
            {childDesignees.length > 0 && (
              <View style={{ marginTop: 10, gap: 6 }}>
                <Text style={{ fontSize: 12, color: "#64748b" }}>Releasing to:</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Pressable
                    onPress={() => setSelectedDesignee((prev) => ({ ...prev, [item.student_id]: "" }))}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: selected === "" ? "#0f172a" : "#f1f5f9" }}
                  >
                    <Text style={{ color: selected === "" ? "#fff" : "#334155", fontSize: 12 }}>Myself</Text>
                  </Pressable>
                  {childDesignees.map((d) => (
                    <Pressable
                      key={d.id}
                      onPress={() => setSelectedDesignee((prev) => ({ ...prev, [item.student_id]: d.id }))}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: selected === d.id ? "#0f172a" : "#f1f5f9" }}
                    >
                      <Text style={{ color: selected === d.id ? "#fff" : "#334155", fontSize: 12 }}>{d.full_name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable
                disabled={!item.pickup_authorized || generatingFor !== null}
                onPress={() => generate(item, "dropoff")}
                style={{ flex: 1, backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center", opacity: !item.pickup_authorized ? 0.4 : 1 }}
              >
                <Text style={{ color: "#fff" }}>
                  {generatingFor === `${item.student_id}:dropoff` ? "…" : "Drop-off code"}
                </Text>
              </Pressable>
              <Pressable
                disabled={!item.pickup_authorized || generatingFor !== null}
                onPress={() => generate(item, "pickup")}
                style={{ flex: 1, backgroundColor: "#0f172a", borderRadius: 8, padding: 10, alignItems: "center", opacity: !item.pickup_authorized ? 0.4 : 1 }}
              >
                <Text style={{ color: "#fff" }}>
                  {generatingFor === `${item.student_id}:pickup` ? "…" : "Pickup code"}
                </Text>
              </Pressable>
            </View>
          </View>
          );
        }}
        ListEmptyComponent={<Text style={{ color: "#64748b" }}>No children linked to your account yet.</Text>}
      />
    </View>
  );
}
