import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserService } from '../../services/user-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUserId?: string;
  }
}

const users = UserService.create();

/**
 * Fastify preHandler: authenticates the bearer access token and stamps `request.authUserId`.
 * A missing or invalid token short-circuits with a 401 and the request never reaches the handler.
 * @param request - incoming request; its Authorization header supplies the token.
 * @param reply - used to send the 401 on failure.
 */
export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(request.headers.authorization);
  const userId = token && (await users.authenticateAccessToken(token));
  if (!userId) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } });
    return;
  }
  request.authUserId = userId;
}

/**
 * Extracts the token from an `Authorization: Bearer <token>` header.
 * @param header - the raw header value, or undefined when absent.
 * @returns the token, or null if the scheme isn't `Bearer` or the token is empty.
 */
function bearer(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}
