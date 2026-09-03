"use client";

import { useEffect, useRef, useState } from "react";
import { describeFunctionError } from "@shmeera/shared";
import { createClient } from "@/lib/supabase/client";

export interface ClassRow {
  id: string;
  name: string;
  teacher_id: string | null;
}
export interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  class_id: string | null;
}
export interface GuardianRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  status: string;
}
export interface StudentRow {
  id: string;
  full_name: string;
  dob: string | null;
  class_id: string | null;
  status: string;
  photo_url: string | null;
}
export interface LinkRow {
  id: string;
  guardian_id: string;
  student_id: string;
  relationship: string | null;
  is_primary: boolean;
  pickup_authorized: boolean;
}

const inputClass = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const buttonClass = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";
const smallButtonClass = "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50";
const smallDangerClass = "rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 disabled:opacity-50";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium text-slate-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function PeopleManager({
  schoolId,
  initialClasses,
  initialStaff,
  initialGuardians,
  initialStudents,
  initialLinks,
}: {
  schoolId: string;
  initialClasses: ClassRow[];
  initialStaff: StaffRow[];
  initialGuardians: GuardianRow[];
  initialStudents: StudentRow[];
  initialLinks: LinkRow[];
}) {
  const [classes, setClasses] = useState(initialClasses);
  const [staff, setStaff] = useState(initialStaff);
  const [guardians, setGuardians] = useState(initialGuardians);
  const [students, setStudents] = useState(initialStudents);
  const [links, setLinks] = useState(initialLinks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editingGuardianId, setEditingGuardianId] = useState<string | null>(null);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const paths = students.filter((s) => s.photo_url).map((s) => s.photo_url as string);
    if (paths.length === 0) return;
    const supabase = createClient();
    Promise.all(paths.map((path) => supabase.storage.from("shmeera").createSignedUrl(path, 3600))).then((results) => {
      const next: Record<string, string> = {};
      students.forEach((s) => {
        if (!s.photo_url) return;
        const idx = paths.indexOf(s.photo_url);
        const url = results[idx]?.data?.signedUrl;
        if (url) next[s.id] = url;
      });
      setPhotoUrls(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  function triggerPhotoUpload(studentId: string) {
    photoTargetRef.current = studentId;
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const studentId = photoTargetRef.current;
    e.target.value = "";
    if (!file || !studentId) return;

    setUploadingPhotoFor(studentId);
    setError(null);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `schools/${schoolId}/students/${studentId}/photo.${ext}`;
    const supabase = createClient();

    const { error: uploadErr } = await supabase.storage.from("shmeera").upload(path, file, { upsert: true });
    if (uploadErr) {
      setError(uploadErr.message);
      setUploadingPhotoFor(null);
      return;
    }
    const { error: updateErr } = await supabase.from("students").update({ photo_url: path }).eq("id", studentId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setUploadingPhotoFor(null);
  }

  async function refresh() {
    const supabase = createClient();
    const [c, s, g, st, l] = await Promise.all([
      supabase.from("classes").select("id, name, teacher_id").order("name"),
      supabase.from("staff").select("id, user_id, full_name, phone, class_id").order("full_name"),
      supabase.from("guardians").select("id, user_id, full_name, phone, status").order("full_name"),
      supabase.from("students").select("id, full_name, dob, class_id, status, photo_url").order("full_name"),
      supabase.from("guardian_student_links").select("id, guardian_id, student_id, relationship, is_primary, pickup_authorized"),
    ]);
    if (c.data) setClasses(c.data as ClassRow[]);
    if (s.data) setStaff(s.data as StaffRow[]);
    if (g.data) setGuardians(g.data as GuardianRow[]);
    if (st.data) setStudents(st.data as StudentRow[]);
    if (l.data) setLinks(l.data as LinkRow[]);
  }

  async function renameClass(classId: string, name: string) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("classes").update({ name }).eq("id", classId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setEditingClassId(null);
  }

  async function deleteClass(classId: string) {
    if (!confirm("Delete this class? Students and the teacher stay, just unassigned.")) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase.from("classes").delete().eq("id", classId);
    if (deleteErr) setError(deleteErr.message);
    else await refresh();
  }

  async function updateStaffRow(staffId: string, fields: { full_name: string; phone: string | null; class_id: string | null }) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("staff").update(fields).eq("id", staffId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setEditingStaffId(null);
  }

  async function removeStaff(staffRow: StaffRow) {
    if (!confirm(`Remove ${staffRow.full_name} as a teacher at this school? Their account stays, just unlinked.`)) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase.from("staff").delete().eq("id", staffRow.id);
    if (deleteErr) {
      setError(deleteErr.message);
      return;
    }
    await supabase
      .from("memberships")
      .delete()
      .eq("user_id", staffRow.user_id)
      .eq("school_id", schoolId)
      .eq("role", "teacher");
    await refresh();
  }

  async function updateGuardianRow(guardianId: string, fields: { full_name: string; phone: string | null; status: string }) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("guardians").update(fields).eq("id", guardianId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setEditingGuardianId(null);
  }

  async function removeGuardian(guardianRow: GuardianRow) {
    if (!confirm(`Remove ${guardianRow.full_name} as a guardian at this school? Their account stays, just unlinked, and their child links are removed.`)) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase.from("guardians").delete().eq("id", guardianRow.id);
    if (deleteErr) {
      setError(deleteErr.message);
      return;
    }
    await supabase
      .from("memberships")
      .delete()
      .eq("user_id", guardianRow.user_id)
      .eq("school_id", schoolId)
      .eq("role", "guardian");
    await refresh();
  }

  async function updateStudentRow(
    studentId: string,
    fields: { full_name: string; dob: string | null; class_id: string | null; status: string },
  ) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("students").update(fields).eq("id", studentId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setEditingStudentId(null);
  }

  async function deleteStudent(studentId: string, name: string) {
    if (!confirm(`Delete ${name}? This also removes their guardian links and chat threads.`)) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase.from("students").delete().eq("id", studentId);
    if (deleteErr) setError(deleteErr.message);
    else await refresh();
  }

  async function updateLinkRow(
    linkId: string,
    fields: { relationship: string | null; is_primary: boolean; pickup_authorized: boolean },
  ) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase.from("guardian_student_links").update(fields).eq("id", linkId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
    setEditingLinkId(null);
  }

  async function deleteLink(linkId: string) {
    if (!confirm("Remove this guardian's access to this child?")) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteErr } = await supabase.from("guardian_student_links").delete().eq("id", linkId);
    if (deleteErr) setError(deleteErr.message);
    else await refresh();
  }

  async function addClass(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string)?.trim();
    const formEl = e.currentTarget;
    const supabase = createClient();
    const { error: insertErr } = await supabase.from("classes").insert({ name, school_id: schoolId });
    if (insertErr) setError(insertErr.message);
    else {
      formEl.reset();
      await refresh();
    }
    setBusy(false);
  }

  async function assignClassTeacher(classId: string, teacherId: string) {
    setError(null);
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("classes")
      .update({ teacher_id: teacherId || null })
      .eq("id", classId);
    if (updateErr) setError(updateErr.message);
    else await refresh();
  }

  async function inviteMember(e: React.FormEvent<HTMLFormElement>, role: "teacher" | "guardian") {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = (form.get("email") as string)?.trim();
    const full_name = (form.get("full_name") as string)?.trim();
    const phone = (form.get("phone") as string)?.trim() || undefined;
    const class_id = (form.get("class_id") as string) || undefined;
    const formEl = e.currentTarget;

    const supabase = createClient();
    const { error: invokeError } = await supabase.functions.invoke("invite-member", {
      body: { role, email, full_name, phone, class_id },
    });
    if (invokeError) setError(await describeFunctionError(invokeError));
    else {
      formEl.reset();
      await refresh();
    }
    setBusy(false);
  }

  async function addStudent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const full_name = (form.get("full_name") as string)?.trim();
    const dob = (form.get("dob") as string) || null;
    const class_id = (form.get("class_id") as string) || null;
    const formEl = e.currentTarget;
    const supabase = createClient();
    const { error: insertErr } = await supabase.from("students").insert({ full_name, dob, class_id, school_id: schoolId });
    if (insertErr) setError(insertErr.message);
    else {
      formEl.reset();
      await refresh();
    }
    setBusy(false);
  }

  async function linkGuardian(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const guardian_id = form.get("guardian_id") as string;
    const student_id = form.get("student_id") as string;
    const relationship = (form.get("relationship") as string)?.trim() || null;
    const is_primary = form.get("is_primary") === "on";
    const formEl = e.currentTarget;
    const supabase = createClient();
    const { error: insertErr } = await supabase
      .from("guardian_student_links")
      .insert({ guardian_id, student_id, relationship, is_primary, pickup_authorized: true, school_id: schoolId });
    if (insertErr) setError(insertErr.message);
    else {
      formEl.reset();
      await refresh();
    }
    setBusy(false);
  }

  const classNameById = (id: string | null) => classes.find((c) => c.id === id)?.name ?? "—";
  const guardianNameById = (id: string) => guardians.find((g) => g.id === id)?.full_name ?? "—";
  const studentNameById = (id: string) => students.find((s) => s.id === id)?.full_name ?? "—";

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Classes">
          <ul className="mb-3 space-y-2">
            {classes.map((c) =>
              editingClassId === c.id ? (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    defaultValue={c.name}
                    autoFocus
                    className={inputClass}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameClass(c.id, e.currentTarget.value.trim());
                      if (e.key === "Escape") setEditingClassId(null);
                    }}
                    onBlur={(e) => renameClass(c.id, e.currentTarget.value.trim())}
                  />
                </li>
              ) : (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setEditingClassId(c.id)}
                    className="text-left text-slate-900 hover:underline"
                  >
                    {c.name}
                  </button>
                  <div className="flex items-center gap-2">
                    <select
                      value={c.teacher_id ?? ""}
                      onChange={(e) => assignClassTeacher(c.id, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => deleteClass(c.id)} className={smallDangerClass}>
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
            {classes.length === 0 && <li className="text-sm text-slate-500">No classes yet.</li>}
          </ul>
          <form onSubmit={addClass} className="flex gap-2">
            <input name="name" required placeholder="e.g. Sunrise Room" className={inputClass} />
            <button type="submit" disabled={busy} className={buttonClass}>
              Add
            </button>
          </form>
        </Section>

        <Section title="Teachers" hint="Sends a real email invite — they set their own password.">
          <ul className="mb-3 space-y-2">
            {staff.map((s) =>
              editingStaffId === s.id ? (
                <li key={s.id} className="space-y-1 rounded-md border border-slate-200 p-2">
                  <EditStaffForm
                    staffRow={s}
                    classes={classes}
                    onSave={(fields) => updateStaffRow(s.id, fields)}
                    onCancel={() => setEditingStaffId(null)}
                  />
                </li>
              ) : (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-900">
                    {s.full_name} <span className="text-slate-500">· {classNameById(s.class_id)}</span>
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => setEditingStaffId(s.id)} className={smallButtonClass}>
                      Edit
                    </button>
                    <button type="button" onClick={() => removeStaff(s)} className={smallDangerClass}>
                      Remove
                    </button>
                  </div>
                </li>
              ),
            )}
            {staff.length === 0 && <li className="text-sm text-slate-500">No teachers yet.</li>}
          </ul>
          <form onSubmit={(e) => inviteMember(e, "teacher")} className="space-y-2">
            <input name="full_name" required placeholder="Full name" className={inputClass} />
            <input name="email" type="email" required placeholder="Email" className={inputClass} />
            <input name="phone" placeholder="Phone (optional)" className={inputClass} />
            <select name="class_id" className={inputClass} defaultValue="">
              <option value="">No class assigned yet</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy} className={buttonClass}>
              Invite teacher
            </button>
          </form>
        </Section>

        <Section title="Guardians / parents" hint="Sends a real email invite — they set their own password.">
          <ul className="mb-3 space-y-2">
            {guardians.map((g) =>
              editingGuardianId === g.id ? (
                <li key={g.id} className="space-y-1 rounded-md border border-slate-200 p-2">
                  <EditGuardianForm
                    guardianRow={g}
                    onSave={(fields) => updateGuardianRow(g.id, fields)}
                    onCancel={() => setEditingGuardianId(null)}
                  />
                </li>
              ) : (
                <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-900">
                    {g.full_name} <span className="text-slate-500">· {g.status}</span>
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => setEditingGuardianId(g.id)} className={smallButtonClass}>
                      Edit
                    </button>
                    <button type="button" onClick={() => removeGuardian(g)} className={smallDangerClass}>
                      Remove
                    </button>
                  </div>
                </li>
              ),
            )}
            {guardians.length === 0 && <li className="text-sm text-slate-500">No guardians yet.</li>}
          </ul>
          <form onSubmit={(e) => inviteMember(e, "guardian")} className="space-y-2">
            <input name="full_name" required placeholder="Full name" className={inputClass} />
            <input name="email" type="email" required placeholder="Email" className={inputClass} />
            <input name="phone" placeholder="Phone (optional)" className={inputClass} />
            <button type="submit" disabled={busy} className={buttonClass}>
              Invite guardian
            </button>
          </form>
        </Section>

        <Section title="Students">
          <ul className="mb-3 space-y-2">
            {students.map((s) =>
              editingStudentId === s.id ? (
                <li key={s.id} className="space-y-1 rounded-md border border-slate-200 p-2">
                  <EditStudentForm
                    studentRow={s}
                    classes={classes}
                    onSave={(fields) => updateStudentRow(s.id, fields)}
                    onCancel={() => setEditingStudentId(null)}
                  />
                </li>
              ) : (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-900">
                    {photoUrls[s.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrls[s.id]} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">
                        —
                      </span>
                    )}
                    {s.full_name} <span className="text-slate-500">· {classNameById(s.class_id)}</span>
                    {s.status === "inactive" && <span className="text-slate-400"> · inactive</span>}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => triggerPhotoUpload(s.id)}
                      disabled={uploadingPhotoFor === s.id}
                      className={smallButtonClass}
                    >
                      {uploadingPhotoFor === s.id ? "Uploading…" : "Photo"}
                    </button>
                    <button type="button" onClick={() => setEditingStudentId(s.id)} className={smallButtonClass}>
                      Edit
                    </button>
                    <button type="button" onClick={() => deleteStudent(s.id, s.full_name)} className={smallDangerClass}>
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
            {students.length === 0 && <li className="text-sm text-slate-500">No students yet.</li>}
          </ul>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoSelected}
            className="hidden"
          />
          <form onSubmit={addStudent} className="space-y-2">
            <input name="full_name" required placeholder="Full name" className={inputClass} />
            <input name="dob" type="date" className={inputClass} />
            <select name="class_id" className={inputClass} defaultValue="">
              <option value="">No class assigned yet</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy} className={buttonClass}>
              Add student
            </button>
          </form>
        </Section>
      </div>

      <Section
        title="Guardian ↔ student links"
        hint="Who's allowed to generate pickup/drop-off codes for which child. A student can have more than one guardian."
      >
        <ul className="mb-3 space-y-2">
          {links.map((l) =>
            editingLinkId === l.id ? (
              <li key={l.id} className="rounded-md border border-slate-200 p-2">
                <EditLinkForm link={l} onSave={(fields) => updateLinkRow(l.id, fields)} onCancel={() => setEditingLinkId(null)} />
              </li>
            ) : (
              <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-900">
                  {guardianNameById(l.guardian_id)} → {studentNameById(l.student_id)}
                  <span className="text-slate-500">
                    {" "}
                    · {l.relationship ?? "guardian"}
                    {l.is_primary ? " · primary" : ""}
                    {!l.pickup_authorized ? " · not authorized" : ""}
                  </span>
                </span>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => setEditingLinkId(l.id)} className={smallButtonClass}>
                    Edit
                  </button>
                  <button type="button" onClick={() => deleteLink(l.id)} className={smallDangerClass}>
                    Remove
                  </button>
                </div>
              </li>
            ),
          )}
          {links.length === 0 && <li className="text-sm text-slate-500">No links yet.</li>}
        </ul>
        <form onSubmit={linkGuardian} className="flex flex-wrap items-center gap-2">
          <select name="guardian_id" required className={inputClass + " w-auto"}>
            <option value="">Guardian…</option>
            {guardians.map((g) => (
              <option key={g.id} value={g.id}>
                {g.full_name}
              </option>
            ))}
          </select>
          <select name="student_id" required className={inputClass + " w-auto"}>
            <option value="">Student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          <input name="relationship" placeholder="Relationship (e.g. mother)" className={inputClass + " w-auto"} />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" name="is_primary" /> Primary
          </label>
          <button type="submit" disabled={busy} className={buttonClass}>
            Link
          </button>
        </form>
      </Section>
    </div>
  );
}

