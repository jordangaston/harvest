import { Hono } from 'hono';
import { z } from 'zod';
import { ImportStore } from './db.js';
import { classifySource } from './classify.js';
import type { Env } from './import-workflow.js';

/**
 * The Harvest HTTP API, ported from Fastify (server/src/api) to a Cloudflare
 * Worker on Hono. Same routes, same Zod validation, no long-lived process — the
 * isolate handles a request and stops. Intake writes a `queued` job then triggers
 * the durable Workflow (id = jobId, so run and row share one identifier and a
 * re-trigger is idempotent). Polling reads the job straight from D1.
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));

/** Minimal user creation — the import's owner. (Auth/JWT is unchanged from
 * server/src/services/auth-service.ts and out of scope for this slice.) */
const CreateUser = z.object({ phone: z.string().min(1) });
app.post('/v1/users', async (c) => {
  const body = CreateUser.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
  const id = await ImportStore.of(c.env.DB).createUser(body.data.phone);
  return c.json({ user: { id } }, 201);
});

/** Import intake (F-03). Classify → write `queued` → trigger the Workflow. */
const CreateImport = z.object({
  userId: z.string().min(1),
  source: z.object({ url: z.string().url() }),
  // Proof-only: ask the workflow to inject one transient fault (recovery demo).
  faultStep: z.literal('extract').optional(),
});
app.post('/v1/imports', async (c) => {
  const body = CreateImport.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);

  const classified = classifySource(body.data.source.url);
  if (!classified) return c.json({ error: 'unsupported_source' }, 422);

  const store = ImportStore.of(c.env.DB);
  const jobId = crypto.randomUUID();
  await store.createJob({ id: jobId, userId: body.data.userId, ...classified });
  await c.env.IMPORT_WORKFLOW.create({
    id: jobId,
    params: { jobId, userId: body.data.userId, ...classified, faultStep: body.data.faultStep },
  });
  return c.json({ job: { id: jobId, status: 'queued' } }, 202);
});

/** Import polling (F-06) — the job's public projection straight from D1. */
app.get('/v1/imports/:id', async (c) => {
  const job = await ImportStore.of(c.env.DB).getJob(c.req.param('id'));
  if (!job) return c.json({ error: 'not_found' }, 404);
  return c.json({
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      recipe_id: job.recipeId,
      error_code: job.errorCode,
      fault_attempts: job.faultAttempts,
    },
  });
});

export { ImportWorkflow } from './import-workflow.js';
export default app;
