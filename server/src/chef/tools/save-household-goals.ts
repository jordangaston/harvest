import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { GOALS, users } from '../../schema.js';
import { coerce, labelFor, type Candidate } from './catalog.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({ goals: z.array(z.string()).min(1) });

const GOAL_CANDIDATES: Candidate[] = GOALS.map((value) => ({ value, label: labelFor(value) }));

/**
 * Records the household's cooking goals onto every member's `users.goals` (the goal set is
 * household-wide, and `users.goals` is what `PreferenceRepository.coldStart` reads to seed ranking
 * weights). Coerces free phrasing to the `GOALS` vocab — "eat healthier" → `eat_healthier`, "quick
 * weeknight dinners" → `quick_meals` — and unions onto each member's existing goals. Legal once the
 * household exists.
 */
export class SaveHouseholdGoalsTool implements ChefTool {
  readonly id = 'save_household_goals';
  readonly saved: SaveResult[] = [];

  private constructor(private readonly ctx: TurnContext) {}

  static create(ctx: TurnContext): SaveHouseholdGoalsTool {
    return new SaveHouseholdGoalsTool(ctx);
  }

  canRun(): boolean {
    return !!this.ctx.householdId && this.ctx.members.length > 0;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        "Save the household's cooking goals once they share what they want out of a chef. Coerces to the " +
        'goal vocabulary (eat_healthier, save_money, improve_cooking, organize_recipes, plan_meals, ' +
        'meal_prepping, try_new_cuisines, kid_friendly, quick_meals); unmatched phrasings are rejected ' +
        'with the nearest matches. Applies to the whole household.',
      inputSchema,
      execute: async ({ goals }) => this.run(goals),
    });
  }

  async run(rawGoals: string[]): Promise<SaveResult> {
    const saved: string[] = [];
    const rejected: SaveResult['rejected'] = [];
    for (const g of rawGoals) {
      const { value, closest } = coerce(g, GOAL_CANDIDATES);
      if (value) saved.push(value);
      else rejected.push({ input: g, reason: 'no catalog match', closest });
    }
    if (saved.length) {
      await this.ctx.db.transaction(async (tx) => {
        for (const m of this.ctx.members) {
          const [row] = await tx.select({ goals: users.goals }).from(users).where(eq(users.id, m.userId));
          const merged = Array.from(new Set([...(row?.goals ?? []), ...saved])) as (typeof GOALS)[number][];
          await tx.update(users).set({ goals: merged }).where(eq(users.id, m.userId));
        }
      });
    }
    const result: SaveResult = { saved: saved.length ? { goals: saved } : {}, rejected };
    this.saved.push(result);
    return result;
  }
}