function EditStaffForm({
  staffRow,
  classes,
  onSave,
  onCancel,
}: {
  staffRow: StaffRow;
  classes: ClassRow[];
  onSave: (fields: { full_name: string; phone: string | null; class_id: string | null }) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(staffRow.full_name);
  const [phone, setPhone] = useState(staffRow.phone ?? "");
  const [classId, setClassId] = useState(staffRow.class_id ?? "");

  return (
    <>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={inputClass} />
      <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
        <option value="">No class assigned</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave({ full_name: fullName.trim(), phone: phone.trim() || null, class_id: classId || null })}
          className={buttonClass}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditGuardianForm({
  guardianRow,
  onSave,
  onCancel,
}: {
  guardianRow: GuardianRow;
  onSave: (fields: { full_name: string; phone: string | null; status: string }) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(guardianRow.full_name);
  const [phone, setPhone] = useState(guardianRow.phone ?? "");
  const [status, setStatus] = useState(guardianRow.status);

  return (
    <>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className={inputClass} />
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
        <option value="active">Active</option>
        <option value="pending">Pending</option>
        <option value="suspended">Suspended</option>
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave({ full_name: fullName.trim(), phone: phone.trim() || null, status })}
          className={buttonClass}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditStudentForm({
  studentRow,
  classes,
  onSave,
  onCancel,
}: {
  studentRow: StudentRow;
  classes: ClassRow[];
  onSave: (fields: { full_name: string; dob: string | null; class_id: string | null; status: string }) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(studentRow.full_name);
  const [dob, setDob] = useState(studentRow.dob ?? "");
  const [classId, setClassId] = useState(studentRow.class_id ?? "");
  const [status, setStatus] = useState(studentRow.status);

  return (
    <>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
      <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
        <option value="">No class assigned</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave({ full_name: fullName.trim(), dob: dob || null, class_id: classId || null, status })}
          className={buttonClass}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </>
  );
}

function EditLinkForm({
  link,
  onSave,
  onCancel,
}: {
  link: LinkRow;
  onSave: (fields: { relationship: string | null; is_primary: boolean; pickup_authorized: boolean }) => void;
  onCancel: () => void;
}) {
  const [relationship, setRelationship] = useState(link.relationship ?? "");
  const [isPrimary, setIsPrimary] = useState(link.is_primary);
  const [pickupAuthorized, setPickupAuthorized] = useState(link.pickup_authorized);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
        placeholder="Relationship"
        className={inputClass + " w-auto"}
      />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" checked={pickupAuthorized} onChange={(e) => setPickupAuthorized(e.target.checked)} /> Pickup
        authorized
      </label>
      <button
        type="button"
        onClick={() => onSave({ relationship: relationship.trim() || null, is_primary: isPrimary, pickup_authorized: pickupAuthorized })}
        className={buttonClass}
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className={smallButtonClass}>
        Cancel
      </button>
    </div>
  );
}
