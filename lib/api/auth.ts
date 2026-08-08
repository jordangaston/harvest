import { API_BASE_URL } from "./config";
import { setSession, type Session } from "./session";
import { getOnboarding, resetOnboarding } from "../onboarding";
import { queryClient } from "../queryClient";

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
 * Creates the account for a verified phone (the server verifies `code` once) with
 * the collected name + onboarding, then persists the session. Signup only.
 */
export async function createUser(phone: string, code: string): Promise<Session> {
  const { name, ...onboarding } = getOnboarding() ?? {};
  const user = { phone_number: phone, code, name, onboarding };
  const session = await establish(await postSession("/v1/users", { user }), phone);
  resetOnboarding();
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
