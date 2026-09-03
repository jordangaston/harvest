import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Consumer } from '../src/imessage/consumer.js';
import type { Chef, ChefReply } from '../src/imessage/chef.js';
import { sendingChef } from './helpers/chef-double.js';
import { StubSpectrumSender } from '../src/imessage/sender.js';
import { StubThreadLock } from '../src/imessage/lock.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { threads, threadMessages, objectives, tasks } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { type Database } from '../src/db.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** A fresh thread with an owner + household (so the rename gate's householdId is set) and one inbound. */
async function seedThreadWithInbound(): Promise<{ threadId: string; inboundId: string; ownerUserId: string }> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const owner = await UserRepository.create(db).insert({ phone: `+1555${Math.random().toString().slice(2, 9)}`, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: owner.id });
  await hh.addMember({ householdId: household.id, userId: owner.id });

  const threadId = randomUUID();
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: owner.id, householdId: household.id });

  const guid = randomUUID();
  await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: owner.id, type: 'text', body: 'hi', messageGuid: guid });
  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
  return { threadId, inboundId: row!.id, ownerUserId: owner.id };
}

/** Appends one inbound text a second past the cursor so the next handle() has something to answer. */
async function addInbound(threadId: string, ownerUserId: string): Promise<string> {
  const guid = randomUUID();
  await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: ownerUserId, type: 'text', body: 'next', messageGuid: guid });
  await db.update(threadMessages).set({ createdAt: new Date(Date.now() + 1000) }).where(eq(threadMessages.messageGuid, guid));
  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
  return row!.id;
}

// AC1/AC2: rename to "Meal Planning" once the household exists, group-only.
describe('chat rename after household creation (WI-4C AC1, AC2)', () => {
  it('renames once on a group chat, stamps renamed_at, and does not re-rename a later turn', async () => {
    const { threadId, inboundId, ownerUserId } = await seedThreadWithInbound();
    // Greet already fired so the confetti path is out of the way.
    await ThreadRepository.create(db).markGreeted(threadId, new Date());

    let cursor = inboundId;
    const chef: Chef = {
      respond: async (_threadId, sink): Promise<ChefReply> => {
        await sink.send({ kind: 'text', text: 'a reply' });
        return { confirmTasks: [], cursorTo: cursor, objectiveId: '', delivered: true };
      },
    };
    const sender = new StubSpectrumSender(); // spaceType defaults to 'group'
    const consumer = new Consumer(db, sender, chef, new StubThreadLock());

    await consumer.handle({ threadId }); // household present + renamed_at null → rename fires
    expect(sender.renameCalls).toEqual([{ chatGuid: `g-${threadId}`, name: 'Meal Planning' }]);
    const [t1] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(t1!.renamedAt).not.toBeNull();

    cursor = await addInbound(threadId, ownerUserId);
    await consumer.handle({ threadId }); // renamed_at set → no re-rename
    expect(sender.renameCalls).toHaveLength(1);
  });

  it('no-ops on a 1:1 DM without throwing (still stamps renamed_at so it never retries)', async () => {
    const { threadId, inboundId } = await seedThreadWithInbound();
    await ThreadRepository.create(db).markGreeted(threadId, new Date());

    const chef = sendingChef([{ kind: 'text', text: 'a reply' }], { confirmTasks: [], cursorTo: inboundId, objectiveId: '' });
    const sender = new StubSpectrumSender();
    sender.spaceType = 'dm'; // a DM: renameChat must no-op, not throw
    const consumer = new Consumer(db, sender, chef, new StubThreadLock());

    await expect(consumer.handle({ threadId })).resolves.toBeUndefined();
    expect(sender.renameCalls).toHaveLength(0); // recorded nothing — the DM skipped the rename
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(thread!.renamedAt).not.toBeNull(); // stamped so it won't retry every turn
  });
});
