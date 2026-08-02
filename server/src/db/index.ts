import { Pool as PgPool } from 'pg';
import {
  Pool as NeonPool,
  neonConfig,
  type PoolConfig as NeonPoolConfig,
} from '@neondatabase/serverless';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema/index.js';

export type Schema = typeof schema;

/**
 * A Drizzle client backed by either the local node-postgres driver (tests /
 * local dev) or the Neon serverless WebSocket driver (staging / prod). Both
 * expose interactive transactions, which the DBOS Drizzle data source needs
 * (the neon-http driver does not and is deliberately avoided).
 */
export type Database = NodePgDatabase<Schema> | NeonDatabase<Schema>;

export interface Db {
  db: Database;
  pool: PgPool | NeonPool;
  close: () => Promise<void>;
}

/**
 * Chooses the Neon serverless driver for remote (Neon) URLs and the local
 * node-postgres driver otherwise. Local Postgres over the WebSocket driver is
 * unsupported, so localhost always uses `pg`.
 */
function isLocalUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);
}

/**
 * Builds a Drizzle client for the given connection URL, selecting the driver
 * by environment. Returns the Drizzle instance, the underlying pool, and a
 * close() that drains the pool.
 */
export function createDb(url: string): Db {
  if (isLocalUrl(url)) {
    const pool = new PgPool({ connectionString: url });
    return { db: drizzleNodePg(pool, { schema }), pool, close: () => pool.end() };
  }

  neonConfig.webSocketConstructor = ws;
  const config: NeonPoolConfig = { connectionString: url };
  const pool = new NeonPool(config);
  return { db: drizzleNeon(pool, { schema }), pool, close: () => pool.end() };
}
