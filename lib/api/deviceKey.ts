import * as SecureStore from "expo-secure-store";

const KEY = "harvest.device_key";

/**
 * The anonymous device key (server-generated at first signup) persisted to the
 * keychain, or null before there is one. It survives reinstalls on the same
 * device, so the server resolves the same anonymous account on the next launch.
 */
export async function getDeviceKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setDeviceKey(deviceKey: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, deviceKey);
}
