import { API_BASE_URL } from "./config";
import { refreshSession, resumeAnonymousSession } from "./auth";
import { getSession, clearSession, type Session } from "./session";

/** A structured API failure carrying the HTTP status and the server error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function request(path: string, init: RequestInit, session: Session): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${session.accessJwt}`,
  };
  // Only set JSON content-type when there's a body — a bodyless request with
  // content-type: application/json trips Fastify's empty-body parser.
  if (init.body != null) headers["Content-Type"] = "application/json";
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

/**
 * Calls a protected endpoint with the current session. On 401 it refreshes and
 * retries once; if the refresh fails it resumes the anonymous account from the stored
 * device key, and only if that also fails does it clear the session and require
 * re-authentication. Returns parsed JSON, or undefined for 204. Throws {@link ApiError}
 * on a non-2xx response.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "NO_SESSION", "sign in required");
  let res = await request(path, init, session);

  if (res.status === 401) {
    const restored = await refreshSession(session)
      .catch(() => resumeAnonymousSession())
      .catch(async () => {
        await clearSession();
        throw new ApiError(401, "REAUTH_REQUIRED", "session expired, sign in again");
      });
    res = await request(path, init, restored);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(res.status, code, body?.error?.message ?? res.statusText);
  }
  return body as T;
}
