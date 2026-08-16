import type { Context, Next } from "hono";
import { UserService } from "./services/user-service.js";

/**
 * Hono middleware: authenticates the bearer access token and stamps
 * `c.set('authUserId', id)`. A missing or invalid token short-circuits with a
 * 401 and the request never reaches the handler.
 *
 * @param users - The UserService that verifies the token against its owner.
 */
export function authGuard(users: UserService) {
  return async (c: Context, next: Next) => {
    const token = bearer(c.req.header("authorization"));
    const userId = token && (await users.authenticateAccessToken(token));
    if (!userId) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "authentication required" } }, 401);
    }
    c.set("authUserId", userId);
    return next();
  };
}

/**
 * Extracts the token from an `Authorization: Bearer <token>` header.
 * @param header - the raw header value, or undefined when absent.
 * @returns the token, or null if the scheme isn't `Bearer` or the token is empty.
 */
function bearer(header: string | undefined): string | null {
  const [scheme, token] = header?.split(" ") ?? [];
  return scheme === "Bearer" && token ? token : null;
}
