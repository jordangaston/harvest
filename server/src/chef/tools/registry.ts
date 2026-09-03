import { AddMembersTool } from './add-members.js';
import { ImportRecipeTool } from './import-recipe.js';
import { ReadFactsTool } from './read-facts.js';
import { FactTypesTool } from './fact-types.js';
import { UpdateFactsTool } from './update-facts.js';
import { UpdateTasksTool } from './update-tasks.js';
import type { Database } from '../../db.js';
import type { ChefTool, TurnContext } from './types.js';

/** Every chef tool, keyed by id — a factory that binds the tool to one turn's data + the db. */
const FACTORIES: Record<string, (ctx: TurnContext, db: Database) => ChefTool> = {
  add_members: AddMembersTool.create,
  import_recipe: ImportRecipeTool.create,
  read_facts: ReadFactsTool.create,
  fact_types: FactTypesTool.create,
  update_facts: UpdateFactsTool.create,
  update_tasks: UpdateTasksTool.create,
};

/**
 * Instantiate an objective's tools for this turn, keeping only those legal right now (`canRun()`).
 * The active objective declares the ids; each captures its own infra from `db` and binds to the
 * shared `TurnContext` data so a mid-turn `add_members` flows the new roster to tools built
 * later in the same turn.
 */
export function buildTools(ctx: TurnContext, db: Database, toolIds: string[]): ChefTool[] {
  return toolIds
    .map((id) => FACTORIES[id]?.(ctx, db))
    .filter((t): t is ChefTool => !!t && t.canRun());
}
