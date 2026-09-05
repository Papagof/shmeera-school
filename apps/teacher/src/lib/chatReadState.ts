import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "chat_last_read:";

export async function getLastRead(threadId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + threadId);
  } catch {
    return null;
  }
}

export async function setLastRead(threadId: string, at: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + threadId, at);
  } catch {
    // Best-effort — an unread badge that occasionally over-shows is fine,
    // this is a UX nicety, not the message store itself.
  }
}
