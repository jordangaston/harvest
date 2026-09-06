import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { MealPlanGeneratorService } from '../../planning/generator-service.js';
import { MealPlanService } from '../../services/meal-plan-service.js';
import { RemindersService } from '../../reminders/reminders-service.js';
import { CRITERIA_DIMENSIONS, type SlotCriteria } from '../../planning/types.js';
import { NotFoundError } from '../../errors.js';
import type { ChefTool, TurnContext } from './types.js';

/** The public recipe-page URL for a recipe id, or undefined when `PUBLIC_APP_URL` is unset — the
 *  same origin the import flow's card uses, so a shared recipe always lands as a tappable app card. */
function recipeUrl(id: string): string | undefined {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}/r/${id}` : undefined;
}

/** The public plan-page URL for a user — the whole upcoming week as one tappable card (`/p/:userId`). */
function planUrl(userId: string): string | undefined {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}/p/${userId}` : undefined;
}

/** The planning window: the next 7 days starting tomorrow (the plan is always forward-looking). */
function planWindow(): { start: string; end: string } {
  const day = 86_400_000;
  const tomorrow = new Date(Date.now() + day);
  const start = tomorrow.toISOString().slice(0, 10);
  const end = new Date(tomorrow.getTime() + 6 * day).toISOString().slice(0, 10);
  return { start, end };
}

const meal = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
/** A calendar date, YYYY-MM-DD — rejected with a clear tool error (not a silent 404) if malformed. */
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const facetMap = z.record(z.enum(CRITERIA_DIMENSIONS), z.array(z.string())).optional();
const criteriaSchema = z
  .object({ include: facetMap, exclude: facetMap, max_total_minutes: z.number().int().positive().optional() })
  .optional();

/** Maps the tool's snake-case criteria onto the planning `SlotCriteria`. */
function toCriteria(c: z.infer<typeof criteriaSchema>): SlotCriteria | undefined {
  if (!c) return undefined;
  return { include: c.include, exclude: c.exclude, maxTotalMinutes: c.max_total_minutes };
}

/**
 * Generates the household's meal plan for the coming week and returns it for Sage to present.
 * Owner-scoped (the thread owner's catalog + the household's meal counts). Idempotent — a re-run
 * replaces the week's generated entries and leaves any manual picks in place.
 */
export class GenerateMealPlanTool implements ChefTool {
  readonly id = 'mealplan__generate';
  private readonly generator: MealPlanGeneratorService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.generator = MealPlanGeneratorService.create(db);
  }

  static create(ctx: TurnContext, db: Database): GenerateMealPlanTool {
    return new GenerateMealPlanTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.initiatorUserId && !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Fill the household\'s week with meals and get the plan back to present. Uses their recorded meal ' +
        'counts and cook nights, ranked to their tastes; each slot gets a main plus any sides their per-meal ' +
        'rules call for. Takes no input. Returns { plan_url, plan: [{ date, meal, recipes: [{ id, title, url }] }] } ' +
        'for the coming 7 days (main first in each slot). Call it once, then share `plan_url` (one send, type ' +
        '"richlink") — the whole week lands as a single tappable card. Re-share it anytime they ask what is planned.',
      inputSchema: z.object({}),
      execute: async () => this.run(),
    });
  }

  async run(): Promise<{ plan_url?: string; plan: { date: string; meal: string; recipes: { id: string; title: string; url?: string }[] }[] }> {
    const { start, end } = planWindow();
    const planned = await this.generator.generate(this.ctx.initiatorUserId, this.ctx.householdId!, start, end);
    return {
      plan_url: planUrl(this.ctx.initiatorUserId),
      plan: planned.map((s) => ({ date: s.date, meal: s.meal, recipes: s.recipes.map((r) => ({ id: r.id, title: r.title, url: recipeUrl(r.id) })) })),
    };
  }
}

/**
 * Ranked, diversified recipe options for one slot, honouring the user's ad-hoc criteria (an
 * ingredient to include, a cook-time cap). "More options" = call again with the shown ids in
 * `exclude_ids`. Reads only — nothing is planned until add_recipe_to_slot.
 */
