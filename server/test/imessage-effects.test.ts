import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Consumer } from '../src/imessage/consumer.js';
import type { Chef, ChefReply } from '../src/imessage/chef.js';
import { StubSpectrumSender } from '../src/imessage/sender.js';
import { StubThreadLock } from '../src/imessage/lock.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { UserRepository } from '../src/repositories/user-repository.js';
import { AuthService } from '../src/services/auth-service.js';
import { threads, threadMessages, objectives, slots } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { type Database } from '../src/db.js';

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** A fresh thread (greeted_at/celebrated_at null) with one owner + household, and one inbound text. */
async function seedThreadWithInbound(): Promise<{ threadId: string; inboundId: string }> {
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
  return { threadId, inboundId: row!.id };
}

/** Appends one inbound text past the cursor so the next handle() has something to answer. */
async function addInbound(threadId: string, ownerUserId: string): Promise<string> {
  const guid = randomUUID();
  await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: ownerUserId, type: 'text', body: 'next', messageGuid: guid });
  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
  return row!.id;
}

// AC1/AC2: confetti on the first greeting bubble, exactly once.
describe('confetti greeting (WI-4B AC1, AC2)', () => {
  it('sends the first bubble via sendEffect(confetti), rest normal, and stamps greeted_at', async () => {
    const { threadId, inboundId } = await seedThreadWithInbound();
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [
          { kind: 'text', text: 'Hey there! 👋' },
          { kind: 'text', text: "I'm Chef." },
        ],
        slotUpdates: [],
        cursorTo: inboundId,
        objectiveId: '',
      }),
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    // First bubble carried confetti; the rest went as a normal batch.
    expect(sender.effectCalls).toEqual([{ chatGuid: `g-${threadId}`, body: 'Hey there! 👋', effectName: 'confetti' }]);
    expect(sender.calls.map((c) => c.body)).toEqual(["I'm Chef."]);

    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(thread!.greetedAt).not.toBeNull();
  });

  it('does not confetti a later turn once greeted_at is set (AC2)', async () => {
    const { threadId, inboundId } = await seedThreadWithInbound();
    const [t0] = await db.select().from(threads).where(eq(threads.id, threadId));
    const ownerUserId = t0!.ownerUserId;

    let cursor = inboundId;
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: 'text', text: 'a reply' }],
        slotUpdates: [],
        cursorTo: cursor,
        objectiveId: '',
      }),
    };
    const sender = new StubSpectrumSender();
    const consumer = new Consumer(db, sender, chef, new StubThreadLock());

    await consumer.handle({ threadId }); // first turn → confetti
    cursor = await addInbound(threadId, ownerUserId);
    await consumer.handle({ threadId }); // second turn → no confetti

    // Exactly one confetti across both turns; the second turn's bubble was a normal send.
    expect(sender.effectCalls).toHaveLength(1);
    expect(sender.calls.map((c) => c.body)).toEqual(['a reply']); // only the 2nd turn's bubble batched
  });
});

// AC3: fireworks the turn onboarding completes, exactly once; redelivery no-ops.
describe('fireworks on onboarding-complete (WI-4B AC3)', () => {
  it('sends one sendEffect(fireworks), stamps celebrated_at, and a redelivered doorbell does not re-fire', async () => {
    const { threadId, inboundId } = await seedThreadWithInbound();
    // Mark greeted so the confetti path is out of the way — we're testing fireworks in isolation.
    await ThreadRepository.create(db).markGreeted(threadId, new Date());

    // An onboarding objective with one required, unfilled slot; the turn fills it → complete.
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: 'onboarding', status: 'active', stackPosition: 0 });
    const slotId = randomUUID();
    await db.insert(slots).values({ id: slotId, objectiveId, key: 'k', scope: 'household', required: true, status: 'unasked' });

    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: 'text', text: "You're all set!" }],
        slotUpdates: [{ slotId, status: 'filled', value: 'done' }],
        cursorTo: inboundId,
        objectiveId,
      }),
    };
    const sender = new StubSpectrumSender();
    const consumer = new Consumer(db, sender, chef, new StubThreadLock());

    await consumer.handle({ threadId });

    expect(sender.effectCalls).toEqual([
      { chatGuid: `g-${threadId}`, body: 'Your first menu is on its way! 🎆', effectName: 'fireworks' },
    ]);
    const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(thread!.celebratedAt).not.toBeNull();

    // Redeliver the same doorbell: cursor already advanced, slot terminal, celebrated_at set → no re-fire.
    await consumer.handle({ threadId });
    expect(sender.effectCalls).toHaveLength(1);
  });
});
