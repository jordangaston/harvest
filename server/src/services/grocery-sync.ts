import type { Database } from '../db.js';
import { HouseholdRepository } from '../repositories/household-repository.js';
import { MealPlanRepository } from '../repositories/meal-plan-repository.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { GroceryService, type AddGroceryItem } from './grocery-service.js';

/** The reconcile window: today through +7 days — the /p plan page's window, so the list follows
 * everything the plan shows and everything the generator writes. */
function planWindow(): { start: string; end: string } {
  const day = 86_400_000;
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Keeps a household's recipe-sourced grocery rows in sync with its plan owner's plan (F-05). Fires
 * after a committed plan mutation at the meal-plan chokepoints, so the REST endpoints and the chef
 * tools both trigger it with one code path. Reconcile-from-state: recompute what the plan implies and
 * diff, so a replay writes nothing. Manual and checked rows are never touched.
 */
export class GrocerySync {
  constructor(
    private readonly households: HouseholdRepository,
    private readonly mealPlan: MealPlanRepository,
    private readonly recipes: RecipeRepository,
    private readonly groceries: GroceryService,
  ) {}

  /** Wire from a caller-supplied db (tests pass a local `file:` db). */
  static create(db: Database): GrocerySync {
    return new GrocerySync(
      HouseholdRepository.create(db),
      MealPlanRepository.create(db),
      RecipeRepository.create(db),
      GroceryService.create(db),
    );
  }

  /**
   * Converges the plan owner's household's recipe-sourced grocery rows to the current plan window.
   * No-op (one log line) when the owner has no household. Idempotent — a replay finds the list
   * already correct and writes nothing.
   * @param userId - The plan owner whose plan was mutated.
   */
  async reconcile(userId: string): Promise<void> {
    const householdId = await this.households.householdIdForUser(userId);
    if (!householdId) {
      console.log(`[grocery-sync] reconcile no household userId=${userId}`);
      return;
    }
    const { start, end } = planWindow();
    const entries = await this.mealPlan.listRange(userId, start, end);
    const recipeIds = [...new Set(entries.map((e) => e.recipe.id))];
    const desired = await this.desiredItems(recipeIds);
    const { inserted, deleted } = await this.groceries.setRecipeSourced(householdId, desired);
    console.log(`[grocery-sync] reconcile userId=${userId} householdId=${householdId} planRecipes=${recipeIds.length} inserted=${inserted} deleted=${deleted}`);
  }

  /** The recipe-sourced items the plan implies: each distinct planned recipe's ingredients, tagged with
   * its `sourceRecipeId`. A deleted recipe (`findById` null) contributes nothing. */
  private async desiredItems(recipeIds: string[]): Promise<AddGroceryItem[]> {
    const items: AddGroceryItem[] = [];
    for (const recipeId of recipeIds) {
      const detail = await this.recipes.findById(recipeId);
      if (!detail) continue;
      for (const ing of detail.ingredients) {
        items.push({
          name: ing.name,
          amount: ing.amount == null ? null : Number(ing.amount),
          unit: ing.unit,
          quantityText: ing.quantityText,
          sourceRecipeId: recipeId,
        });
      }
    }
    return items;
  }
}