export class SlotOptionsTool implements ChefTool {
  readonly id = 'mealplan__slot_options';
  private readonly generator: MealPlanGeneratorService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.generator = MealPlanGeneratorService.create(db);
  }

  static create(ctx: TurnContext, db: Database): SlotOptionsTool {
    return new SlotOptionsTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.initiatorUserId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Find recipe options for a slot when the household wants something specific — "fish on Tuesday, ' +
        'under 30 minutes". Pass `date` (YYYY-MM-DD) and `meal`; optional `criteria` narrows by ' +
        'include/exclude facets (ingredient, cuisine, dish_type, food_category) and `max_total_minutes`. ' +
        '`limit` caps how many to return; for "more options", call again with the ids you already showed ' +
        'in `exclude_ids`. Returns { options: [{ id, title, url }] } — share each option by sending its `url` ' +
        '(type "richlink") so it lands as a tappable card. Reads only — use add_recipe_to_slot to place one.',
      inputSchema: z.object({
        date: dateParam,
        meal,
        criteria: criteriaSchema,
        limit: z.number().int().positive().max(10).default(3),
        exclude_ids: z.array(z.string()).optional(),
      }),
      execute: async ({ date, meal: m, criteria, limit, exclude_ids }) =>
        this.run(date, m, toCriteria(criteria), limit, exclude_ids),
    });
  }

  async run(date: string, m: 'breakfast' | 'lunch' | 'dinner' | 'snack', criteria: SlotCriteria | undefined, limit: number, excludeIds?: string[]): Promise<{ options: { id: string; title: string; url?: string }[] }> {
    const options = await this.generator.slotOptions(this.ctx.initiatorUserId, date, m, {
      criteria,
      limit,
      exclude: excludeIds ? new Set(excludeIds) : undefined,
    });
    return { options: options.map((o) => ({ id: o.card.id, title: o.card.title, url: recipeUrl(o.card.id) })) };
  }
}

/**
 * Adds a recipe to a (date, meal) slot as a manual entry (a main or a side) — the user's deliberate
 * pick, so a later regenerate won't overwrite it. Appends after any existing entries in the slot.
 */
export class AddRecipeToSlotTool implements ChefTool {
  readonly id = 'mealplan__add_recipe_to_slot';
  private readonly mealPlan: MealPlanService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.mealPlan = MealPlanService.create(db);
  }

  static create(ctx: TurnContext, db: Database): AddRecipeToSlotTool {
    return new AddRecipeToSlotTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.initiatorUserId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Put a recipe into a slot — a main or a side the household chose. Pass `date` (YYYY-MM-DD), `meal`, ' +
        'and `recipe_id` (an id from slot_options or the plan). It is added as their pick, so a re-plan ' +
        'leaves it alone. Returns { added: true } or a not-found rejection for an unknown recipe.',
      inputSchema: z.object({ date: dateParam, meal, recipe_id: z.string() }),
      execute: async ({ date, meal: m, recipe_id }) => this.run(date, m, recipe_id),
    });
  }

  async run(date: string, m: 'breakfast' | 'lunch' | 'dinner' | 'snack', recipeId: string): Promise<{ added: boolean; rejected?: string }> {
    try {
      await this.mealPlan.add(this.ctx.initiatorUserId, date, m, recipeId, 'manual');
      return { added: true };
    } catch (err) {
      if (err instanceof NotFoundError) return { added: false, rejected: 'no recipe with that id' };
      throw err;
    }
  }
}

/**
 * Removes one recipe from a (date, meal) slot — dropping a main or a side. Removes a single entry;
 * the rest of the slot stays.
 */
