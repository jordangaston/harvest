import { createDb, type Db, type Database } from './db/index.js';
import { env } from './config/env.js';

// Composition root: the long-lived deps app + tests share, wired by hand (no DI
// container). Later tickets add repositories/services as fields + overrides.
export interface Container {
  db: Database;
  pool: Db['pool'];
  close: () => Promise<void>;
}

export interface ContainerOverrides {
  db?: Db;
}

export function buildContainer(overrides: ContainerOverrides = {}): Container {
  const dbHandle = overrides.db ?? createDb(env.DATABASE_URL);
  return { db: dbHandle.db, pool: dbHandle.pool, close: dbHandle.close };
}
