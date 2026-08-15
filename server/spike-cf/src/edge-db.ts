import { createClient } from '@libsql/client/web';
import { ImportStore } from './db.js';

/** libSQL connection env — a local `turso dev` HTTP URL in dev, a Turso cloud URL
 * + auth token in prod. Injected via `.dev.vars` locally, `wrangler secret` in prod. */
export interface DbEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN?: string;
}

/**
 * Build an ImportStore for the Workers runtime. Uses `@libsql/client/web` — the
 * HTTP-only, Node-free build Workers requires (the `file:` node build does not
 * run on workerd). The client is per-invocation; there is no long-lived pool.
 */
export function storeFromEnv(env: DbEnv): ImportStore {
  return ImportStore.of(createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN }));
}
