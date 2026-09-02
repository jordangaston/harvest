import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// The tool starts an import through ImportService, whose queue send() is a module import.
// Mock it so the intake writes its real import_jobs row but never touches the Vercel Queue.
const { send } = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock('../src/queue.js', () => ({ send, handleCallback: vi.fn() }));

import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { importJobs, imessageImport, threads } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ImportRecipeTool } from '../src/chef/tools/import-recipe.js';
import { buildTools } from '../src/chef/tools/registry.js';
import { objectiveDefinition } from '../src/chef/objectives/index.js';
import { onboardingObjective } from '../src/chef/objectives/onboarding.js';
import { FactTypeRegistry } from '../src/chef/facts/fact-types.js';
import type { TurnContext } from '../src/chef/tools/types.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  send.mockClear();
});
afterEach(() => cleanup());

/** Seeds an owner user + a thread they own, returning the ids and a wired TurnContext. */
async function seedThread(triggerExternalId: string | null): Promise<{ ownerId: string; threadId: string; ctx: TurnContext }> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const owner = await UserRepository.create(db).insert({ phone: '+15555551234', jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  const [thread] = await db.insert(threads).values({ chatGuid: 'chat-1', ownerUserId: owner.id }).returning();
  const ctx: TurnContext = {
    db,
    threadId: thread!.id,
    objectiveId: 'obj-test',
    initiatorHandle: '',
    initiatorUserId: owner.id,
    triggerExternalId,
    householdId: null,
    members: [],
    tasks: [],
    factTypes: FactTypeRegistry.create(db),
  };
  return { ownerId: owner.id, threadId: thread!.id, ctx };
}

describe('import_recipe.run', () => {
  it('starts an import for the owner and links it to the thread with the trigger id (AC1)', async () => {
    const { ownerId, threadId, ctx } = await seedThread('msg-guid-42');

    const res = await ImportRecipeTool.create(ctx).run('https://www.tiktok.com/@x/video/1');

    expect(res.saved.job_id).toBeTruthy();
    expect(res.rejected).toEqual([]);
    expect(send).toHaveBeenCalledOnce();

    const [job] = await db.select().from(importJobs).where(eq(importJobs.userId, ownerId));
    expect(job.sourceType).toBe('tiktok');

    const [link] = await db.select().from(imessageImport).where(eq(imessageImport.jobId, job.id));
    expect(link).toMatchObject({ jobId: job.id, threadId, targetExternalId: 'msg-guid-42', notifiedAt: null });
  });

  it('rejects a non-recipe URL synchronously — no job, no link, no enqueue (AC2)', async () => {
    const { ownerId, ctx } = await seedThread(null);

    const res = await ImportRecipeTool.create(ctx).run('https://instagram.com/someprofile');

    expect(res).toEqual({ saved: {}, rejected: [{ input: 'https://instagram.com/someprofile', reason: 'not a recipe link' }] });
    expect(send).not.toHaveBeenCalled();
    expect(await db.select().from(importJobs).where(eq(importJobs.userId, ownerId))).toHaveLength(0);
    expect(await db.select().from(imessageImport)).toHaveLength(0);
  });

  it('canRun iff a thread owner is known', async () => {
    const { ctx } = await seedThread(null);
    expect(ImportRecipeTool.create(ctx).canRun()).toBe(true);
    expect(ImportRecipeTool.create({ ...ctx, initiatorUserId: '' }).canRun()).toBe(false);
  });
});

describe('import_recipe reachability', () => {
  // The reasoner builds its per-turn tools from objectiveDefinition(objective).tools, and every turn
  // (mid-onboarding AND post-onboarding, which re-seeds onboarding) runs the onboarding objective —
  // so import_recipe is reachable whenever a link is dropped iff onboarding declares it.
  it('is in the onboarding objective the reasoner runs every turn', async () => {
    const { ctx } = await seedThread(null);
    expect(objectiveDefinition('onboarding')!.tools).toContain('import_recipe');
    const built = buildTools(ctx, onboardingObjective.tools);
    expect(built.map((t) => t.id)).toContain('import_recipe');
  });
});
