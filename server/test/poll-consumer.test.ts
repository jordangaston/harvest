import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { migratedFileDb } from './helpers/migrated-db.js';
import { PollConsumer } from '../src/imessage/poll-consumer.js';
import { StubThreadLock } from '../src/imessage/lock.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { pollVotes, pollStreamCursor, threadMessages } from '../src/schema.js';
import type { Database } from '../src/db.js';

const GUID = 'poll-guid-1';
const ANCHOR_BODY = JSON.stringify({
  title: 'Dinner?',
  options: [
    { optionIdentifier: 'opt1', text: 'Pizza' },
    { optionIdentifier: 'opt2', text: 'Tacos' },
    { optionIdentifier: 'opt3', text: 'Sushi' },
  ],
});

/** A poll vote/unvote event fixture (the proven raw shape). */
function voteEvent(seq: number, voter: string, optionIdentifier: string, type: 'voted' | 'unvoted') {
  return {
    type: 'poll.changed' as const,
    sequence: seq,
    actor: { address: voter, service: 'iMessage' },
    chatGuid: 'chat;+;test',
    isFromMe: false,
    occurredAt: new Date(),
    pollMessageGuid: GUID,
    delta: { type, optionIdentifier },
  };
}

/** A TypedEventStream-shaped stub: async-iterable over `gen()` with a no-op `close()`. */
function stubStream(gen: () => AsyncGenerator<any>) {
  return { [Symbol.asyncIterator]: () => gen(), close: async () => {} };
}

/** Stub client: `catchUp` replays the given events then completes; `subscribeEvents` yields the live ones. */
function stubClient(catchUpEvents: any[], liveEvents: any[] = []) {
  return {
    events: {
      catchUp: () =>
        stubStream(async function* () {
          for (const e of catchUpEvents) yield e;
          yield { type: 'catchup.complete', headSequence: 0 };
        }),
    },
    polls: {
      subscribeEvents: () =>
        stubStream(async function* () {
          for (const e of liveEvents) yield e;
        }),
    },
  } as any;
}

let db: Database;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  // The anchor row (WI-2) — the option map votes resolve against.
  const threads = ThreadRepository.create(db);
  const ownerUserId = await threads.upsertUserByHandle('+15128267702');
  const thread = await threads.upsertThreadByChatGuid({ chatGuid: 'chat;+;test', ownerUserId });
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

async function tally(): Promise<Record<string, number>> {
  const rows = await db.select().from(pollVotes).where(eq(pollVotes.selected, true));
  const t: Record<string, number> = {};
  for (const r of rows) t[r.optionIdentifier] = (t[r.optionIdentifier] ?? 0) + 1;
  return t;
}

describe('PollConsumer (WI-3)', () => {
  it('applies voted/unvoted/multi-select into distinct rows + tally (TC-1)', async () => {
    const events = [
      voteEvent(1, '+A', 'opt1', 'voted'),
      voteEvent(2, '+A', 'opt2', 'voted'),
      voteEvent(3, '+A', 'opt1', 'unvoted'),
      voteEvent(4, '+B', 'opt2', 'voted'),
    ];
    const consumer = PollConsumer.create(db, stubClient(events), new StubThreadLock());
    const result = await consumer.run({ maxDurationMs: 800_000 });

    expect(result).toEqual({ ran: true, applied: 4, throughSequence: 4 });

    const aOpt1 = await db.select().from(pollVotes).where(and(eq(pollVotes.voter, '+A'), eq(pollVotes.optionIdentifier, 'opt1')));
    const aOpt2 = await db.select().from(pollVotes).where(and(eq(pollVotes.voter, '+A'), eq(pollVotes.optionIdentifier, 'opt2')));
    const bOpt2 = await db.select().from(pollVotes).where(and(eq(pollVotes.voter, '+B'), eq(pollVotes.optionIdentifier, 'opt2')));
    expect(aOpt1[0]!.selected).toBe(false);
    expect(aOpt2[0]!.selected).toBe(true);
    expect(bOpt2[0]!.selected).toBe(true);
    expect(await tally()).toEqual({ opt2: 2 });
  });

  it('resolves voter_user_id for a known handle, null otherwise', async () => {
    const events = [voteEvent(1, '+15128267702', 'opt1', 'voted'), voteEvent(2, '+stranger', 'opt2', 'voted')];
    await PollConsumer.create(db, stubClient(events), new StubThreadLock()).run({ maxDurationMs: 800_000 });

    const [known] = await db.select().from(pollVotes).where(eq(pollVotes.voter, '+15128267702'));
    const [unknown] = await db.select().from(pollVotes).where(eq(pollVotes.voter, '+stranger'));
    expect(known!.voterUserId).not.toBeNull();
    expect(unknown!.voterUserId).toBeNull();
  });

  it('advances the cursor and never double-counts on replay (TC-2)', async () => {
    const first = [voteEvent(1, '+A', 'opt1', 'voted'), voteEvent(2, '+B', 'opt2', 'voted')];
    await PollConsumer.create(db, stubClient(first), new StubThreadLock()).run({ maxDurationMs: 800_000 });
    expect((await db.select().from(pollStreamCursor))[0]!.sequence).toBe(2);

    // A restart whose catchUp re-feeds 1-2 (overlap) then a new 3 — replays are no-ops.
    const replay = [voteEvent(1, '+A', 'opt1', 'voted'), voteEvent(2, '+B', 'opt2', 'voted'), voteEvent(3, '+C', 'opt2', 'voted')];
    const result = await PollConsumer.create(db, stubClient(replay), new StubThreadLock()).run({ maxDurationMs: 800_000 });

    expect(result).toMatchObject({ ran: true, applied: 1, throughSequence: 3 }); // only seq 3 was new
    expect(await db.select().from(pollVotes)).toHaveLength(3); // no dup rows
    expect(await tally()).toEqual({ opt1: 1, opt2: 2 });
  });

  it('a second invocation returns locked while one holds the lock (TC-3)', async () => {
    const held = new StubThreadLock(false); // never acquires
    const result = await PollConsumer.create(db, stubClient([]), held).run({ maxDurationMs: 800_000 });
    expect(result).toEqual({ ran: false, reason: 'locked' });
    expect(await db.select().from(pollVotes)).toHaveLength(0);
  });

  it('breaks the live loop near maxDuration and releases the lock (TC-4)', async () => {
    // An endless live stream; the injected clock jumps past the deadline after the 1st applied event.
    const client = {
      events: { catchUp: () => stubStream(async function* () { yield { type: 'catchup.complete', headSequence: 0 }; }) },
      polls: {
        subscribeEvents: () =>
          stubStream(async function* () {
            for (let seq = 100; ; seq++) yield voteEvent(seq, '+A', 'opt1', seq % 2 ? 'voted' : 'unvoted');
          }),
      },
    } as any;

    let t = 0;
    const now = () => (t += 10_000); // start→10s (deadline 20s); after 1st apply →20s ⇒ break
    const lock = new StubThreadLock();
    const result = await PollConsumer.create(db, client, lock).run({ maxDurationMs: 40_000, now });

    expect(result.ran).toBe(true);
    if (result.ran) expect(result.applied).toBeGreaterThan(0);
    expect(lock.calls).toBe(1); // acquired + released (withThreadLock returned)
  });
});
