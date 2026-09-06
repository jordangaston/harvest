import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import type { Database } from '../db.js';
import { objectives } from '../schema.js';

/** The definitions the first-contact seed creates — the only ones the re-seed bug duplicates. */
const RESEEDABLE = ['onboarding', 'first_meal_plan'];

/**
 * Repairs threads hit by the re-seed bug (chef-steady-state WI-01 AC-6): completing first_meal_plan
 * emptied the stack, and the next inbound re-seeded a fresh onboarding + first_meal_plan on a thread
 * that had ALREADY completed onboarding. For each thread with a completed onboarding, deletes any
 * non-terminal (active/suspended) onboarding or first_meal_plan objective CREATED AFTER that
 * completion — the bogus re-seed — and its tasks (FK cascade). Terminal history is left untouched.
 * Idempotent: a second run finds nothing (the re-seeds are gone). Returns what it deleted, for logging.
 */
export async function repairReseededThreads(db: Database): Promise<{ threadId: string; objectiveId: string; definition: string; status: string; createdAt: Date }[]> {
  // The earliest completed onboarding per thread — the moment a thread was genuinely set up.
  const completed = await db
    .select({ threadId: objectives.threadId, completedAt: objectives.completedAt })
    .from(objectives)
    .where(and(eq(objectives.definition, 'onboarding'), eq(objectives.status, 'complete')));

  const onboardedAt = new Map<string, Date>();
  for (const row of completed) {
    if (!row.completedAt) continue;
    const prev = onboardedAt.get(row.threadId);
    if (!prev || row.completedAt < prev) onboardedAt.set(row.threadId, row.completedAt);
  }

  const deleted: { threadId: string; objectiveId: string; definition: string; status: string; createdAt: Date }[] = [];
  for (const [threadId, completedAt] of onboardedAt) {
    const bogus = await db
      .select({ id: objectives.id, definition: objectives.definition, status: objectives.status, createdAt: objectives.createdAt })
      .from(objectives)
      .where(
        and(
          eq(objectives.threadId, threadId),
          inArray(objectives.definition, RESEEDABLE),
          ne(objectives.status, 'complete'),
          gt(objectives.createdAt, completedAt),
        ),
      );
    if (bogus.length === 0) continue;
    await db.delete(objectives).where(inArray(objectives.id, bogus.map((o) => o.id)));
    for (const o of bogus) deleted.push({ threadId, objectiveId: o.id, definition: o.definition, status: o.status, createdAt: o.createdAt });
  }
  return deleted;
}
