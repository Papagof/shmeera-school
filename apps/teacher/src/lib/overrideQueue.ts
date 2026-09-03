import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

// Offline fallback (SPEC.md §6.13): "allows manual override ... flagged for
// admin review on resync." If the device genuinely has no connectivity when
// a manual override is submitted, it's queued here (photo included, as
// base64, since there's no network to upload it yet) and flushed the next
// time the app can reach Supabase — on every RosterScreen mount, which is
// the natural "back online" moment (a teacher reopening/refocusing the app).
const QUEUE_KEY = "shmeera:pending_overrides";

export interface QueuedOverride {
  local_id: string;
  student_id: string;
  type: "dropoff" | "pickup";
  released_to_name: string;
  note: string;
  photo_base64: string;
  school_id: string;
  queued_at: string;
}

async function readQueue(): Promise<QueuedOverride[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOverride[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedOverride[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // Best-effort.
  }
}

export async function enqueueOverride(item: QueuedOverride): Promise<void> {
  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
}

export async function getQueueSize(): Promise<number> {
  return (await readQueue()).length;
}

// Uploads the queued photo, then submits the release. One failure doesn't
// block the rest of the queue — each item is independent.
async function submitOne(item: QueuedOverride): Promise<boolean> {
  const path = `schools/${item.school_id}/overrides/${item.queued_at.replace(/[^0-9]/g, "")}-${item.local_id}.jpg`;
  const bytes = Uint8Array.from(atob(item.photo_base64), (c) => c.charCodeAt(0));
  const { error: uploadErr } = await supabase.storage.from("shmeera").upload(path, bytes, { contentType: "image/jpeg" });
  if (uploadErr) return false;

  const { error: invokeErr } = await supabase.functions.invoke("manual-override-release", {
    body: {
      student_id: item.student_id,
      type: item.type,
      released_to_name: item.released_to_name,
      note: item.note,
      photo_path: path,
    },
  });
  return !invokeErr;
}

export async function flushOverrideQueue(): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const stillPending: QueuedOverride[] = [];
  let flushed = 0;
  for (const item of queue) {
    const ok = await submitOne(item);
    if (ok) flushed += 1;
    else stillPending.push(item);
  }
  await writeQueue(stillPending);
  return { flushed, remaining: stillPending.length };
}
