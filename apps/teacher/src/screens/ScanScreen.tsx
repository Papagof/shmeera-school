import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { describeFunctionError } from "@shmeera/shared";
import { supabase } from "../lib/supabase";
import type { ValidationResult } from "./ResultScreen";

// Mandatory geolocation capture at scan-time (SPEC.md §6.7) — this is a
// required control, not opt-in. If a fresh fix can't be obtained, this
// screen refuses to submit through the normal flow; the offline
// manual-override path (SPEC.md §6.13, flagged for admin review on resync)
// is the sanctioned way around it — see OverrideScreen.
async function getFreshLocation(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  } catch {
    return null;
  }
}

export function ScanScreen({ onResult, onOpenOverride }: { onResult: (result: ValidationResult) => void; onOpenOverride: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(true);
  const [validating, setValidating] = useState(false);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const lastScanned = useRef<string | null>(null);

  async function validate(body: { code?: string; qr_payload?: string }) {
    setValidating(true);
    setLocationWarning(null);

    const geo = await getFreshLocation();
    if (!geo) {
      setLocationWarning(
        "A fresh device location is required to validate a code. Enable location and try again, or use manual override below.",
      );
      setValidating(false);
      lastScanned.current = null;
      return;
    }

    const { data, error } = await supabase.functions.invoke("validate-event-code", {
      body: { ...body, geo, device_info: { platform: "expo" } },
    });

    setValidating(false);
    if (error) {
      onResult({ ok: false, message: await describeFunctionError(error) });
    } else {
      onResult({ ok: true, ...data });
    }
  }

  function handleBarcodeScanned({ data }: { data: string }) {
    if (!scanning || validating || lastScanned.current === data) return;
    lastScanned.current = data;
    setScanning(false);
    validate({ qr_payload: data }).finally(() => {
      setScanning(true);
      lastScanned.current = null;
    });
  }

  // The camera is one way in, not a gate on the whole screen — a teacher
  // without camera access (denied permission, no camera, or a headless/web
  // context) must still be able to validate via manual code entry below.
  let cameraArea: React.ReactNode;
  if (!permission) {
    cameraArea = <View style={{ flex: 1 }} />;
  } else if (!permission.granted) {
    cameraArea = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <Text>Camera access is needed to scan drop-off/pickup codes.</Text>
        <Pressable onPress={requestPermission} style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 12 }}>
          <Text style={{ color: "#fff" }}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  } else {
    cameraArea = (
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {cameraArea}

      <View style={{ padding: 16, gap: 8, backgroundColor: "#fff" }}>
        {locationWarning && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: "#dc2626", fontSize: 13 }}>{locationWarning}</Text>
            <Pressable
              onPress={onOpenOverride}
              style={{ borderWidth: 1, borderColor: "#dc2626", borderRadius: 8, padding: 8, alignItems: "center" }}
            >
              <Text style={{ color: "#dc2626", fontWeight: "600", fontSize: 13 }}>Manual override release</Text>
            </Pressable>
          </View>
        )}
        <Text style={{ color: "#64748b", fontSize: 13 }}>Or enter the 6-digit code manually:</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={manualCode}
            onChangeText={setManualCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
            style={{ flex: 1, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12, fontSize: 18, letterSpacing: 4 }}
          />
          <Pressable
            disabled={validating || manualCode.length !== 6}
            onPress={() => validate({ code: manualCode })}
            style={{ backgroundColor: "#0f172a", borderRadius: 8, padding: 12, justifyContent: "center", opacity: manualCode.length !== 6 ? 0.4 : 1 }}
          >
            {validating ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff" }}>Validate</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
