import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { pollTally } from '../src/chef/tools/poll-tally.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { pollVotes, threadMessages } from '../src/schema.js';
import type { Database } from '../src/db.js';

const GUID = 'poll-guid-tally';
const ANCHOR_BODY = JSON.stringify({
  title: 'Dinner?',
  options: [
    { optionIdentifier: 'opt1', text: 'Pizza' },
    { optionIdentifier: 'opt2', text: 'Tacos' },
    { optionIdentifier: 'opt3', text: 'Sushi' },
  ],
});

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  // The WI-2 anchor row — the option map the tally resolves option text against.
  const threads = ThreadRepository.create(db);
  const ownerUserId = await threads.upsertUserByHandle('+15128267702');
  const thread = await threads.upsertThreadByChatGuid({ chatGuid: 'chat;+;tally', ownerUserId });
  await db.insert(threadMessages).values({
    threadId: thread.id,
    direction: 'outbound',
    type: 'poll',
    body: ANCHOR_BODY,
    messageGuid: crypto.randomUUID(),
    externalId: GUID,
    sentAt: new Date(),
  });
});

afterEach(() => cleanup());

/** Seed one selected/unselected vote row. */
async function seedVote(voter: string, optionIdentifier: string, selected: boolean): Promise<void> {
  await db.insert(pollVotes).values({ pollMessageGuid: GUID, voter, optionIdentifier, selected, sequence: 1, updatedAt: new Date() });
}

describe('pollTally (WI-4)', () => {
  it('returns per-option counts + voters, zero-count options included (TC-1)', async () => {
    await seedVote('+A', 'opt2', true);
    await seedVote('+B', 'opt2', true);
    await seedVote('+A', 'opt1', false); // unselected — must not count

    const tally = await pollTally(db, GUID);
    expect(tally).toEqual([
      { optionIdentifier: 'opt1', text: 'Pizza', count: 0, voters: [] },
      { optionIdentifier: 'opt2', text: 'Tacos', count: 2, voters: ['+A', '+B'] },
      { optionIdentifier: 'opt3', text: 'Sushi', count: 0, voters: [] },
    ]);
  });

  it('a poll with no votes returns every option at count 0 — a valid empty state (TC-3)', async () => {
    const tally = await pollTally(db, GUID);
    expect(tally.map((o) => o.count)).toEqual([0, 0, 0]);
    expect(tally.every((o) => o.voters.length === 0)).toBe(true);
  });
});
