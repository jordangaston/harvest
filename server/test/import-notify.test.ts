import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { type Database } from '../src/db.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { ImessageImportRepository } from '../src/repositories/imessage-import-repository.js';
import { CookbookRepository } from '../src/repositories/cookbook-repository.js';
import { ImportNotifier } from '../src/imessage/import-notifier.js';
import { StubSpectrumSender } from '../src/imessage/sender.js';
import { importJobs, importJobRecipes, recipes, threads, cookbooks, cookbookRecipes, imessageImport } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** Seeds an owner, a thread they own, and a `ready` job with a linked recipe titled `title`,
 *  plus an `imessage_import` link (unless `link=false`). Returns the ids. */
async function seedReadyJob(opts: { link?: boolean; title?: string } = {}) {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const owner = await UserRepository.create(db).insert({ phone: '+15555550001', jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  const [thread] = await db.insert(threads).values({ chatGuid: 'chat-1', ownerUserId: owner.id }).returning();
  const [job] = await db.insert(importJobs).values({ userId: owner.id, status: 'ready', sourceType: 'tiktok', sourceRef: 'https://x/1' }).returning();
  const [recipe] = await db.insert(recipes).values({ userId: owner.id, title: opts.title ?? 'Miso Salmon', sourceType: 'tiktok' }).returning();
  await db.insert(importJobRecipes).values({ importJobId: job!.id, recipeId: recipe!.id, position: 0 });
  if (opts.link !== false) await ImessageImportRepository.create(db).insert({ jobId: job!.id, threadId: thread!.id, targetExternalId: 'msg-42' });
  return { ownerId: owner.id, threadId: thread!.id, jobId: job!.id, recipeId: recipe!.id };
}

/** The recipe ids in the owner's Liked cookbook. */
async function likedMembership(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ recipeId: cookbookRecipes.recipeId })
    .from(cookbooks)
    .innerJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(and(eq(cookbooks.userId, ownerId), eq(cookbooks.systemSlug, 'liked')));
  return rows.map((r) => r.recipeId);
}

describe('ImportNotifier.notify', () => {
  it('ready → saves to Liked, sends a success message naming the recipe, stamps notified_at (AC1)', async () => {
    const { ownerId, jobId, recipeId } = await seedReadyJob({ title: 'Miso Salmon' });
    const sender = new StubSpectrumSender();

    await (await ImportNotifier.create(db, sender)).notify(jobId, 'ready');

    expect(await likedMembership(ownerId)).toEqual([recipeId]);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.body).toBe('Saved "Miso Salmon" to your Liked cookbook.');
    const [link] = await db.select().from(imessageImport).where(eq(imessageImport.jobId, jobId));
    expect(link!.notifiedAt).not.toBeNull();
  });

  it('failed → sends a failure message, no Liked write, stamps notified_at (AC2)', async () => {
    const { ownerId, jobId } = await seedReadyJob();
    const sender = new StubSpectrumSender();

    await (await ImportNotifier.create(db, sender)).notify(jobId, 'failed');

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.body).toBe("I couldn't save that recipe — we're looking into it.");
    expect(await likedMembership(ownerId)).toEqual([]);
    const [link] = await db.select().from(imessageImport).where(eq(imessageImport.jobId, jobId));
    expect(link!.notifiedAt).not.toBeNull();
  });

  it('exactly-once: a second notify for the same job no-ops (AC3)', async () => {
    const { jobId } = await seedReadyJob();
    const sender = new StubSpectrumSender();
    const notifier = await ImportNotifier.create(db, sender);

    await notifier.notify(jobId, 'ready');
    await notifier.notify(jobId, 'ready');

    expect(sender.calls).toHaveLength(1);
  });

  it('mobile import (no link) is untouched — no send, no Liked change (AC4)', async () => {
    const { ownerId, jobId } = await seedReadyJob({ link: false });
    const sender = new StubSpectrumSender();

    await (await ImportNotifier.create(db, sender)).notify(jobId, 'ready');

    expect(sender.calls).toHaveLength(0);
    expect(await likedMembership(ownerId)).toEqual([]);
  });
});
