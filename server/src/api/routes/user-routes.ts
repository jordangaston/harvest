import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { UserService } from '../../services/user-service.js';
import { createUserBody, signInBody } from '../schemas.js';

/**
 * Registers the user endpoints:
 * - `POST /v1/users` — verify OTP + provision, returns
 *   `{ user, auth, isNew }`.
 * - `POST /v1/users/sign_in` — resolve by OTP or refresh token, same shape.
 * - `GET /v1/users/me` — behind authGuard, returns `{ user: { id, phone } }`.
 */
export function registerUserRoutes(
  app: FastifyInstance,
  userService: UserService,
  authGuard: preHandlerAsyncHookHandler,
): void {
  app.post('/v1/users', async (request, reply) => {
    const { user } = createUserBody.parse(request.body);
    const result = await userService.verifyAndResolve(
      user.phone_number,
      user.code,
      user.onboarding,
    );
    return reply.code(200).send(result);
  });

  app.post('/v1/users/sign_in', async (request, reply) => {
    const { auth } = signInBody.parse(request.body);
    const result = await userService.signIn({
      otp: auth.otp
        ? { phoneNumber: auth.otp.phone_number, code: auth.otp.code }
        : undefined,
      refreshToken: auth.refresh_token,
    });
    return reply.code(200).send(result);
  });

  app.get('/v1/users/me', { preHandler: [authGuard] }, async (request, reply) => {
    const result = await userService.getMe(request.authUserId);
    return reply.code(200).send(result);
  });
}
