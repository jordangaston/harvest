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
}

/** The daily 5-field cron for a course: `anchor − lead`, wrapping within the day (leads never cross
 *  midnight for the provisioned courses; breakfast, which would, is excluded above). */
function cronFor({ hour, minute, leadMinutes }: { hour: number; minute: number; leadMinutes: number }): string {
  const total = ((hour * 60 + minute - leadMinutes) % 1440 + 1440) % 1440;
  return `${total % 60} ${Math.floor(total / 60)} * * *`;
}
