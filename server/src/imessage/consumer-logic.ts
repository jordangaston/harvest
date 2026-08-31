import type { ThreadMessage } from '../models/thread-message.js';

/**
 * Pure consumer idempotency logic — no DB, no network — so the cursor/gate rules are
 * unit-tested in isolation (Test Case 2).
 */

/**
 * The inbound rows past the cursor. `rows` are in chronological order; the cursor is
 * `threads.last_processed_id`, the newest already-handled inbound id.
 * @returns All rows when the cursor is null; else the rows after the cursor row. An
 *   unknown cursor (not in `rows`) yields all rows.
 */
export function pendingPast(rows: ThreadMessage[], cursor: string | null): ThreadMessage[] {
  if (cursor === null) return rows;
  const at = rows.findIndex((row) => row.id === cursor);
  return at === -1 ? rows : rows.slice(at + 1);
}

/** The id to advance the cursor to: the newest processed inbound row, or null if none. */
export function newestProcessedId(pending: ThreadMessage[]): string | null {
  return pending.length === 0 ? null : pending[pending.length - 1]!.id;
}
