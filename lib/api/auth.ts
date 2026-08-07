import { API_BASE_URL } from "./config";
import { getSession, setSession, type Session } from "./session";

// The server needs a *possible* E.164 number (libphonenumber `isPossible`). The
// 555-555-01xx style parses as possible and is verified against the live server.
// createUser resolves an existing user by phone, so a rare collision just merges
// onto the same account — harmless.
function generatePhone(): string {
  const last4 = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `+1555555${last4}`;
}

type SessionResponse = {
  user: { id: string; phone: string };
  auth: { access_token: { jwt: string }; refresh_token: { jwt: string } };
};

async function postSession(path: string, body: unknown): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
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

/** Creates a fresh user with a generated phone and persists the session. */
export async function provisionUser(): Promise<Session> {
  const phone = generatePhone();
  const session = toSession(await postSession("/v1/users", { user: { phone_number: phone } }), phone);
  await setSession(session);
  return session;
}

/** Exchanges the refresh token for a new pair and persists it. */
export async function refreshSession(current: Session): Promise<Session> {
  const session = toSession(
    await postSession("/v1/users/sign_in", { auth: { refresh_token: current.refreshJwt } }),
    current.phone,
  );
  await setSession(session);
  return session;
}

/** Returns the stored session, provisioning a new user on first launch. */
export async function ensureSession(): Promise<Session> {
  return (await getSession()) ?? provisionUser();
}
