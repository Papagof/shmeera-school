import { createClient } from "@/lib/supabase/server";
import { PeopleManager, type ClassRow, type StaffRow, type GuardianRow, type StudentRow, type LinkRow } from "./people-manager";

// No school_id filters anywhere below on purpose — RLS already scopes every
// query here to the admin's own school (SPEC.md §3.1); see events/page.tsx
// for the same convention.
export default async function PeoplePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership, error: membershipErr } = await supabase
    .from("memberships")
    .select("school_id")
    .eq("user_id", user?.id ?? "")
    .eq("role", "school_admin")
    .maybeSingle();
  if (membershipErr || !membership) {
    return <p className="text-sm text-red-600">Failed to resolve your school: {membershipErr?.message ?? "no school_admin membership"}</p>;
  }
  const schoolId = membership.school_id as string;

  const [{ data: classes, error: classesErr }, { data: staff, error: staffErr }, { data: guardians, error: guardiansErr }, { data: students, error: studentsErr }, { data: links, error: linksErr }] =
    await Promise.all([
      supabase.from("classes").select("id, name, teacher_id").order("name"),
      supabase.from("staff").select("id, user_id, full_name, phone, class_id").order("full_name"),
      supabase.from("guardians").select("id, user_id, full_name, phone, status").order("full_name"),
      supabase.from("students").select("id, full_name, dob, class_id, status, photo_url").order("full_name"),
      supabase.from("guardian_student_links").select("id, guardian_id, student_id, relationship, is_primary, pickup_authorized"),
    ]);

  const error = classesErr || staffErr || guardiansErr || studentsErr || linksErr;
  if (error) {
    return <p className="text-sm text-red-600">Failed to load people: {error.message}</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">People</h1>
      <p className="mt-1 text-sm text-slate-500">
        Add classes, invite teachers and guardians, add students, and link guardians to the students they can pick up.
      </p>
      <div className="mt-6">
        <PeopleManager
          schoolId={schoolId}
          initialClasses={(classes ?? []) as ClassRow[]}
          initialStaff={(staff ?? []) as StaffRow[]}
          initialGuardians={(guardians ?? []) as GuardianRow[]}
          initialStudents={(students ?? []) as StudentRow[]}
          initialLinks={(links ?? []) as LinkRow[]}
        />
      </div>
    </div>
  );
}