export class RemoveRecipeFromSlotTool implements ChefTool {
  readonly id = 'mealplan__remove_recipe_from_slot';
  private readonly mealPlan: MealPlanService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.mealPlan = MealPlanService.create(db);
  }

  static create(ctx: TurnContext, db: Database): RemoveRecipeFromSlotTool {
    return new RemoveRecipeFromSlotTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.initiatorUserId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Take a recipe out of a slot. Pass `date` (YYYY-MM-DD), `meal`, and `recipe_id`. Removes just that ' +
        'one entry (main or side); anything else in the slot stays. Returns { removed: true } or a ' +
        'not-found rejection if that recipe is not in the slot.',
      inputSchema: z.object({ date: dateParam, meal, recipe_id: z.string() }),
      execute: async ({ date, meal: m, recipe_id }) => this.run(date, m, recipe_id),
    });
  }

  async run(date: string, m: 'breakfast' | 'lunch' | 'dinner' | 'snack', recipeId: string): Promise<{ removed: boolean; rejected?: string }> {
    try {
      await this.mealPlan.removeFromSlot(this.ctx.initiatorUserId, date, m, recipeId);
      return { removed: true };
    } catch (err) {
      if (err instanceof NotFoundError) return { removed: false, rejected: 'that recipe is not in this slot' };
      throw err;
    }
  }
}

/**
 * Sets (or retunes) a course's standing daily reminder time — "remind me at 4 for dinner" (F-03).
 * Updates that course's recurring row to the requested local wall-clock, standing from then on;
 * setting a time also un-pauses the course (asking to be reminded is intent to be reminded). Snack
 * upserts on demand. Idempotent — a second identical call re-asserts the same row.
 */
export class SetReminderTimeTool implements ChefTool {
  readonly id = 'mealplan__set_reminder_time';
  private readonly reminders: RemindersService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.reminders = RemindersService.create(db);
  }

  static create(ctx: TurnContext, db: Database): SetReminderTimeTool {
    return new SetReminderTimeTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.threadId && !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Set when to remind the household about a course, every day — "remind me at 4 for dinner". Pass ' +
        '`meal` and `time` (24h local wall-clock, "HH:MM", e.g. "16:00"). Standing from then on, and it ' +
        'un-pauses the course. Returns { meal, reminder_time } on success, or { rejected } for a bad time ' +
        '(re-ask for a valid HH:MM).',
      inputSchema: z.object({ meal, time: z.string() }),
      execute: async ({ meal: m, time }) => this.run(m, time),
    });
  }

  async run(m: 'breakfast' | 'lunch' | 'dinner' | 'snack', time: string): Promise<{ meal: string; reminder_time: string } | { rejected: string }> {
    const reminderTime = await this.reminders.setReminderTime(this.ctx.threadId, m, time, new Date());
    if (reminderTime === null) return { rejected: 'time must be a 24-hour HH:MM, e.g. "16:00"' };
    return { meal: m, reminder_time: reminderTime };
  }
}

/**
 * Pauses or resumes a course's reminder — "stop reminding me about lunch" / "remind me again" (F-06).
 * `enabled=false` durably pauses it (a later meal-count bump won't resurrect it); `enabled=true`
 * resumes it, handing control back to the meal-count rule (0 stays paused). Disabling a course with
 * no reminder is a no-op.
 */
export class SetReminderEnabledTool implements ChefTool {
  readonly id = 'mealplan__set_reminder_enabled';
  private readonly reminders: RemindersService;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.reminders = RemindersService.create(db);
  }

  static create(ctx: TurnContext, db: Database): SetReminderEnabledTool {
    return new SetReminderEnabledTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.threadId && !!this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Turn a course\'s daily reminder off or on — "stop reminding me about lunch" / "remind me about ' +
        'lunch again". Pass `meal` and `enabled` (false to pause, true to resume). A pause is durable — ' +
        'adding meals back to the week later won\'t resurrect it. Returns { meal, enabled }.',
      inputSchema: z.object({ meal, enabled: z.boolean() }),
      execute: async ({ meal: m, enabled }) => this.run(m, enabled),
    });
  }

  async run(m: 'breakfast' | 'lunch' | 'dinner' | 'snack', enabled: boolean): Promise<{ meal: string; enabled: boolean }> {
    await this.reminders.setReminderEnabled(this.ctx.threadId, m, enabled, new Date());
    return { meal: m, enabled };
  }
}
