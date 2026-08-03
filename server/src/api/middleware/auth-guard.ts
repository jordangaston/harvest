import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserRepository } from '../../repositories/user-repository.js';
import { AuthService } from '../../services/auth-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUserId?: string;
  }
}

const repo = UserRepository.create();
const authService = AuthService.create();

// preHandler: verifies the bearer access token against the user's own public
// key and current nonce, then stamps request.authUserId. Any failure is a 401.
export async function authGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(request.headers.authorization);
  const userId = token && (await authenticate(token));
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

async function authenticate(token: string): Promise<string | null> {
  try {
    const sub = authService.decodeSub(token);
    const user = sub && (await repo.findById(sub));
    if (!user) return null;
    const { nonce } = authService.verify(token, user.jwtPublicKey, 'access');
    return nonce === user.accessTokenNonce ? user.id : null;
  } catch {
    return null;
  }
}
