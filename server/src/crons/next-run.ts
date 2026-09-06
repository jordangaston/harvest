import { Cron } from "croner";

/**
 * The next occurrence of a cron expression strictly after `from`, in UTC.
 *
 * A thin wrapper over `croner` — pinned to UTC so it matches the epoch timestamps
 * stored in `next_run_at` regardless of the deploy region's local zone. An
 * hour-bounded per-thread expression therefore means those hours in UTC.
 * @param expression - a standard 5-field cron expression.
 * @param from - the instant to compute the next run after.
 * @returns the next fire time (always in the future relative to `from`).
 */
export function nextRun(expression: string, from: Date): Date {
  const next = new Cron(expression, { timezone: "UTC" }).nextRun(from);
  if (!next) throw new Error(`cron expression never fires: ${expression}`);
  return next;
}
