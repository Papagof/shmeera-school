import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// Registers this device for push notifications with the backend
// (SPEC.md §9, build order step 8). Best-effort: a user who denies
// permission, isn't on a physical device, or has no EAS project configured
// simply won't get push — never blocks the app.
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators/emulators can't receive push

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
    await supabase.functions.invoke("register-push-token", {
      body: { expo_push_token: data, platform },
    });
  } catch (err) {
    // Missing EAS project ID, no push capability on this platform, etc. —
    // never fail app usage over notification registration.
    console.warn("[push] registration skipped:", err);
  }
}
