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
import { threads, threadMessages } from '../src/schema.js';
import { migratedFileDb } from './helpers/migrated-db.js';
import { type Database } from '../src/db.js';

// AC2: sendLink records the url (and target when threaded) and returns ids — pure, no DB.
describe('Sender.sendLink (StubSpectrumSender)', () => {
  it('records the url un-threaded and returns an id (AC2)', async () => {
    const sender = new StubSpectrumSender();
    const ids = await sender.sendLink('chat-1', 'https://ex.com/r');
    expect(ids).toEqual(['ext-0']);
    expect(sender.linkCalls).toEqual([{ chatGuid: 'chat-1', url: 'https://ex.com/r', target: null }]);
  });

  it('records the resolved target when a threadParentId is given (AC2)', async () => {
    const sender = new StubSpectrumSender();
    await sender.sendLink('chat-1', 'https://ex.com/r', 'spc-msg-PARENT');
    expect(sender.linkCalls).toEqual([{ chatGuid: 'chat-1', url: 'https://ex.com/r', target: 'spc-msg-PARENT' }]);
  });
});

// AC1: the consumer persists a richlink event and dispatches it via sendLink, ordered after text.
let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

async function seedThreadWithInbound(): Promise<{ threadId: string; inboundId: string; inboundGuid: string }> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const owner = await UserRepository.create(db).insert({ phone: '+15555590001', jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: owner.id });
  await hh.addMember({ householdId: household.id, userId: owner.id });

  const threadId = randomUUID();
  // greeted_at set: these cases exercise richlink/tapback dispatch, not the WI-4B confetti greeting
  // (which would otherwise ship the first bubble of this fresh thread via sendEffect).
  await db.insert(threads).values({ id: threadId, chatGuid: `g-${threadId}`, ownerUserId: owner.id, householdId: household.id, greetedAt: new Date() });

  const guid = randomUUID();
  await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: owner.id, type: 'text', body: 'a recipe idea?', messageGuid: guid });
  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
  return { threadId, inboundId: row.id, inboundGuid: guid };
}

describe('consumer dispatches a richlink event (AC1)', () => {
  it('sends the text batch first, then the link, persisting both with external_id', async () => {
    const { threadId, inboundId } = await seedThreadWithInbound();
    const url = 'https://recipes.example.com/pasta';
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [
          { kind: 'text', text: 'Here you go:' },
          { kind: 'richlink', url },
        ],
        confirmTasks: [],
        cursorTo: inboundId,
        objectiveId: '', // no objective this turn — the consumer's pop is a no-op on a blank id
      }),
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    // Text went out as a batch, the link via sendLink — text flushed before the link.
    expect(sender.calls.map((c) => c.body)).toEqual(['Here you go:']);
    expect(sender.linkCalls.map((c) => c.url)).toEqual([url]);

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, 'outbound'));
    expect(outbound).toHaveLength(2);
    const link = outbound.find((r) => r.body === `[richlink:${url}]`)!;
    expect(link).toBeDefined();
    expect(outbound.every((r) => r.sentAt !== null)).toBe(true);
    expect(outbound.every((r) => r.externalId !== null)).toBe(true);
  });
});

// WI-4A AC1: the consumer persists a tapback as a type='reaction' row (glyph + target) and dispatches
// it via sendReaction — never as text, and the sent_at gate marks it sent.
describe('consumer dispatches a tapback event (WI-4A AC1)', () => {
  it('persists a reaction row (glyph + target) and calls sendReaction, not send', async () => {
    const { threadId, inboundId, inboundGuid } = await seedThreadWithInbound();
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: 'tapback', target: inboundGuid, emoji: 'love' }],
        confirmTasks: [],
        cursorTo: inboundId,
        objectiveId: '',
      }),
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    // Dispatched as a reaction (glyph + the inbound's external_id), not a text send.
    expect(sender.reactionCalls).toEqual([{ chatGuid: `g-${threadId}`, target: inboundGuid, emoji: '❤️' }]);
    expect(sender.calls).toHaveLength(0);

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, 'outbound'));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ type: 'reaction', reactionEmoji: '❤️', targetMessageGuid: inboundGuid, body: null });
    expect(outbound[0]!.sentAt).not.toBeNull(); // the sent_at idempotency gate is respected
  });
});
