import type { Database } from '../db.js';
import { ReminderRepository } from './reminder-repository.js';
import { HouseholdPreferenceRepository } from '../repositories/household-preference-repository.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { nextRun } from '../crons/next-run.js';
import type { MealSlot } from '../models/meal-plan.js';

/** A drizzle transaction client — provisioning commits inside the objective-completion txn. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The IANA zone reminder crons fall back to until the TIMEZONE household fact is set (WI-02). */
export const DEFAULT_TZ = process.env.DEFAULT_TZ ?? 'UTC';

/**
 * A course's reminder timing: the local wall-clock the household eats (`anchor`) minus how far ahead
 * to nudge (`leadMinutes`). Breakfast is intentionally absent — its lead crosses midnight (a
 * morning-of ping is too late to shop), so it ships provisioned-but-paused until WI-02 resolves the
 * "announce tomorrow's breakfast" rule (DESIGN Q-04). Snack has no natural anchor (DESIGN Q-06).
 */
const COURSE_TIMING: Partial<Record<MealSlot, { hour: number; minute: number; leadMinutes: number }>> = {
  lunch: { hour: 12, minute: 0, leadMinutes: 90 }, // 10:30 local
  dinner: { hour: 18, minute: 0, leadMinutes: 90 }, // 16:30 local
};

/** The three courses provisioned at first-plan confirm (breakfast paused until Q-04; snack never). */
const PROVISIONED_COURSES: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** A course we don't yet know how to time (breakfast today) ships paused, so it never fires a no-op. */
const NO_TIMING_CRON = '0 0 * * *';

/**
 * Owns a household's meal-reminder rows: the cron math (course anchor − lead in the household zone)
 * and provisioning at first-plan confirm (F-01). Pausing/recompute/tools land in WI-02/WI-03.
 */
export class RemindersService {
  constructor(
    private readonly reminders: ReminderRepository,
    private readonly prefs: HouseholdPreferenceRepository,
    private readonly threads: ThreadRepository,
  ) {}

  /** Wire from a caller-supplied db. */
  static create(db: Database) {
    return new RemindersService(
      ReminderRepository.create(db),
      HouseholdPreferenceRepository.create(db),
      ThreadRepository.create(db),
    );
  }

  /**
   * Provisions a thread's per-course reminder rows (F-01), gated by the caller on the first-meal-plan
   * confirm. Breakfast/lunch/dinner each get one recurring row; a course's `is_paused` is derived
   * from the household's weekly count (0 ⇒ paused), and breakfast ships paused regardless until its
   * cross-midnight timing is resolved (Q-04). Idempotent — a re-run re-asserts the same rows via the
   * repository's upsert. Runs inside the completion transaction so provisioning and the pop commit
   * together.
   * @param threadId - the thread whose household now has a plan worth reminding about.
   * @param now - the instant next-run is computed from.
   */
  async provisionReminders(threadId: string, now: Date, tx: Tx): Promise<void> {
    const thread = await this.threads.findById(threadId);
    if (!thread?.householdId) return; // a thread with no household has no meal counts to derive from
    const prefs = await this.prefs.getPreferences(thread.householdId);
    const tz = prefs.timezone ?? DEFAULT_TZ;
    const weekly = prefs.weeklyMeals ?? { breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 };

    const provisioned: MealSlot[] = [];
    for (const meal of PROVISIONED_COURSES) {
      const timing = COURSE_TIMING[meal];
      const cronExpression = timing ? cronFor(timing) : NO_TIMING_CRON;
      // A course with no timing (breakfast) is always paused; otherwise pause a course the household
      // plans zero of. Weekly counts are per-course scalars keyed by meal name.
      const isPaused = !timing || (weekly[meal] ?? 0) === 0;
      await this.reminders.upsertCourseReminder(threadId, meal, cronExpression, nextRun(cronExpression, now, tz), isPaused, tz, tx);
      if (!isPaused) provisioned.push(meal);
    }
    console.info(JSON.stringify({ event: 'reminders provisioned', threadId, courses: provisioned }));
  }

  /**
   * Recomputes a household's reminder crons into its (newly-set) timezone (F-04) — hung off
   * `TimezoneType.persist`, so setting the tz anywhere re-derives the crons. Reads the zone from the
   * household's prefs (the fact has already persisted it) and delegates the per-row move to the
   * repository. A household with no reminders is a silent no-op.
   * @param householdId - the household whose timezone fact just changed.
   * @param now - the instant next-run is computed from.
   */
  async recomputeCrons(householdId: string, now: Date): Promise<void> {
    const tz = (await this.prefs.getPreferences(householdId)).timezone ?? DEFAULT_TZ;
    await this.reminders.recompute(householdId, tz, now);
    console.info(JSON.stringify({ event: 'reminders recomputed', householdId, tz }));
  }

