import { and, eq, sql } from 'drizzle-orm';
import type { AdvancedIMessage, PollEvent } from '@photon-ai/advanced-imessage/grpc';
import type { Database } from '../db.js';
import { pollStreamCursor, pollVotes, threadMessages, users } from '../schema.js';
import { createAdvancedClient } from './advanced-client.js';
import { selectThreadLock, type ThreadLock } from './lock.js';

/** The one lock key — a single consumer holds the poll stream process-wide. */
const LOCK_KEY = 'poll-consumer';
/** Stop reading the live stream this far before maxDuration so we exit + release cleanly. */
const EXIT_BUFFER_MS = 30_000;
/** The cron function's `maxDuration` (Vercel Pro GA cap) — the route budget + vercel.json must agree. */
export const POLL_CONSUME_MAX_DURATION_S = 800;

/** The run summary: `{ran:false,reason:'locked'}` when the lock is held, else counts. */
export interface ConsumeResult {
  ran: boolean;
  reason?: 'locked';
  applied?: number;
  throughSequence?: number;
}

/**
 * The vote-ingestion loop-worker (WI-3, design F-02). Votes arrive only on the advanced
 * `polls.subscribeEvents()` stream and `polls.get()` is empty on shared, so we bookkeep the
 * tally ourselves into `poll_votes` with an advancing `poll_stream_cursor`.
 *
 * A Vercel Cron relaunches a lock-guarded function that holds the stream to near `maxDuration`
 * then exits; the next tick relaunches. On start `events.catchUp(cursor)` (poll deltas only)
 * covers the ≤1-cron-interval seam. Application is idempotent on the unique key `(guid, voter,
 * option)` + `sequence`: a replayed event at or below the stored sequence is a no-op.
 */
export class PollConsumer {
  private constructor(
    private readonly db: Database,
    private readonly client: AdvancedIMessage,
    private readonly lock: ThreadLock,
  ) {}

  /**
   * Builds a consumer over the given db + advanced client + lock. The route wires the live
   * client (WI-1) and process lock via {@link createPollConsumer}; tests pass stubs.
   */
  static create(db: Database, client: AdvancedIMessage, lock: ThreadLock): PollConsumer {
    return new PollConsumer(db, client, lock);
  }

  /**
   * Acquires the single consumer lock, catches up from the cursor, then holds the live stream
   * until ~`maxDuration−buffer`, applying poll deltas and advancing the cursor throughout.
   * @param opts.maxDurationMs the function's wall budget; the loop exits {@link EXIT_BUFFER_MS} before it.
   * @param opts.now injectable clock (tests); defaults to `Date.now`.
   * @returns `{ran:false,reason:'locked'}` when another consumer holds the lock, else a run summary.
   */
  async run(opts: { maxDurationMs: number; now?: () => number }): Promise<ConsumeResult> {
    const now = opts.now ?? Date.now;
    const deadline = now() + opts.maxDurationMs - EXIT_BUFFER_MS;
    const outcome = await this.lock.withThreadLock(LOCK_KEY, async () => {
      let applied = 0;
      applied += await this.drainCatchUp();
      applied += await this.drainLive(deadline, now);
      const throughSequence = await this.currentSequence();
      return { applied, throughSequence };
    });
    if (!outcome.ran) return { ran: false, reason: 'locked' };
    return { ran: true, ...outcome.value! };
  }

  /**
   * Replays durable poll deltas from the cursor until `catchup.complete`, then closes the stream.
   * Q-01 (whether catchUp replays *vote* deltas on shared) is pending manual verification — the
   * probe confirmed catchUp streams durable events but couldn't reach completion from seq 0 in a
   * bounded window (see docs/specs/poll-wi3-vote-worker.md). If it turns out votes aren't replayed,
   * recover the seam via a bounded `subscribeEvents` replay from `since` instead.
   */
  private async drainCatchUp(): Promise<number> {
    let applied = 0;
    const since = await this.currentSequence();
    const stream = this.client.events.catchUp(since);
    try {
      for await (const event of stream) {
        if (event.type === 'catchup.complete') break;
        if (event.type === 'poll.changed' && (await this.apply(event))) applied += 1;
      }
    } finally {
      await stream.close();
    }
    return applied;
  }

