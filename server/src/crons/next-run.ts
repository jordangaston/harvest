import { Cron } from "croner";

/**
 * The next occurrence of a cron expression strictly after `from`, interpreted in `timezone`.
 *
 * A thin wrapper over `croner`. The returned `Date` is an absolute instant matching the epoch
 * timestamps stored in `next_run_at`; `timezone` decides which wall-clock the expression's hours
 * name. Heartbeats pass UTC (the default, unchanged behaviour); meal reminders pass the household
 * zone so an "18:00" fires at 6pm local through DST.
 * @param expression - a standard 5-field cron expression.
 * @param from - the instant to compute the next run after.
 * @param timezone - the IANA zone the expression is read in (default UTC).
 * @returns the next fire time (always in the future relative to `from`).
 */
export function nextRun(expression: string, from: Date, timezone = "UTC"): Date {
  const next = new Cron(expression, { timezone }).nextRun(from);
  if (!next) throw new Error(`cron expression never fires: ${expression}`);
  return next;
}
