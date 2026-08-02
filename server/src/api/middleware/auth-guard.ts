import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import type { AuthService } from '../../services/auth-service.js';
import type { UserRepository } from '../../repositories/user-repository.js';
import { UnauthorizedError } from '../../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated user's uuid, set by authGuard on protected routes. */
    authUserId: string;
  }
}

export interface AuthGuardDeps {
  authService: AuthService;
  userRepo: UserRepository;
}

/**
 * Builds a Fastify preHandler that authenticates the Bearer access token and
 * sets `request.authUserId`. It rejects (401) a missing/malformed header, an
 * unknown user, an invalid/expired signature, a non-access token type, or a
 * stale access nonce — throwing before the route handler runs (AC-8). Throwing
 * routes to setErrorHandler, so no handler body executes.
 */
export function makeAuthGuard(deps: AuthGuardDeps): preHandlerAsyncHookHandler {
  const { authService, userRepo } = deps;

  return async function authGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const token = header.slice('Bearer '.length);

    const decoded = authService.decodeToken(token);
    if (!decoded?.sub) throw new UnauthorizedError('Invalid token');

    const user = await userRepo.findById(decoded.sub);
    if (!user) throw new UnauthorizedError('User not found');

    let payload;
    try {
      payload = authService.verifyToken(token, user.jwtPublicKey);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    if (payload.type !== 'access') throw new UnauthorizedError('Wrong token type');
    if (payload.nonce !== user.accessTokenNonce) throw new UnauthorizedError('Token revoked');

    request.authUserId = user.id;
  };
}
