import type { Task } from '../models/task.js';

/** The follow-up ladder: gaps from the last touch (`nudgedAt`) at which a quiet `asked` task is nudged
 *  again. After the 6th nudge (`followUpsSent === LADDER.length`) the task goes quiet forever (DESIGN
 *  Q-01 — a required task is NOT defaulted). Milliseconds. */
export const FOLLOW_UP_LADDER = [
  5 * 60_000, // 5m
  30 * 60_000, // 30m
  60 * 60_000, // 60m
  4 * 60 * 60_000, // 4h
  8 * 60 * 60_000, // 8h
  24 * 60 * 60_000, // 24h
] as const;

/**
 * The active objective's actionable work at `now` — the heartbeat decides whether to run a turn from
 * this. `tasks` is the eligibility-filtered set `loadActive` returns (terminal tasks and gated-unasked
 * tasks already dropped). `now` is passed in — this is pure, no clock read.
 *
 * - **Arm 1 (quiet ask):** an `asked` task with `followUpsSent < LADDER.length` whose silence since
 *   `nudgedAt` has reached the current rung `LADDER[followUpsSent]`. A null `nudgedAt` on an `asked`
 *   task is treated as due immediately (it predates the feature or missed a stamp; a nudge is the safe
 *   recovery).
 * - **Arm 2 (eligible unasked work):** an `unasked` task — elicit or emit — whose gates are already
 *   satisfied by `loadActive`; no ladder wait. Re-delivery is safe by guid scoping (the consumer's
 *   job): an emit-bearing heartbeat turn rides the objective-id scope that kick-offs use, so content
 *   an earlier attempt already sent — from EITHER arm — is silently swallowed by the sink and the
 *   turn continues to mark the emit done. Elicit asks ride the `:hb:` scope, whose `:n` counter
 *   advances only on a delivered commit, so crashed attempts regenerate the same prefix and dedupe.
 */
export function actionable(tasks: Task[], now: Date): Task[] {
  return tasks.filter((t) => {
    if (t.status === 'unasked') return true;
    if (t.status !== 'asked' || t.followUpsSent >= FOLLOW_UP_LADDER.length) return false;
    const since = t.nudgedAt ? now.getTime() - t.nudgedAt.getTime() : Infinity;
    return since >= FOLLOW_UP_LADDER[t.followUpsSent]!;
  });
}
