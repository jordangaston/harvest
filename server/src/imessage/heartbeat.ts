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
 * - **Arm 2 (eligible unasked ELICIT):** an `unasked` elicit — a question the objective can still ask;
 *   its gates are already satisfied by `loadActive`, no ladder wait. An `unasked` *emit* is excluded:
 *   its status can't tell an already-delivered close (a parked kick-off) from an undelivered one, and
 *   re-running it would re-send content — a delivered-but-unmarked emit is the consumer's AC-8 net's
 *   job, not the heartbeat's. So the heartbeat asks questions; it never re-delivers emits.
 */
export function actionable(tasks: Task[], now: Date): Task[] {
  return tasks.filter((t) => {
    if (t.status === 'unasked') return t.kind === 'elicit';
    if (t.status !== 'asked' || t.followUpsSent >= FOLLOW_UP_LADDER.length) return false;
    const since = t.nudgedAt ? now.getTime() - t.nudgedAt.getTime() : Infinity;
    return since >= FOLLOW_UP_LADDER[t.followUpsSent]!;
  });
}