  /** Holds the live poll stream, applying deltas until the deadline, then closes it. */
  private async drainLive(deadline: number, now: () => number): Promise<number> {
    let applied = 0;
    const stream = this.client.polls.subscribeEvents();
    try {
      for await (const event of stream) {
        if (await this.apply(event)) applied += 1;
        if (now() >= deadline) break;
      }
    } finally {
      await stream.close();
    }
    return applied;
  }

  /**
   * Applies one poll delta. `voted`/`unvoted` upsert the (guid, voter, option) row's `selected`
   * state; `created`/`optionAdded` refresh the anchor row's option map (defensive — we already have
   * it from `create`). Idempotent: an event at or below the stored cursor sequence is skipped.
   * @returns whether a vote row was written.
   */
  private async apply(event: PollEvent): Promise<boolean> {
    if (event.sequence <= (await this.currentSequence())) return false;
    const { delta } = event;
    let wrote = false;
    if (delta.type === 'voted' || delta.type === 'unvoted') {
      const voter = event.actor?.address;
      if (voter) {
        await this.upsertVote(event.pollMessageGuid, voter, delta.optionIdentifier, delta.type === 'voted', event.sequence);
        wrote = true;
      }
    } else {
      await this.refreshOptionMap(event.pollMessageGuid, delta.options);
    }
    await this.advanceCursor(event.sequence);
    return wrote;
  }

  /** Refreshes the `type='poll'` anchor row's `optionIdentifier → text` map from a created/optionAdded delta. */
  private async refreshOptionMap(guid: string, options: readonly { optionIdentifier: string; text: string }[]): Promise<void> {
    const [row] = await this.db
      .select({ body: threadMessages.body })
      .from(threadMessages)
      .where(and(eq(threadMessages.type, 'poll'), eq(threadMessages.externalId, guid)))
      .limit(1);
    if (!row) return;
    const current = row.body ? JSON.parse(row.body) : {};
    const body = JSON.stringify({ ...current, options: options.map((o) => ({ optionIdentifier: o.optionIdentifier, text: o.text })) });
    await this.db.update(threadMessages).set({ body }).where(and(eq(threadMessages.type, 'poll'), eq(threadMessages.externalId, guid)));
  }

  /** Upserts the (guid, voter, option) row to `selected`, resolving the voter to a user when known. */
  private async upsertVote(guid: string, voter: string, optionIdentifier: string, selected: boolean, sequence: number): Promise<void> {
    const voterUserId = await this.resolveVoter(voter);
    await this.db
      .insert(pollVotes)
      .values({ pollMessageGuid: guid, voter, voterUserId, optionIdentifier, selected, sequence, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [pollVotes.pollMessageGuid, pollVotes.voter, pollVotes.optionIdentifier],
        set: { selected, sequence, voterUserId, updatedAt: new Date() },
      });
  }

  /** Maps a voter handle to a known user id (else null — an unknown handle still tallies by handle). */
  private async resolveVoter(handle: string): Promise<string | null> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.imessageHandle, handle)).limit(1);
    return row?.id ?? null;
  }

  /** The last applied event sequence (0 when never run). */
  private async currentSequence(): Promise<number> {
    const [row] = await this.db.select({ sequence: pollStreamCursor.sequence }).from(pollStreamCursor).where(eq(pollStreamCursor.id, 1));
    return row?.sequence ?? 0;
  }

  /** Advances the single-row cursor to `sequence` (monotonic — never moves backwards). */
  private async advanceCursor(sequence: number): Promise<void> {
    await this.db
      .insert(pollStreamCursor)
      .values({ id: 1, sequence })
      .onConflictDoUpdate({
        target: pollStreamCursor.id,
        set: { sequence },
        setWhere: sql`${pollStreamCursor.sequence} < ${sequence}`,
      });
  }
}

/** Wires a live consumer for the cron route: the request-time db + the advanced client (WI-1) + the process lock. */
export function createPollConsumer(db: Database): PollConsumer {
  return PollConsumer.create(db, createAdvancedClient(), selectThreadLock());
}
