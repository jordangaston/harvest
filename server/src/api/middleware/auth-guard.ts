import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserService } from '../../services/user-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUserId?: string;
  }
}

const users = UserService.create();

// preHandler: authenticates the bearer access token and stamps request.authUserId.
// A missing or invalid token is a 401.
export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(request.headers.authorization);
  const userId = token && (await users.authenticateAccessToken(token));
  if (!userId) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'authentication required' } });
    return;
  }
  request.authUserId = userId;
}

function bearer(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}
