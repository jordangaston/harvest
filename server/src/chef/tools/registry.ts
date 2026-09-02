import { CreateHouseholdTool } from './create-household.js';
import { SaveHouseholdProfileTool } from './save-household-profile.js';
import { SaveHouseholdGoalsTool } from './save-household-goals.js';
import { SaveMemberProfileTool } from './save-member-profile.js';
import { SearchCatalogTool } from './search-catalog.js';
import { ImportRecipeTool } from './import-recipe.js';
import { ReadFactsTool } from './read-facts.js';
import { FactTypesTool } from './fact-types.js';
import { UpdateFactsTool } from './update-facts.js';
import { UpdateTasksTool } from './update-tasks.js';
import type { ChefTool, TurnContext } from './types.js';

/** Every chef tool, keyed by id — a factory that binds the tool to one turn's context. */
const FACTORIES: Record<string, (ctx: TurnContext) => ChefTool> = {
  create_household: CreateHouseholdTool.create,
  save_household_profile: SaveHouseholdProfileTool.create,
  save_household_goals: SaveHouseholdGoalsTool.create,
  save_member_profile: SaveMemberProfileTool.create,
  search_catalog: SearchCatalogTool.create,
  import_recipe: ImportRecipeTool.create,
  read_facts: ReadFactsTool.create,
  fact_types: FactTypesTool.create,
  update_facts: UpdateFactsTool.create,
  update_tasks: UpdateTasksTool.create,
};

/**
 * Instantiate an objective's tools for this turn, keeping only those legal right now (`canRun()`).
 * The active objective declares the ids; each is bound to the shared `TurnContext` so a mid-turn
 * `create_household` flows the new household to the surviving `save_*` tools.
 */
export function buildTools(ctx: TurnContext, toolIds: string[]): ChefTool[] {
  return toolIds
    .map((id) => FACTORIES[id]?.(ctx))
    .filter((t): t is ChefTool => !!t && t.canRun());
}
