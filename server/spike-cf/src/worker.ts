import { Hono } from 'hono';
import { z } from 'zod';
import { storeFromEnv } from './edge-db.js';
import { classifySource } from './classify.js';
import { startImport } from './queue-consumer.js';
import type { Env } from './import-workflow.js';
import type { ImportInput } from './domain.js';

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
  const id = await storeFromEnv(c.env).createUser(body.data.phone);
  return c.json({ user: { id } }, 201);
});

/** Import intake (F-03). Classify → write `queued` → ENQUEUE → return 202. The
 * Workflow is not started here; the queue consumer starts it (below), so intake
 * stays a fast async hand-off. */
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

  const jobId = crypto.randomUUID();
  await storeFromEnv(c.env).createJob({ id: jobId, userId: body.data.userId, ...classified });
  // Enqueue the import; the consumer starts the durable Workflow (id = jobId, so
  // a redelivery is idempotent). Message body is the Workflow's params.
  const message: ImportInput = { jobId, userId: body.data.userId, ...classified, faultStep: body.data.faultStep };
  await c.env.IMPORT_QUEUE.send(message);
  return c.json({ job: { id: jobId, status: 'queued' } }, 202);
});

/** Import polling (F-06) — the job's public projection straight from D1. */
app.get('/v1/imports/:id', async (c) => {
  const job = await storeFromEnv(c.env).getJob(c.req.param('id'));
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

/**
 * Queue consumer — drains the import queue and starts the durable Workflow per
 * message. Ack on a successful (or idempotent no-op) start; on a transient
 * failure, retry the message so the queue redelivers (up to `max_retries`, then
 * the dead-letter queue). This is the HTTP-intake → Queue → **consumer** →
 * Workflow → steps hop.
 */
async function queue(batch: MessageBatch<ImportInput>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      console.log(`[queue] start job=${message.body.jobId} attempt=${message.attempts}`);
      await startImport(env, message.body);
      message.ack();
    } catch (err) {
      console.error(`[queue] start failed job=${message.body.jobId}: ${err}`);
      message.retry();
    }
  }
}

export { ImportWorkflow } from './import-workflow.js';
export default { fetch: app.fetch, queue } satisfies ExportedHandler<Env, ImportInput>;
