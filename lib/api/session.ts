import * as SecureStore from "expo-secure-store";

const KEY = "harvest.session";

/** The persisted session: the token JWT strings plus the user's id and phone
 * (null for an anonymous user who hasn't linked one). */
export type Session = {
  accessJwt: string;
  refreshJwt: string;
  userId: string;
  phone: string | null;
};

export async function getSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function setSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
