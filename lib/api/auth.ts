import { API_BASE_URL } from "./config";
import { setSession, type Session } from "./session";
import { buildUserPayload, buildPreferences, resetOnboarding } from "../onboarding";
import { updatePreferences } from "./preferences";
import { queryClient } from "../queryClient";
import { queryKeys } from "../queryKeys";
import { analytics } from "../analytics";

type SessionResponse = {
  user: { id: string; phone: string; name: string | null };
  auth: { access_token: { jwt: string }; refresh_token: { jwt: string } };
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

function toSession(response: SessionResponse, phone: string): Session {
  return {
    accessJwt: response.auth.access_token.jwt,
    refreshJwt: response.auth.refresh_token.jwt,
    userId: response.user.id,
    phone,
  };
}

/** Persists a new session and drops any prior account's cached data (shared device). */
async function establish(response: SessionResponse, phone: string): Promise<Session> {
  const session = toSession(response, phone);
  await setSession(session);
  await queryClient.clear();
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
 * Creates the account for a verified phone (the server verifies `code` once) with the
 * collected goals + cook days (stamping onboardingCompletedAt), then persists the session.
 * The preference draft is flushed separately (flushOnboarding) so its failure surfaces a
 * retry without re-creating the user — the caller runs the flush after this resolves.
 */
export async function createUser(phone: string, code: string): Promise<Session> {
  const onboarding = buildUserPayload();
  const user = { phone_number: phone, code, onboarding };
  const session = await establish(await postSession("/v1/users", { user }), phone);
  // This is a real signup (not an anonymous first-launch / 401-refresh re-provision),
  // so identify + "Signup Completed" fire only here.
  analytics.onSignup(session.userId, onboarding);
  return session;
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
