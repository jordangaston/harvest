import { API_BASE_URL } from "./config";
import { setSession, type Session } from "./session";
import { getDeviceKey, setDeviceKey } from "./deviceKey";
import { buildUserPayload, buildPreferences, resetOnboarding } from "../onboarding";
import { updatePreferences } from "./preferences";
import { queryClient } from "../queryClient";
import { queryKeys } from "../queryKeys";
import { analytics } from "../analytics";

type SessionResponse = {
  user: { id: string; phone: string | null; name: string | null };
  auth: { access_token: { jwt: string }; refresh_token: { jwt: string } };
  isNew?: boolean;
  // Present only on the anonymous-signup response: the key to persist for resume.
  device_key?: string | null;
};

async function postSession(path: string, body: unknown): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => undefined);
    throw new Error(err?.error?.code ?? `${path} failed: ${res.status}`);
  }
  return res.json();
}

function toSession(response: SessionResponse, phone: string | null): Session {
  return {
    accessJwt: response.auth.access_token.jwt,
    refreshJwt: response.auth.refresh_token.jwt,
    userId: response.user.id,
    phone,
  };
}

/** Persists a new session and drops any prior account's cached data (shared device). */
async function establish(response: SessionResponse, phone: string | null): Promise<Session> {
  const session = toSession(response, phone);
  await setSession(session);
  await queryClient.clear();
  return session;
}

/**
 * Creates (or resumes, via the stored device key) an anonymous account — no phone —
 * persisting the onboarding draft's goals + cook-days, and establishes its session.
 * The server returns a device key to persist so a reinstall resolves the same account.
 * Idempotent on retry: once the key is stored, a re-run resolves the same user.
 */
export async function createAnonymousUser(): Promise<Session> {
  const deviceKey = await getDeviceKey();
  const { goals, cook_days_count } = buildUserPayload();
  const onboarding = cook_days_count == null ? { goals } : { goals, cook_days_count };
  const response = await postSession("/v1/users/anonymous", {
    device_key: deviceKey ?? undefined,
    onboarding,
  });
  if (response.device_key) await setDeviceKey(response.device_key);
  const session = await establish(response, response.user.phone);
  // Identify + "Signup Completed" fire once, on the account's first creation.
  if (response.isNew) analytics.onSignup(session.userId, onboarding);
  return session;
}

/** Sends an SMS verification code to the phone. Throws on a provider failure. */
export async function sendOtp(phone: string): Promise<void> {
  await postSession("/v1/otps", { otp: { phone_number: phone } });
}

/**
 * Persists the onboarding preference draft to the authed account. Kept separate from
 * account creation so a failed preference write surfaces a retry without re-creating
 * the user (the session already exists). Clears the draft + reseeds caches on success.
 */
export async function flushOnboarding(): Promise<void> {
  await updatePreferences(buildPreferences());
  // The deck must re-rank against the just-saved preferences on first open.
  queryClient.setQueryData(queryKeys.preferences, undefined);
  await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
  await queryClient.invalidateQueries({ queryKey: queryKeys.deck });
  resetOnboarding();
}

/**
 * Re-establishes an anonymous session from the stored device key — the fallback when
 * a token refresh fails (an anon user has no phone to re-verify with). Throws if there
 * is no device key to resume from, so the caller falls through to re-authentication.
 */
export async function resumeAnonymousSession(): Promise<Session> {
  const deviceKey = await getDeviceKey();
  if (!deviceKey) throw new Error("NO_DEVICE_KEY");
  const response = await postSession("/v1/users/anonymous", { device_key: deviceKey });
  if (response.device_key) await setDeviceKey(response.device_key);
  return establish(response, response.user.phone);
}

/** Signs a returning user in by verified OTP and persists the session. */
export async function signIn(phone: string, code: string): Promise<Session> {
  const body = { auth: { otp: { phone_number: phone, code } } };
  return establish(await postSession("/v1/users/sign_in", body), phone);
}

/** Exchanges the refresh token for a new pair and persists it. */
export async function refreshSession(current: Session): Promise<Session> {
  const response = await postSession("/v1/users/sign_in", { auth: { refresh_token: current.refreshJwt } });
  const session = toSession(response, current.phone);
  await setSession(session);
  return session;
}