  /**
   * Syncs a course's pause state to its weekly meal count (F-05) — hung off
   * `WeeklyMealCountType.persist`. The rule is `is_paused = count === 0 || pausedByUser`: a course
   * the household plans zero of pauses, raising it back un-pauses — UNLESS the household explicitly
   * turned it off (`pausedByUser`, F-06), which a preference recompute must never resurrect. Breakfast
   * is not a weekly-count course here (it ships paused with no timing until Q-04), so a breakfast
   * count sync leaves its provisioned pause untouched via the same rule.
   * @param householdId - the household whose count changed.
   * @param meal - the course.
   * @param count - the new weekly count for the course.
   * @param pausedByUser - the explicit-pause marker from the fact's `input` JSON (WI-03); default false.
   */
  async syncPause(householdId: string, meal: MealSlot, count: number, pausedByUser = false): Promise<void> {
    await this.reminders.setPausedByHousehold(householdId, meal, count, pausedByUser);
  }

  /**
   * Sets (or retunes) a course's standing daily reminder time (F-03). The requested local wall-clock
   * becomes the row's cron in the household zone; `next_run_at` recomputes; the explicit-pause marker
   * clears (asking to be reminded is intent to be reminded); and `is_paused` re-derives from the
   * course's weekly count (0 stays paused — spec AC-1). Upserts a missing course on demand (snack;
   * DESIGN Q-06) — a course whose row an earlier provision skipped is created live at the requested
   * time. Idempotent by construction: a second identical call re-asserts the same one row.
   * @param threadId - the thread whose household is retuning the course.
   * @param meal - the course.
   * @param time - the local wall-clock, `HH:MM` (24h). A malformed value returns null (the tool
   *   rejects; the service never throws on user input).
   * @param now - the instant next-run is computed from.
   * @returns the standing `reminder_time` written, or null when `time` is not a valid `HH:MM`.
   */
  async setReminderTime(threadId: string, meal: MealSlot, time: string, now: Date): Promise<string | null> {
    const cron = cronForTime(time);
    if (!cron) return null;
    const { tz, count } = await this.courseContext(threadId, meal);
    // A time set clears pausedByUser (the upsert's fresh input omits it); is_paused follows the count,
    // except snack (no weekly-count course) which the explicit request makes live.
    const isPaused = meal === 'snack' ? false : count === 0;
    await this.reminders.upsertCourseReminder(threadId, meal, cron, nextRun(cron, now, tz), isPaused, tz);
    return time;
  }

  /**
   * Pauses or resumes a course's reminder explicitly (F-06). `enabled=false` sets `pausedByUser` +
   * `is_paused` (a later count bump won't resurrect it, F-05 precedence); `enabled=true` clears the
   * marker and re-derives `is_paused` from the weekly count (0 stays paused). A missing row: disabling
   * is a no-op (nothing to pause); enabling upserts the course live at its default time so "remind me
   * about lunch again" works even if provisioning never ran (DESIGN F-06 hands control to the
   * preference-derived rule — an enable is an intent to be reminded).
   * @param threadId - the thread whose course toggles.
   * @param meal - the course.
   * @param enabled - the requested state.
   * @param now - the instant next-run is computed from when an enable has to upsert a missing row.
   * @returns whether the row now exists (false only when disabling a course with no row).
   */
  async setReminderEnabled(threadId: string, meal: MealSlot, enabled: boolean, now: Date): Promise<boolean> {
    if (await this.reminders.findCourseReminder(threadId, meal)) {
      const { count } = await this.courseContext(threadId, meal);
      await this.reminders.setEnabled(threadId, meal, enabled, count);
      return true;
    }
    if (!enabled) return false; // nothing to pause
    const { tz, count } = await this.courseContext(threadId, meal);
    const timing = COURSE_TIMING[meal];
    const cron = timing ? cronFor(timing) : NO_TIMING_CRON;
    await this.reminders.upsertCourseReminder(threadId, meal, cron, nextRun(cron, now, tz), meal === 'snack' ? false : count === 0, tz);
    return true;
  }

  /** The household context a course tool needs: the zone its cron reads in and the course's weekly
   *  count (the pause derivation). A thread with no household falls back to DEFAULT_TZ / count 0. */
  private async courseContext(threadId: string, meal: MealSlot): Promise<{ tz: string; count: number }> {
    const thread = await this.threads.findById(threadId);
    if (!thread?.householdId) return { tz: DEFAULT_TZ, count: 0 };
    const prefs = await this.prefs.getPreferences(thread.householdId);
    return { tz: prefs.timezone ?? DEFAULT_TZ, count: prefs.weeklyMeals?.[meal] ?? 0 };
  }
}

/** The daily 5-field cron for a requested `HH:MM` local wall-clock, or null if malformed (out-of-range
 *  hour/minute or the wrong shape). The tool surfaces null as a rejection reason — never a throw. */
function cronForTime(time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${minute} ${hour} * * *`;
}

/** The daily 5-field cron for a course: `anchor − lead`, wrapping within the day (leads never cross
 *  midnight for the provisioned courses; breakfast, which would, is excluded above). */
function cronFor({ hour, minute, leadMinutes }: { hour: number; minute: number; leadMinutes: number }): string {
  const total = ((hour * 60 + minute - leadMinutes) % 1440 + 1440) % 1440;
  return `${total % 60} ${Math.floor(total / 60)} * * *`;
}
