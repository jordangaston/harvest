import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface Db {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Builds a Drizzle client for a Postgres connection URL. Plain `pg` over TCP —
 * Neon speaks the standard Postgres wire protocol, so the same driver serves
 * local dev, tests, and Neon (use Neon's TCP endpoint). The serverless/WebSocket
 * driver is only needed in edge runtimes that can't open raw sockets — not here.
 */
export function createDb(url: string): Db {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
