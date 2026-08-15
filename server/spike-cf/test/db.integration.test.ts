import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { schema, users, recipes } from '../src/schema.js';

/**
 * Tier-1 integration test — the Drizzle `sqlite-core` layer against
 * better-sqlite3, fully offline, no wrangler. This is the fast local stand-in
 * for D1: the SAME schema and the SAME queries the Worker runs, exercised in
 * plain Node. It proves the schema ports and the read/write queries are correct.
 *
 * NOTE: the D1-only `db.batch()` persist path (src/db.ts) is NOT covered here —
 * better-sqlite3 has no `.batch()`. That path is covered end to end by
 * scripts/proof.sh against the real local D1. See docs/.../LOCAL-DEV.md.
 */
describe('drizzle sqlite-core schema on better-sqlite3 (offline D1 stand-in)', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeAll(() => {
    const sqlFile = readdirSync('drizzle').find((f) => f.endsWith('.sql'));
    if (!sqlFile) throw new Error('run `npm run db:generate` first — no drizzle/*.sql found');
    const conn = new Database(':memory:');
    // The generated migration's `--> statement-breakpoint` lines are SQL comments;
    // better-sqlite3 exec runs the whole script.
    conn.exec(readFileSync(`drizzle/${sqlFile}`, 'utf8'));
    db = drizzle(conn, { schema });
  });

  it('inserts a user + recipe and reads them back (ids + timestamps materialize)', async () => {
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, phone: '+15555550100' });

    const recipeId = crypto.randomUUID();
    await db.insert(recipes).values({
      id: recipeId,
      userId,
      title: 'Creamy Garlic Chicken',
      sourceType: 'website',
      sourceUrl: 'https://recipes.example.com/x',
      servings: 4,
      servingsEstimated: false,
      confidence: '0.9',
    });

    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    expect(row.title).toBe('Creamy Garlic Chicken');
    expect(row.sourceType).toBe('website'); // pg-enum → text union round-trips
    expect(row.servingsEstimated).toBe(false); // integer{mode:boolean} round-trips
    expect(row.createdAt).toBeInstanceOf(Date); // integer{mode:timestamp} round-trips
  });
});
