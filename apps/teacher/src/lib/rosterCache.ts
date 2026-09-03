import AsyncStorage from "@react-native-async-storage/async-storage";

// Offline fallback (SPEC.md §6.13): "the teacher app caches the
// last-synced roster." Cached alongside the fetch RosterScreen already does
// for the normal (online) case — this is just persistence on top, read back
// only when that fetch fails.
const ROSTER_CACHE_KEY = "shmeera:cached_roster";

export interface CachedStudent {
  id: string;
  full_name: string;
  class_id: string | null;
}

export async function cacheRoster(students: CachedStudent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(students));
  } catch {
    // Best-effort — a caching failure should never block the roster screen.
  }
}

export async function getCachedRoster(): Promise<CachedStudent[]> {
  try {
    const raw = await AsyncStorage.getItem(ROSTER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedStudent[]) : [];
  } catch {
    return [];
  }
}

// A manual override needs school_id to build its storage upload path even
// when fully offline — resolving it via a live `memberships` query (as the
// rest of this app does) would defeat the entire point of the offline path,
// since that query itself requires network. Cached alongside the roster
// during the same successful online fetch, so OverrideScreen never needs a
// network round trip just to know which school it's in.
const SCHOOL_ID_CACHE_KEY = "shmeera:cached_school_id";

export async function cacheSchoolId(schoolId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SCHOOL_ID_CACHE_KEY, schoolId);
  } catch {
    // Best-effort.
  }
}

export async function getCachedSchoolId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SCHOOL_ID_CACHE_KEY);
  } catch {
    return null;
  }
}
