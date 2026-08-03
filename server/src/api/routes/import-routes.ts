import type { FastifyInstance } from 'fastify';
import { ImportService } from '../../services/import-service.js';
import { authGuard } from '../middleware/auth-guard.js';
import { createImportSchema } from '../schemas.js';

/**
 * Import intake + polling routes (auth-guarded, owner-scoped):
 * - POST /v1/imports → 202 {job} (queued; the DBOS workflow drives it onward)
 * - GET  /v1/imports/:id → 200 {job} | 404
 */
export function registerImportRoutes(app: FastifyInstance): void {
  const imports = ImportService.create();

  app.post('/v1/imports', { preHandler: authGuard }, async (request, reply) => {
    const { source } = createImportSchema.parse(request.body);
    const job = await imports.create(request.authUserId!, {
      url: source.url,
      sharePayload: source.share_payload,
      imageRef: source.image_ref,
    });
    reply.code(202);
    return { job };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/imports/:id',
    { preHandler: authGuard },
    async (request) => {
      const job = await imports.get(request.authUserId!, request.params.id);
      return { job };
    },
  );
}
