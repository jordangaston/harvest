import Redis from 'ioredis';
import Redlock, { ExecutionError } from 'redlock';

/**
 * Per-thread turn lock (see the design's Idempotency & concurrency #3). One processor
 * works a thread at a time; different threads run in parallel. The lock is held across the
 * whole turn — including the multi-second LLM call — so it lives in Redis via `redlock`
 * (`using()` auto-extends while the routine runs), not a DB/advisory lock (can't span the
 * call on serverless).
 *
 * ACCEPTED CEILING: `redlock` issues no fencing token, so a process pause past the TTL can
 * let two turns write concurrently. Rare and deliberately tolerated for now — the fix, if it
 * ever bites, is a store-enforced monotonic fence token, not in the lock service.
 */
export interface ThreadLock {
  /** Run `fn` under the thread's lock. `ran: false` means another processor holds it. */
  withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }>;
}

const LOCK_TTL_MS = 30_000; // auto-extended by using() for the turn's duration

/** Live Redis-backed lock. */
export class RedlockLock implements ThreadLock {
  private constructor(private readonly redlock: Redlock) {}

  static create(url: string): RedlockLock {
    const client = new Redis(url, { maxRetriesPerRequest: null });
    // retryCount 0: the loser fails fast instead of waiting — the holder re-drains its work.
    const redlock = new Redlock([client], { retryCount: 0 });
    return new RedlockLock(redlock);
  }

  async withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
    try {
      const value = await this.redlock.using([`chef:thread:${threadId}`], LOCK_TTL_MS, () => fn());
      return { ran: true, value };
    } catch (err) {
      if (err instanceof ExecutionError) return { ran: false }; // couldn't acquire — another holder
      throw err;
    }
  }
}

/** Offline test double — always acquires (or never, when constructed with `false`). */
export class StubThreadLock implements ThreadLock {
  calls = 0;
  constructor(private readonly acquires = true) {}

  async withThreadLock<T>(_threadId: string, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
    this.calls += 1;
    if (!this.acquires) return { ran: false };
    return { ran: true, value: await fn() };
  }
}

let singleton: ThreadLock | undefined;

/**
 * The lock for the current env: the live Redis lock when `REDIS_URL` is set, else the offline
 * stub (mirrors selectSender/selectChef). Memoized so one Redis client serves the process.
 */
export function selectThreadLock(): ThreadLock {
  if (singleton) return singleton;
  const url = process.env.REDIS_URL;
  singleton = url ? RedlockLock.create(url) : new StubThreadLock();
  return singleton;
}
