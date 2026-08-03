import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';
import { env } from '../config/env.js';

// One Postgres pool + Drizzle client for the whole process. Plain pg over TCP
// serves local and Neon alike (Neon speaks the standard wire protocol).
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export type Database = NodePgDatabase<typeof schema>;
