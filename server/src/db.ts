import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Client } from '@libsql/client';
import { schema } from './schema.js';

export type Database = LibSQLDatabase<typeof schema>;

/**
 * Wraps a libSQL client in a Drizzle client. The caller supplies the client so
 * the build stays at the edge: a Node test passes `@libsql/client` with a `file:`
 * URL; a deployed function passes it a Turso cloud URL + auth token. Both satisfy
 * the same `Client` interface, so this layer is build-agnostic.
 * @param client - An @libsql/client `Client` (file: or Turso URL).
 */
export function makeDb(client: Client): Database {
  return drizzle(client, { schema });
}
