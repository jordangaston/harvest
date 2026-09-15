import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { migratedFileDb } from './helpers/migrated-db.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { threadMessages } from '../src/schema.js';
import type { Database } from '../src/db.js';

// The poll path calls the advanced client (WI-1); tests never hit the network, so `polls.create` is
// a spy returning a fixed guid + option map. `sendPoll` reads that map straight into the anchor row.
const pollsCreate = vi.fn();
vi.mock('../src/imessage/advanced-client.js', () => ({
  createAdvancedClient: () => ({ polls: { create: pollsCreate } }),
}));

// Imported after the mock is registered so `sendPoll` closes over the mocked client.
const { sendPoll, SendInput } = await import('../src/chef/chef-agent.js');

let db: Database;
let cleanup: () => void;
let threadId: string;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  pollsCreate.mockReset();
  const threads = ThreadRepository.create(db);
  const ownerUserId = await threads.upsertUserByHandle('+15128267702');
  const thread = await threads.upsertThreadByChatGuid({ chatGuid: 'chat;+;test', ownerUserId });
  threadId = thread.id;
});

afterEach(() => cleanup());

describe('sendPoll (WI-2)', () => {
  it('sends the poll and persists its anchor row with the option map (TC-1)', async () => {
    pollsCreate.mockResolvedValue({
      pollMessageGuid: 'poll-guid-1',
      chatGuid: 'chat;+;test',
      title: 'Dinner?',
      options: [
        { optionIdentifier: 'a', text: 'Pizza' },
        { optionIdentifier: 'b', text: 'Tacos' },
        { optionIdentifier: 'c', text: 'Sushi' },
      ],
      votes: [],
    });

    const sent = await sendPoll({ type: 'poll', text: 'Dinner?', options: ['Pizza', 'Tacos', 'Sushi'] }, threadId, 'chat;+;test', db, 'trigger-1');

    expect(sent).toBe(true);
    expect(pollsCreate).toHaveBeenCalledWith('chat;+;test', 'Dinner?', ['Pizza', 'Tacos', 'Sushi']);
    const [row] = await db.select().from(threadMessages).where(eq(threadMessages.type, 'poll'));
    expect(row).toBeDefined();
    expect(row!.externalId).toBe('poll-guid-1'); // votes anchor on the server guid
    expect(row!.messageGuid).toBe('trigger-1#poll'); // deterministic per-turn dedup key
    expect(row!.direction).toBe('outbound');
    expect(JSON.parse(row!.body!)).toEqual({
      title: 'Dinner?',
      options: [
        { optionIdentifier: 'a', text: 'Pizza' },
        { optionIdentifier: 'b', text: 'Tacos' },
        { optionIdentifier: 'c', text: 'Sushi' },
      ],
    });
  });

  it('drops a poll with fewer than 2 options — no send, no row (TC-2)', async () => {
    const sent = await sendPoll({ type: 'poll', text: 'x', options: ['only one'] }, threadId, 'chat;+;test', db, 'trigger-1');

    expect(sent).toBe(false);
    expect(pollsCreate).not.toHaveBeenCalled();
    const rows = await db.select().from(threadMessages).where(eq(threadMessages.type, 'poll'));
    expect(rows).toHaveLength(0);
  });

  it('drops a poll with a blank title — no send, no row', async () => {
    const sent = await sendPoll({ type: 'poll', text: '  ', options: ['a', 'b'] }, threadId, 'chat;+;test', db, 'trigger-1');
    expect(sent).toBe(false);
    expect(pollsCreate).not.toHaveBeenCalled();
  });

  it('is idempotent across a redelivered turn — one RPC, one row', async () => {
    pollsCreate.mockResolvedValue({
      pollMessageGuid: 'poll-guid-1', chatGuid: 'chat;+;test', title: 'Dinner?',
      options: [{ optionIdentifier: 'a', text: 'Pizza' }, { optionIdentifier: 'b', text: 'Tacos' }], votes: [],
    });
    const payload = { type: 'poll' as const, text: 'Dinner?', options: ['Pizza', 'Tacos'] };

    await sendPoll(payload, threadId, 'chat;+;test', db, 'trigger-1');
    const second = await sendPoll(payload, threadId, 'chat;+;test', db, 'trigger-1'); // same turn redelivered

    expect(second).toBe(true); // reported sent, but not re-sent
    expect(pollsCreate).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(threadMessages).where(eq(threadMessages.type, 'poll'));
    expect(rows).toHaveLength(1);
  });
});

describe('SendInput schema round-trips a poll (TC-3)', () => {
  it('accepts a poll payload and rejects unknown fields', () => {
    expect(SendInput.parse({ type: 'poll', text: 'Dinner?', options: ['Pizza', 'Tacos'] })).toEqual({
      type: 'poll',
      text: 'Dinner?',
      options: ['Pizza', 'Tacos'],
    });
    expect(SendInput.safeParse({ type: 'poll', text: 'x', options: ['a', 'b'], bogus: 1 }).success).toBe(false);
  });
});
